#!/usr/bin/env python3
"""A restart-safe preview/date queue; never hashes or copies an original."""
from __future__ import annotations
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
from subprocess import TimeoutExpired
import time
import uuid
import threading
from collections import deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
import capture_date
import image_transforms
import preview_delivery
import preview_recovery
import video_preview
from storage import LocalStorageProvider
from discover_nas_library import save_status
from worker_priority import DISCOVERY_STATUS, preview_queue_access, read_status


def build_preview(source, photo_id, media_type):
    destination = preview_delivery.THUMBNAIL_ROOT / f'{photo_id}.jpg'
    temporary = destination.with_name(f'{photo_id}.{uuid.uuid4().hex}.tmp.jpg')
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        if media_type.startswith('video/'):
            try:
                duration = video_preview.probe_duration(source)
                video_preview.render(video_preview.poster_command(source, temporary, duration), temporary)
            except (video_preview.VideoPreviewError, TimeoutExpired):
                if not preview_recovery.recover_video(source, temporary):
                    raise
        else:
            try:
                data = image_transforms.encode(source, preview_recovery.EDGE, 80, 'jpeg')
            except (ValueError, OSError):
                recovered_type = preview_recovery.recover_image(source, temporary)
                if recovered_type is None:
                    raise
                media_type = recovered_type
            else:
                temporary.write_bytes(data)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination, media_type


def commit_results(connection, ready, failed):
    """Keep each preview/metadata pair atomic, amortizing durable disk flushes."""
    started = time.monotonic()
    try:
        with connection.cursor() as cur:
            if ready:
                execute_values(cur, '''UPDATE photos p SET taken_at=COALESCE(v.taken_at::timestamptz,p.taken_at),
                    latitude=COALESCE(p.latitude,v.latitude::double precision),
                    longitude=COALESCE(p.longitude,v.longitude::double precision),updated_at=now()
                    FROM (VALUES %s) AS v(photo_id,taken_at,latitude,longitude)
                    WHERE p.id=v.photo_id::uuid AND (
                        p.taken_at IS DISTINCT FROM COALESCE(v.taken_at::timestamptz,p.taken_at)
                        OR p.latitude IS DISTINCT FROM COALESCE(p.latitude,v.latitude::double precision)
                        OR p.longitude IS DISTINCT FROM COALESCE(p.longitude,v.longitude::double precision))''',
                    [(photo_id,m.taken_at,m.latitude,m.longitude) for photo_id,m in ready],page_size=128)
                cur.execute('''UPDATE nas_source_files SET preview_ready_at=now(),metadata_ready_at=now()
                    WHERE photo_id=ANY(%s::uuid[])''',([photo_id for photo_id,_ in ready],))
            if failed:
                execute_values(cur,'''UPDATE nas_source_files n SET preview_error=v.error
                    FROM (VALUES %s) AS v(photo_id,error) WHERE n.photo_id=v.photo_id::uuid''',
                    [(photo_id,error[:500]) for photo_id,error in failed],page_size=128)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return time.monotonic() - started


def render_item(provider, row):
    """Rendering is independent; only the coordinator writes to PostgreSQL."""
    decode_seconds = metadata_seconds = 0.0
    try:
        source = provider.resolve_local_path(row['provider_key'])
        if source is None:
            raise FileNotFoundError('Source is unavailable')
        started = time.monotonic()
        _, media_type = build_preview(source, row['photo_id'], row['media_type'])
        decode_seconds = time.monotonic() - started
        started = time.monotonic()
        metadata = capture_date.extract(source, original_filename=row['original_filename'], media_type=media_type)
        metadata_seconds = time.monotonic() - started
        return row['photo_id'], metadata, None, decode_seconds, metadata_seconds
    except Exception as error:
        return row['photo_id'], None, str(error) or type(error).__name__, decode_seconds, metadata_seconds


def heartbeat(status, stop, report):
    samples = deque()
    while not stop.wait(3):
        if status.get('counts_authoritative'):
            now = time.monotonic()
            samples.append((now,status['completed']))
            while len(samples)>2 and samples[1][0]<now-60:
                samples.popleft()
            elapsed = now-samples[0][0]
            if elapsed>=15:
                status['rate_per_minute'] = round(max(0,status['completed']-samples[0][1])*60/elapsed,2)
        report()


