#!/usr/bin/env python3
"""Keep NAS categorization and face recognition moving in bounded batches."""
import argparse
import asyncio
from concurrent.futures import ProcessPoolExecutor
from contextlib import closing
import multiprocessing
import os
from pathlib import Path
import time

import psycopg2

from discover_nas_library import save_status
import index_nas_library as indexer
from junk_scanner import scan_batch
from library_progress import progress


async def watch_locked(executor, workers):
    os.nice(5)
    state = Path("/app/data/nas-recognition-status.json")
    args = argparse.Namespace(limit=64, defer_clustering=True, library_only=True, workers=workers)
    faces_enabled = os.environ.get("KINDRED_FACE_INDEXING", "1") == "1"
    wait_for_previews = os.environ.get("KINDRED_PREVIEWS_FIRST", "0") == "1"
    status = dict(running=True, phase="categories", batches=0, waiting=False,
                  completed=0, failed=0, workers=workers, split_stages=True,
                  faces_enabled=faces_enabled)

    def on_progress(position, completed, failed):
        status.update(batch_position=position, batch_completed=completed, batch_failed=failed)
        save_status(state, status)

    args.on_progress = on_progress
    junk_cursor = None
    next_junk_scan = 0
    loop = asyncio.get_running_loop()
    cursors = {}
    next_categories_check = 0.0
    next_grouping = 0.0
    category_batches = 0

    def next_rows(stage, limit=args.limit):
        before = cursors.get(stage)
        rows = indexer.pending(limit, library_only=True, stage=stage, before=before)
        if not rows and before is not None:
            cursors.pop(stage, None)
            rows = indexer.pending(limit, library_only=True, stage=stage)
        if rows:
            last = rows[-1]
            cursors[stage] = (last["index_date"], last["kindred_photo_id"])
        return rows

    while True:
        if wait_for_previews:
            discovery = progress().get("discovery") or {}
            pending = indexer.main.db_query(
                "SELECT 1 FROM nas_source_files WHERE preview_ready_at IS NULL AND preview_error IS NULL LIMIT 1"
            )
            if not discovery.get("complete") or pending:
                status.update(phase="waiting_for_previews", waiting=True)
                save_status(state, status)
                await asyncio.sleep(10)
                continue

        args.stage = "categories"
        rows = []
        if category_batches >= 3 and faces_enabled:
            args.stage = "faces"
            rows = next_rows(args.stage)
            category_batches = 0
        if not rows and time.monotonic() >= next_categories_check:
            args.stage = "categories"
            retries = indexer.pending_categorization_retries(16)
            fresh = next_rows(args.stage, args.limit - len(retries))
            rows = retries + fresh if fresh else indexer.pending_categorization_retries(args.limit)
            if not rows:
                next_categories_check = time.monotonic() + 30
        if not rows and faces_enabled:
            args.stage = "faces"
            rows = next_rows(args.stage)
        status.update(phase=args.stage if rows else "caught_up", waiting=not rows)
        save_status(state, status)

        if faces_enabled and time.monotonic() >= next_grouping:
            try:
                await asyncio.to_thread(indexer.main.group_pending_people)
            except Exception as exc:
                print(f"[people] Grouping paused after an error: {type(exc).__name__}", flush=True)
            next_grouping = time.monotonic() + 30

        if rows:
            category_batches = category_batches + 1 if args.stage == "categories" else 0
            result = await indexer.run(args, rows=rows, executor=executor)
            status["batches"] += 1
            status["last_batch_exit"] = result
            status["completed"] += status["batch_completed"]
            status["failed"] += status["batch_failed"]
            save_status(state, status)
            continue

        if time.monotonic() >= next_junk_scan:
            try:
                junk_cursor = await loop.run_in_executor(
                    executor, scan_batch, indexer.main.db_query, indexer.main.clip_embed_text, junk_cursor,
                )
                next_junk_scan = time.monotonic() + (5 if junk_cursor else 300)
            except Exception as exc:
                print(f"[junk] Classification paused after an error: {exc}", flush=True)
                next_junk_scan = time.monotonic() + 60
        await asyncio.sleep(10)


def run():
    workers = max(1, min(8, int(os.environ.get("KINDRED_RECOGNITION_WORKERS", "2"))))
    with closing(psycopg2.connect(os.environ["DATABASE_URL"])) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_lock(4921733105)")
            if not cursor.fetchone()[0]:
                raise RuntimeError("A recognition worker is already running")
        connection.commit()
        with ProcessPoolExecutor(workers, mp_context=multiprocessing.get_context("spawn")) as executor:
            asyncio.run(watch_locked(executor, workers))


if __name__ == "__main__":
    run()
