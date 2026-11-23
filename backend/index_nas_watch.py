#!/usr/bin/env python3
"""Schedule bounded NAS recognition work after discovery and previews."""

import argparse
import asyncio
from concurrent.futures import ProcessPoolExecutor
from contextlib import closing, nullcontext
import multiprocessing
import os
import time

import psycopg2

from discover_nas_library import save_status
import index_nas_library as indexer
from junk_scanner import scan_batch
from worker_priority import DATA_DIR, IndexingPriority


async def watch_locked(executor, workers):
    state = DATA_DIR / "nas-recognition-status.json"
    priority = IndexingPriority(required=True)
    args = argparse.Namespace(limit=32, defer_clustering=True, library_only=True, workers=workers)
    status = dict(running=True, phase="recognition", batches=0, waiting=False,
                  completed=0, failed=0, workers=workers)

    def on_progress(position, completed, failed):
        status.update(batch_position=position, batch_completed=completed, batch_failed=failed)
        save_status(state, status)

    def on_wait(phase):
        status.update(phase=phase, waiting=True)
        save_status(state, status)

    args.on_progress = on_progress
    args.before_item = lambda: priority.blocking_phase() is None
    junk_cursor = None
    next_junk_scan = 0
    while True:
        await priority.wait_async(on_wait)
        if time.monotonic() >= next_junk_scan:
            try:
                junk_cursor = await asyncio.get_running_loop().run_in_executor(
                    executor, scan_batch, indexer.main.db_query, indexer.main.clip_embed_text, junk_cursor,
                )
                next_junk_scan = time.monotonic() + (5 if junk_cursor else 300)
            except Exception as exc:
                print(f"[junk] Classification paused after an error: {exc}", flush=True)
                next_junk_scan = time.monotonic() + 60

        if priority.blocking_phase():
            continue
        rows = indexer.pending(args.limit, library_only=True)
        status.update(phase="recognition", waiting=not rows)
        save_status(state, status)
        if not rows:
            await asyncio.sleep(10)
            continue
        result = await indexer.run(args, rows=rows, executor=executor)
        status["batches"] += 1
        status["last_batch_exit"] = result
        status["completed"] += status["batch_completed"]
        status["failed"] += status["batch_failed"]
        save_status(state, status)


def run():
    os.nice(10)
    workers = max(1, min(2, int(os.environ.get("KINDRED_RECOGNITION_WORKERS", "2"))))
    # Independent processes keep the inference models' mutable state isolated.
    # Spawn after taking the singleton lock so no child inherits its connection.
    with closing(psycopg2.connect(os.environ["DATABASE_URL"])) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_lock(4921733105)")
            if not cursor.fetchone()[0]:
                raise RuntimeError("A recognition worker is already running")
        connection.commit()
        pool = ProcessPoolExecutor(workers, mp_context=multiprocessing.get_context("spawn")) if workers > 1 else nullcontext()
        with pool as executor:
            asyncio.run(watch_locked(executor, workers))


if __name__ == "__main__":
    run()