def prepare_batch(connection, pool, provider, workers, commit_size, rows, status, discovery_status):
    pending = iter(rows)
    futures = set()
    ready, failed = [], []

    def commit_pending():
        if not ready and not failed:
            return
        status['stage'] = 'saving'
        status['commit_seconds'] += commit_results(connection, ready, failed)
        status['completed'] += len(ready)
        status['failed'] += len(failed)
        ready.clear()
        failed.clear()
        status['stage'] = 'rendering'

    while True:
        if read_status(discovery_status).get('complete'):
            for _ in range(workers - len(futures)):
                row = next(pending, None)
                if row is None:
                    break
                futures.add(pool.submit(render_item, provider, row))
        status['in_flight'] = len(futures)
        if not futures:
            break
        finished, futures = wait(futures, return_when=FIRST_COMPLETED)
        for future in finished:
            photo_id, metadata, error, decode_seconds, metadata_seconds = future.result()
            status['decode_seconds'] += decode_seconds
            status['metadata_seconds'] += metadata_seconds
            if error:
                failed.append((photo_id, error))
            else:
                ready.append((photo_id, metadata))
            if len(ready) + len(failed) >= commit_size:
                commit_pending()
    commit_pending()


def run(args):
    os.nice(10)
    provider = LocalStorageProvider(os.environ['PHOTO_STORAGE_ROOT'])
    state = Path(args.status)
    workers = max(1, min(8, getattr(args,'workers',None) or int(os.environ.get('KINDRED_PREVIEW_WORKERS','4'))))
    commit_size = max(16, min(128, int(os.environ.get("KINDRED_PREVIEW_COMMIT_SIZE","64"))))
    batch_size = max(commit_size*2, workers*32)
    previous = {}
    try:
        previous = json.loads(state.read_text())
    except (OSError,ValueError):
        pass
    status = dict(running=True,phase='previews',completed=previous.get('completed',0),
                  failed=previous.get('failed',0),waiting=False,
                  decode_seconds=previous.get('decode_seconds',0.0),
                  metadata_seconds=previous.get('metadata_seconds',0.0),
                  commit_seconds=previous.get('commit_seconds',0.0),
                  workers=workers,commit_batch_size=commit_size,in_flight=0,stage='starting')
    status_lock = threading.Lock()

    def report():
        with status_lock:
            save_status(state, dict(status))

    discovery_status = state.parent / DISCOVERY_STATUS
    report()
    stop = threading.Event()
    reporter = threading.Thread(target=heartbeat,args=(status,stop,report),daemon=True)
    reporter.start()
    try:
        with closing(psycopg2.connect(os.environ['DATABASE_URL'])) as connection, ThreadPoolExecutor(max_workers=workers) as pool:
            with connection.cursor() as cur:
                cur.execute('SELECT pg_try_advisory_lock(4921733104)')
                if not cur.fetchone()[0]:
                    raise RuntimeError('A preview worker is already running')
            connection.commit()
            status['stage']='counting_existing_previews'
            with connection.cursor() as cur:
                cur.execute('''SELECT count(*) FILTER (WHERE preview_ready_at IS NOT NULL),
                    count(*) FILTER (WHERE preview_error IS NOT NULL) FROM nas_source_files''')
                completed, failed = cur.fetchone()
            connection.commit()
            status.update(completed=completed,failed=failed,counts_authoritative=True)
            while True:
                if not read_status(discovery_status).get('complete'):
                    status.update(phase='waiting_for_discovery',waiting=True,stage='waiting_for_discovery')
                    if args.once:break
                    stop.wait(10);continue
                with preview_queue_access(state.parent):
                    discovery = read_status(discovery_status)
                    if not discovery.get('complete'):
                        continue
                    with connection.cursor(cursor_factory=RealDictCursor) as cur:
                        cur.execute('''SELECT n.photo_id::text, n.relative_path, p.media_type, p.original_filename, nas.provider_key
                            FROM nas_source_files n JOIN photos p ON p.id=n.photo_id
                            JOIN photo_copies nas ON nas.photo_id=p.id AND nas.provider='nas' AND nas.status='available'
                            WHERE n.preview_ready_at IS NULL AND n.preview_error IS NULL
                            ORDER BY n.created_at,n.photo_id LIMIT %s''',(batch_size,))
                        rows=cur.fetchall()
                    connection.commit()
                    if rows:
                        status.update(phase='previews',stage='rendering',waiting=False)
                        report()
                        prepare_batch(connection, pool, provider, workers, commit_size, rows, status, discovery_status)
                if not rows:
                    version = discovery['version']
                    if status['stage'] != 'queue_empty' or status.get('checked_discovery_version') != version:
                        status.update(phase='previews',waiting=True,stage='queue_empty',in_flight=0,
                                      checked_discovery_version=version)
                        report()
                if args.once:
                    break
                if not rows:
                    stop.wait(10)
        status['running']=False
    except Exception:
        status.update(running=False,stage='failed')
        raise
    finally:
        stop.set();reporter.join(timeout=5)
        report()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--status',default='/app/data/nas-preview-status.json')
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--workers',type=int)
    run(parser.parse_args())
