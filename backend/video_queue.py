"""Durable video-only Flickr queue. Credentials are resolved by the worker, never saved."""
import asyncio
import fcntl
import json
import os
from pathlib import Path
import time
import uuid

import video_mirror


def queue_root():
    root = Path(os.environ.get('KINDRED_WORKER_DATA', '/app/data')) / 'video-mirrors'
    root.mkdir(parents=True, exist_ok=True)
    return root


def enqueue(photo_id, source, metadata, privacy):
    photo_id = str(uuid.UUID(str(photo_id)))
    root = queue_root() / photo_id
    root.mkdir(exist_ok=True)
    path = root / 'job.json'
    if path.exists():
        return
    # Serialize producer/consumer updates across API/importer/worker processes.
    with (root / 'job.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if path.exists():
                return
            raise RuntimeError("Video queue entry is being created; retry enqueue")
        if path.exists():
            return
        video_mirror.save(path, dict(photo_id=photo_id, source=str(source), metadata=metadata,
                                    privacy=privacy, status='pending', attempts=0, next_attempt=0))


def durable_source(main, job):
    """Resolve the current catalog key, so queued absolute paths survive relocation."""
    from storage import LocalStorageProvider
    rows = main.db_query("SELECT provider_key, sha256 FROM photo_copies WHERE photo_id=%s AND provider='nas' AND status='available'",
                         (job['photo_id'],))
    if not rows or not rows[0]['sha256']:
        raise ValueError('Video has no checksummed NAS original')
    source = LocalStorageProvider(os.environ['PHOTO_STORAGE_ROOT']).resolve_local_path(rows[0]['provider_key'])
    if source is None:
        raise FileNotFoundError('Managed video original missing')
    return source, rows[0]['sha256']


async def sync_albums(main, job, creds):
    path = video_mirror.manifest_path(job['photo_id'])
    manifest = json.loads(path.read_text())
    albums = main.db_query('SELECT a.* FROM albums a JOIN album_photos ap ON ap.album_id=a.id WHERE ap.photo_id=%s',
                           (job['photo_id'],))
    originals = main.db_query('SELECT original_filename FROM photos WHERE id=%s', (job['photo_id'],))
    filename = originals[0]['original_filename'] if originals else Path(job['source']).name
    for album in albums:
        # _add_photo_to_album_everywhere expands a completed manifest into all parts.
        result = await main._add_photo_to_album_everywhere(
            album, job['photo_id'], manifest['parts']['1']['flickr_id'], filename, creds)
        if not result['flickr_linked']:
            raise RuntimeError('Video album synchronization failed')


async def process(main, path, mode='all'):
    """Claim one existing job; conversion and upload phases share its original lock."""
    with path.with_name('job.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        job = json.loads(path.read_text())
        if job['status'] in ('done', 'failed', 'needs_reconciliation') or job.get('next_attempt', 0) > time.time():
            return
        phase = job.get('phase', 'convert')
        if mode != 'all' and mode != phase:
            return
        job.update(status='running', phase=phase, attempts=job['attempts'] + 1)
        video_mirror.save(path, job)
        replication_id = None
        try:
            photo_id = job['photo_id']
            if not main._existing_flickr_copy(photo_id):
                replication_id = main._queue_flickr_replication(photo_id)
                main._set_replication_status(replication_id, 'running')
                metadata = job['metadata']
                if phase == 'convert':
                    source, checksum = durable_source(main, job)
                    await asyncio.to_thread(video_mirror.prepare, photo_id, source, checksum)
                    job.update(status='ready', phase='upload', error=None, next_attempt=0)
                    video_mirror.save(path, job)
                    if mode == 'convert':
                        return
                credentials = main.get_flickr_credentials()
                if not credentials:
                    raise RuntimeError('Flickr OAuth is not configured')
                flickr_id = await video_mirror.upload_prepared(main, photo_id,
                    metadata['title'], metadata['description'], credentials, job['privacy'], metadata)
                await sync_albums(main, job, credentials)
                main._record_flickr_copy(photo_id, flickr_id, credentials.get('user_id', ''))
                main.db_query('UPDATE upload_sessions SET flickr_photo_id=%s, updated_at=now() WHERE kindred_photo_id=%s',
                              (flickr_id, photo_id), fetch=False)
                main._set_replication_status(replication_id, 'done')
                main.invalidate_cache('timeline')
            job.update(status='done', error=None)
        except Exception as exc:
            error = f'{type(exc).__name__}: {exc}'[:1000]
            state = ('needs_reconciliation' if isinstance(exc, video_mirror.ReconciliationRequired) else
                     'failed' if isinstance(exc, video_mirror.VideoRejected) else
                     'processing' if isinstance(exc, video_mirror.VideoProcessing) else 'retry')
            if isinstance(exc, video_mirror.DerivativeInvalid):
                job['phase'] = 'convert'
            job.update(status=state, error=error, next_attempt=time.time() + 300)
            if replication_id is not None:
                main._set_replication_status(replication_id, 'failed' if state == 'failed' else 'retry', error)
            print(f"[video] {job['photo_id']}: {error}", flush=True)
        video_mirror.save(path, job)


def reconcile_part(photo_id, number=None, flickr_id=None, confirmed_absent=False, verified_owner=None):
    """Explicit operator assertions; the normal worker rechecks remote processing."""
    root = queue_root() / str(uuid.UUID(photo_id))
    with (root / 'job.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = root / 'manifest.json'
        manifest = json.loads(path.read_text())
        if verified_owner:
            if manifest.get('owner_id', verified_owner) != verified_owner:
                raise ValueError('Cannot replace an existing destination account')
            manifest['owner_id'] = verified_owner
        if number is not None:
            if bool(flickr_id) == bool(confirmed_absent):
                raise ValueError('Supply a verified Flickr ID or explicitly confirm absence')
            part = manifest['parts'][str(number)]
            if part.get('state') not in ('uploading', 'uncertain'):
                raise ValueError('Only an ambiguous upload can be reconciled')
            if flickr_id:
                if not flickr_id.isdigit():
                    raise ValueError('Flickr ID must be numeric')
                part.update(flickr_id=flickr_id, state='uploaded')
            else:
                part['state'] = 'pending'
            part['reconciled_at'] = time.time()
        elif not verified_owner:
            raise ValueError('Specify a part or verified legacy destination account')
        save_job = json.loads((root / 'job.json').read_text())
        # Preparation fills any missing durations and regenerates absent derivatives.
        save_job.update(status='pending', phase='convert', next_attempt=0, error=None)
        video_mirror.save(path, manifest)
        video_mirror.save(root / 'job.json', save_job)


async def run_phase(main, root, mode):
    for path in sorted(root.glob('*/job.json')):
        try:
            await process(main, path, mode)
        except Exception as exc:
            print(f'[video-{mode}] invalid job {path}: {type(exc).__name__}: {exc}', flush=True)


async def run():
    import main
    root = queue_root()
    # Preserve the existing singleton worker and service. Two coroutines dispatch
    # separate phases; blocking FFmpeg runs in a thread, never in the event loop.
    with (root / 'worker.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        async def loop(mode):
            while True:
                await run_phase(main, root, mode)
                await asyncio.sleep(15)
        await asyncio.gather(loop('convert'), loop('upload'))


if __name__ == '__main__':
    asyncio.run(run())
