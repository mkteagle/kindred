"""Publish local previews without opening the original media library."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from itertools import islice
import os
from pathlib import Path
import re
import sqlite3
import time

from PIL import Image

from library_progress import progress
from preview_delivery import THUMBNAIL_ROOT
from r2_thumbnails import key_for, storage


def pending_files(root, checkpoint):
    with os.scandir(root) as entries:
        for entry in entries:
            match = re.fullmatch(r"([0-9a-f-]+)(-poster)?\.jpg", entry.name)
            if not match or not entry.is_file(follow_symlinks=False):
                continue
            identity, poster = match.groups()
            key = key_for(identity)
            if not key or (not poster and (root / f"{identity}-poster.jpg").is_file()):
                continue
            stat = entry.stat(follow_symlinks=False)
            version = f"{entry.name}:{stat.st_mtime_ns}:{stat.st_size}"
            if not checkpoint.execute("SELECT 1 FROM published WHERE key=? AND version=?", (key, version)).fetchone():
                yield Path(entry.path), key, version


def previews_finished(status):
    discovery = status.get("discovery") or {}
    previews = status.get("previews") or {}
    return bool(discovery.get("complete") and previews.get("counts_authoritative")
                and previews.get("stale") is False and previews.get("stage") == "queue_empty"
                and previews.get("in_flight") == 0)


def publish_one(client, bucket, item):
    path, key, version = item
    with Image.open(path) as image:
        resize = (
            image.format != "JPEG" or image.width > 512 or image.height > 2560
            or any(marker in {"APP1", "APP13", "COM"} for marker, _ in getattr(image, "applist", ()))
        )
    if resize or path.stat().st_size > 1024 * 1024:
        from image_transforms import encode

        data = encode(path, 480, 80, "jpeg")
    else:
        data = path.read_bytes()
    client.put_object(Bucket=bucket, Key=key, Body=data, ContentType="image/jpeg",
                      CacheControl="private, max-age=300")
    return key, version


def run(args):
    if args.wait_for_previews:
        print("Waiting for thumbnail indexing to finish", flush=True)
        while not previews_finished(progress(args.wait_for_previews)):
            time.sleep(30)
        print("Thumbnail indexing finished; publishing to R2", flush=True)
    config = storage()
    if config is None:
        raise RuntimeError("Set KINDRED_R2_BUCKET and the bucket-scoped R2 credentials first")
    client, bucket = config
    uploaded = failed = 0
    with sqlite3.connect(args.checkpoint) as checkpoint, ThreadPoolExecutor(max_workers=4) as pool:
        checkpoint.execute("CREATE TABLE IF NOT EXISTS published (key TEXT PRIMARY KEY, version TEXT NOT NULL)")
        items = pending_files(args.root, checkpoint)
        if args.limit:
            items = islice(items, args.limit)
        while batch := list(islice(items, 64)):
            futures = [pool.submit(publish_one, client, bucket, item) for item in batch]
            for future in futures:
                try:
                    key, version = future.result()
                except Exception as exc:
                    failed += 1
                    print(f"Thumbnail publication failed ({type(exc).__name__})", flush=True)
                    continue
                checkpoint.execute("INSERT OR REPLACE INTO published VALUES (?, ?)", (key, version))
                uploaded += 1
            checkpoint.commit()
            print(f"Published {uploaded:,}, failed {failed:,}", flush=True)
            if failed:
                break
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=THUMBNAIL_ROOT)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--wait-for-previews", type=Path, metavar="STATUS_DIR")
    raise SystemExit(run(parser.parse_args()))
