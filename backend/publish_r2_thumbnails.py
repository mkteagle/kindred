"""Publish local previews without opening the original media library."""
import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import closing
from datetime import datetime, timezone
import fcntl
from io import BytesIO
from itertools import islice
import json
import os
from pathlib import Path
import re
import sqlite3
from stat import S_ISREG
from threading import Event, Thread
import time

from PIL import Image, ImageOps

from preview_delivery import THUMBNAIL_ROOT
from r2_thumbnails import THUMBNAIL_PREFIX, key_for, storage
from worker_priority import DATA_DIR, IndexingPriority

THUMBNAIL_EDGE = 320
THUMBNAIL_MAX_BYTES = 32 * 1024
ENCODING_VERSION = "compact-320-32k-v1"
THUMBNAIL_NAME = re.compile(r"([0-9a-f-]+)(-poster)?\.jpg")
INVENTORY_INTERVAL = 900


def pending_item(path, checkpoint, info=None):
    match = THUMBNAIL_NAME.fullmatch(path.name)
    if not match:
        return None
    try:
        info = info if info is not None else path.lstat()
    except FileNotFoundError:
        return None
    if not S_ISREG(info.st_mode):
        return None
    identity, poster = match.groups()
    key = key_for(identity)
    if not key or (not poster and path.with_name(f"{identity}-poster.jpg").is_file()):
        return None
    version = f"{ENCODING_VERSION}:{path.name}:{info.st_mtime_ns}:{info.st_size}"
    if not checkpoint.execute("SELECT 1 FROM published WHERE key=? AND version=?", (key, version)).fetchone():
        return path, key, version


def pending_files(root, checkpoint, priorities=(), can_work=None):
    priority_paths = set()
    for identity in dict.fromkeys(priorities):
        if can_work is not None and not can_work():
            return
        if not key_for(identity):
            continue
        for name in (f"{identity}-poster.jpg", f"{identity}.jpg"):
            if item := pending_item(root / name, checkpoint):
                priority_paths.add(name)
                yield item
                break
    with os.scandir(root) as entries:
        for entry in entries:
            if can_work is not None and not can_work():
                return
            if entry.name in priority_paths or not entry.is_file(follow_symlinks=False):
                continue
            try:
                if item := pending_item(Path(entry.path), checkpoint, entry.stat(follow_symlinks=False)):
                    yield item
            except FileNotFoundError:
                continue  # A preview might be replaced while we scan.


def compact_identity(key):
    identity = key[len(THUMBNAIL_PREFIX):-4]
    return bytes.fromhex(identity.replace("-", "")) if "-" in identity else identity


def thumbnail_total(root, checkpoint_path, can_work):
    """Count unique R2 keys using filenames only, including already uploaded keys."""
    identities = set()
    with os.scandir(root) as entries:
        for entry in entries:
            if not can_work():
                return None
            name = THUMBNAIL_NAME.fullmatch(entry.name)
            if name and entry.is_file(follow_symlinks=False) and (key := key_for(name[1])):
                identities.add(compact_identity(key))
    with closing(sqlite3.connect(f"{checkpoint_path.resolve().as_uri()}?mode=ro", uri=True)) as checkpoint:
        for key, in checkpoint.execute("SELECT key FROM published"):
            if not can_work():
                return None
            identities.add(compact_identity(key))
    return len(identities)


def report_inventory(args, status, stopped, can_work):
    while not stopped.is_set():
        try:
            total = thumbnail_total(args.root, args.checkpoint, can_work)
            if total is not None:
                status["thumbnail_total"] = total
                write_status(args.checkpoint.with_suffix(".inventory.json"), {"thumbnail_total": total})
                print(f"Counted {total:,} thumbnails in the NAS and R2 inventory", flush=True)
        except (OSError, sqlite3.Error) as exc:
            print(f"Could not count thumbnails ({type(exc).__name__})", flush=True)
        stopped.wait(INVENTORY_INTERVAL)


def compact_jpeg(path):
    with Image.open(path) as image:
        thumb = ImageOps.exif_transpose(image).convert("RGB")
    for edge, quality in ((THUMBNAIL_EDGE, 76), (THUMBNAIL_EDGE, 58), (256, 50), (160, 42)):
        thumb.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        buffer = BytesIO()
        thumb.save(buffer, "JPEG", quality=quality, optimize=True)
        if buffer.tell() <= THUMBNAIL_MAX_BYTES:
            return buffer.getvalue()
    raise ValueError("Could not encode a compact thumbnail")


def publish_one(client, bucket, item):
    path, key, version = item
    started = time.monotonic()
    data = compact_jpeg(path)
    prepared = time.monotonic()
    client.put_object(Bucket=bucket, Key=key, Body=data, ContentType="image/jpeg",
                      CacheControl="private, max-age=300")
    return key, version, prepared - started, time.monotonic() - prepared


def write_status(path, status):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({**status, "updated_at": datetime.now(timezone.utc).isoformat()}))
    temporary.replace(path)


def report_status(path, status, stopped, priority):
    while not stopped.wait(5):
        phase = priority.blocking_phase()
        snapshot = dict(status)
        if phase:
            snapshot.update(phase=phase, running=False, waiting=True)
        write_status(path, snapshot)


