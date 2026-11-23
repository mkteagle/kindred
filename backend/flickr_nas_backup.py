#!/usr/bin/env python3
"""Privately mirror eligible NAS originals to the verified household Flickr account."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from contextlib import closing
import fcntl
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time

import psycopg2

from discover_nas_library import save_status
from flickr_match_worker import STATUS_FILE as MATCH_STATUS, fingerprint_stat, record_match
from storage.local import LocalStorageProvider
import throttle
from worker_priority import IndexingPriority

STATUS_FILE = "worker-status/flickr-nas-backup-status.json"
ZERO_UUID = "00000000-0000-0000-0000-000000000000"
IMAGE_FORMATS = {".jpg", ".jpeg", ".png", ".gif", ".heic", ".heif", ".tiff", ".tif", ".bmp"}
VIDEO_FORMATS = {".mp4", ".mov", ".avi", ".wmv", ".mpeg", ".mpg", ".3gp", ".m2ts", ".ogg", ".ogv"}


def comparison_complete(path):
    try:
        state = json.loads(path.read_text())
    except (OSError, ValueError):
        return False
    return (bool(state.get("complete")) and state.get("scope", "account") == "account"
            and state.get("remote_total", 0) > 0 and state.get("completed") == state["remote_total"])


def pending(query, cursor, limit):
    return query("""
        SELECT n.photo_id::text, n.provider_key, n.byte_size, n.updated_at,
               p.media_kind, p.original_filename, p.title, p.description
        FROM photo_copies n JOIN photos p ON p.id=n.photo_id
        WHERE n.provider='nas' AND n.status='available' AND n.photo_id > %s
          AND n.provider_key IS NOT NULL AND n.byte_size > 0 AND p.legacy_photo_id IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM photo_copies remote
              WHERE remote.photo_id=n.photo_id AND remote.provider='flickr'
                AND (remote.provider_key IS NOT NULL OR remote.status='deleted')
          )
          AND NOT EXISTS (
              SELECT 1 FROM replication_jobs job
              WHERE job.photo_id=n.photo_id AND job.target_provider='flickr'
                AND job.status IN ('pending','running','retry')
          )
        ORDER BY n.photo_id LIMIT %s
    """, (cursor, limit))


def supported(row):
    suffix = Path(row["original_filename"] or row["provider_key"]).suffix.lower()
    if row["media_kind"] == "video":
        return suffix in VIDEO_FORMATS and row["byte_size"] <= 1_000_000_000
    return suffix in IMAGE_FORMATS and row["byte_size"] <= 200_000_000


async def copy_to_flickr(main, storage, creds, row, attempts):
    source = storage.resolve_local_path(row["provider_key"])
    if source is None or source.stat().st_size != row["byte_size"]:
        return "retry"
    before = fingerprint_stat(source.stat())
    name = row["original_filename"] or source.name
    if row["media_kind"] == "video":
        from video_mirror import validate_part

        try:
            await asyncio.to_thread(validate_part, source)
        except (ValueError, RuntimeError):
            return "video_needs_review"
    tag = "kindred:backup=" + row["photo_id"].replace("-", "")
    photo_id = None
    if attempts > 1:
        result = await main.flickr_api({
            "method": "flickr.photos.search", "user_id": creds["user_id"],
            "machine_tags": tag, "per_page": 2,
        }, creds)
        found = result.get("photos", {}).get("photo", [])
        if len(found) > 1 or any(item.get("owner") != creds["user_id"] for item in found):
            return "link_needs_review"
        if found:
            photo_id = str(found[0]["id"])
    if not photo_id:
        with tempfile.TemporaryDirectory(prefix="kindred-nas-flickr-") as directory:
            upload_source = source
            if Path(name).suffix.lower() in {".heic", ".heif"}:
                upload_source = Path(directory) / "original"
                await asyncio.to_thread(shutil.copyfile, source, upload_source)
            photo_id = await asyncio.wait_for(main._upload_to_flickr(
                str(upload_source), name, row["title"] or "", row["description"] or "",
                creds, privacy="private", tags=tag, deduplicate=True,
            ), timeout=600)
    if row["media_kind"] == "video":
        info = (await main.flickr_api({"method": "flickr.photos.getInfo", "photo_id": photo_id}, creds)).get("photo", {})
        video = info.get("video", {})
        if str(video.get("failed")) == "1":
            return "video_needs_review"
        if str(video.get("ready")) != "1" or str(video.get("pending")) != "0":
            return "retry"
    if before != fingerprint_stat(source.stat()):
        return "retry"
    try:
        saved = record_match(main.db_query, creds["user_id"], photo_id,
                             row, None, row["byte_size"])
    except psycopg2.errors.UniqueViolation:
        return "duplicate_already_in_flickr"
    return "linked" if saved else "link_needs_review"


async def back_up(main, args, checkpoint, cursor, counters, wait_for_indexing):
    connected = main.get_flickr_credentials()
    if not connected or not connected.get("verified"):
        raise RuntimeError("The household Flickr destination must be verified")
    owner = connected["user_id"]
    main._flickr_pacer.share = 0.10
    if (await main.flickr_api({"method": "flickr.test.login"}, connected))["user"]["id"] != owner:
        raise RuntimeError("The verified Flickr owner changed")
    storage = LocalStorageProvider(os.environ["PHOTO_STORAGE_ROOT"], os.environ["PHOTO_LIBRARY_ROOT"])
    rows = pending(main.db_query, cursor, args.batch_size)
    for row in rows:
        photo_id, stamp = row["photo_id"], row["updated_at"].isoformat()
        previous = checkpoint.execute("""
            SELECT outcome, attempts, retry_after FROM checked
            WHERE owner=? AND photo_id=? AND source_stamp=?
        """, (owner, photo_id, stamp)).fetchone()
        cursor = photo_id
        if previous and (previous[0] != "retry" or previous[2] > time.time()):
            continue
        attempts = (previous[1] if previous else 0) + 1
        retry_after = int(time.time()) + min(86400, 300 * 2**min(attempts - 1, 9))
        receipt = (owner, photo_id, stamp)
        if not supported(row):
            outcome = "unsupported"
        elif not args.apply:
            outcome = "eligible"
        else:
            await throttle.wait_for_capacity()
            await wait_for_indexing()
            with checkpoint:
                checkpoint.execute("INSERT OR REPLACE INTO checked VALUES (?,?,?,?,?,?)",
                                   (*receipt, "retry", attempts, retry_after))
            try:
                outcome = await copy_to_flickr(main, storage, connected, row, attempts)
            except Exception as error:
                print(f"Flickr backup will retry after {type(error).__name__}", flush=True)
                outcome = "retry"
            await asyncio.sleep(args.item_delay)
        counters[outcome] += 1
        if args.apply:
            with checkpoint:
                checkpoint.execute("INSERT OR REPLACE INTO checked VALUES (?,?,?,?,?,?)",
                                   (*receipt, outcome, attempts, retry_after))
    return cursor if rows else None


async def run(args):
    import main

    priority = IndexingPriority()
    args.checkpoint.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with args.checkpoint.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with closing(sqlite3.connect(args.checkpoint)) as checkpoint:
            checkpoint.execute("""
                CREATE TABLE IF NOT EXISTS checked (
                    owner TEXT, photo_id TEXT, source_stamp TEXT, outcome TEXT,
                    attempts INTEGER, retry_after INTEGER, PRIMARY KEY (owner, photo_id)
                )
            """)
            os.chmod(args.checkpoint, 0o600)
            counts = Counter()
            cursor = ZERO_UUID

            def report(phase, waiting=False):
                save_status(args.status, dict(
                    running=phase == "backing_up", complete=phase == "caught_up",
                    phase=phase, waiting=waiting, completed=sum(counts.values()), matched=counts["linked"],
                    skipped=sum(counts[name] for name in ("unsupported","video_needs_review","link_needs_review")),
                    failed=counts["retry"],
                ))

            async def wait_for_indexing():
                if await priority.wait_async(lambda phase: report(phase, waiting=True)):
                    report("backing_up")

            while True:
                await priority.wait_async(lambda phase: report(phase, waiting=True))
                ready = not args.apply or comparison_complete(args.comparison)
                phase = "backing_up" if ready else "waiting_for_flickr_match"
                if ready:
                    report(phase)
                    cursor = await back_up(main, args, checkpoint, cursor, counts, wait_for_indexing)
                    if cursor is None:
                        phase = "caught_up"
                report(phase)
                if not args.watch:
                    print(dict(counts), flush=True)
                    return
                if cursor is None:
                    cursor = ZERO_UUID
                    await asyncio.sleep(3600)
                elif not ready:
                    await asyncio.sleep(60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--item-delay", type=float, default=1)
    parser.add_argument("--checkpoint", type=Path, default=Path("/app/flickr-backup/backup.sqlite"))
    parser.add_argument("--status", type=Path, default=Path("/app/data") / STATUS_FILE)
    parser.add_argument("--comparison", type=Path, default=Path("/app/data") / MATCH_STATUS)
    options = parser.parse_args()
    if not 1 <= options.batch_size <= 128 or options.item_delay < 0:
        parser.error("Invalid batch size or item delay")
    asyncio.run(run(options))