def run(args):
    with args.checkpoint.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with sqlite3.connect(args.checkpoint) as checkpoint, ThreadPoolExecutor(max_workers=args.workers) as pool:
            checkpoint.execute("PRAGMA journal_mode=WAL")
            checkpoint.execute("CREATE TABLE IF NOT EXISTS published (key TEXT PRIMARY KEY, version TEXT NOT NULL)")
            confirmed = checkpoint.execute("SELECT count(*) FROM published").fetchone()[0]
            status = dict(completed=confirmed, failed=0, running=True, waiting=False,
                          phase="starting", workers=args.workers)
            stopped = Event()
            priority = IndexingPriority(args.wait_for_previews or DATA_DIR, required=bool(args.wait_for_previews))

            def can_work():
                return priority.wait(stopped)

            reporter = None
            counter = None
            catalog_sync = None
            if args.status:
                if args.watch:
                    inventory = args.checkpoint.with_suffix(".inventory.json")
                    try:
                        if time.time() - inventory.stat().st_mtime < INVENTORY_INTERVAL * 2:
                            status["thumbnail_total"] = json.loads(inventory.read_text())["thumbnail_total"]
                    except (OSError, ValueError, KeyError):
                        pass
                args.status.parent.mkdir(parents=True, exist_ok=True)
                write_status(args.status, status)
                reporter = Thread(target=report_status, args=(args.status, status, stopped, priority), daemon=True)
                reporter.start()
                if args.watch:
                    counter = Thread(target=report_inventory, args=(args, status, stopped, can_work), daemon=True)
                    counter.start()
            try:
                can_work()
                if args.status and not args.watch:
                    status["thumbnail_total"] = thumbnail_total(args.root, args.checkpoint, can_work)
                config = storage(upload_workers=args.workers)
                if config is None:
                    raise RuntimeError("Set KINDRED_R2_BUCKET and the bucket-scoped R2 credentials first")
                client, bucket = config
                if os.environ.get("KINDRED_R2_CATALOG_DATABASE_URL"):
                    from r2_catalog import initialize_feed, sync_catalog

                    initialize_feed(checkpoint)
                    catalog_sync = Thread(target=sync_catalog, args=(args.checkpoint, bucket, stopped, can_work), daemon=True)
                    catalog_sync.start()
                while True:
                    can_work()
                    priorities = args.priority_list.read_text().splitlines() if args.priority_list else ()
                    status.update(waiting=False, running=True, phase="publishing", failed=0)
                    failed = publish_pass(args, client, bucket, checkpoint, pool, priorities, status, can_work)
                    phase = "retrying" if failed else "stopped" if args.limit else "caught_up"
                    status.update(waiting=True, running=False, phase=phase)
                    if not args.watch:
                        return int(bool(failed))
                    time.sleep(45 if failed else 120)
            except BaseException:
                status.update(phase="stopped")
                raise
            finally:
                stopped.set()
                if catalog_sync:
                    catalog_sync.join(timeout=2)
                if reporter:
                    reporter.join()
                    if counter:
                        counter.join(timeout=2)
                    status.update(running=False)
                    write_status(args.status, status)


def publish_pass(args, client, bucket, checkpoint, pool, priorities, status, can_work):
    uploaded = failed = 0
    items = pending_files(args.root, checkpoint, priorities, can_work)
    if args.limit:
        items = islice(items, args.limit)
    last_report = time.monotonic()
    last_uploaded = new_keys = uncommitted = 0
    prepared_seconds = upload_seconds = 0.0
    active = set()
    print("Publishing available compact thumbnails", flush=True)
    while True:
        if uploaded or failed < 64:
            for item in islice(items, args.workers - len(active)):
                active.add(pool.submit(publish_one, client, bucket, item))
        if not active:
            break
        finished, active = wait(active, return_when=FIRST_COMPLETED)
        for future in finished:
            try:
                key, version, prepare_time, put_time = future.result()
            except Exception as exc:
                failed += 1
                if failed <= 5:
                    print(f"Thumbnail publication failed ({type(exc).__name__})", flush=True)
                continue
            inserted = checkpoint.execute("INSERT OR IGNORE INTO published VALUES (?, ?)", (key, version))
            new_keys += inserted.rowcount
            if not inserted.rowcount:
                checkpoint.execute("UPDATE published SET version=? WHERE key=?", (version, key))
            uploaded += 1
            uncommitted += 1
            prepared_seconds += prepare_time
            upload_seconds += put_time
        now = time.monotonic()
        if uncommitted >= 64 or now - last_report >= 15:
            checkpoint.commit()
            status.update(completed=status["completed"] + new_keys, failed=failed)
            new_keys = uncommitted = 0
        if now - last_report >= 15:
            interval_count = uploaded - last_uploaded
            rate = interval_count * 60 / (now - last_report)
            mean_prepare = prepared_seconds / max(1, interval_count)
            mean_put = upload_seconds / max(1, interval_count)
            print(f"Published {uploaded:,}, failed {failed:,} in this pass "
                  f"({rate:,.0f}/min, read and encode {mean_prepare:.3f}s, PUT {mean_put:.3f}s)", flush=True)
            last_report, last_uploaded = now, uploaded
            prepared_seconds = upload_seconds = 0.0
    checkpoint.commit()
    status.update(completed=status["completed"] + new_keys, failed=failed)
    print(f"Pass finished: published {uploaded:,}, failed {failed:,}", flush=True)
    return failed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=THUMBNAIL_ROOT)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--status", type=Path, help="Shared worker heartbeat file")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 33))
    parser.add_argument("--priority-list", type=Path, help="Catalog IDs to publish before the full preview scan")
    parser.add_argument("--watch", action="store_true", help="Keep publishing previews as they become available")
    parser.add_argument("--wait-for-previews", type=Path, metavar="STATUS_DIR",
                        help="Require discovery and NAS previews to be caught up while publishing")
    raise SystemExit(run(parser.parse_args()))
