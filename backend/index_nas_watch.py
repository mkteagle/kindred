#!/usr/bin/env python3
"""Keep bounded recognition batches warm while discovery/previews add work."""
import argparse
import asyncio
import os
from contextlib import closing
import psycopg2
from pathlib import Path
import time
import index_nas_library as indexer
from discover_nas_library import save_status
from library_progress import progress


async def watch_locked():
    os.nice(10)
    state=Path('/app/data/nas-recognition-status.json')
    args=argparse.Namespace(limit=32,defer_clustering=True,library_only=True)
    status=dict(running=True,phase='recognition',batches=0,waiting=False,completed=0,failed=0)
    def on_progress(position, completed, failed):
        status.update(batch_position=position, batch_completed=completed, batch_failed=failed)
        save_status(state,status)
    args.on_progress = on_progress
    while True:
        if os.environ.get('KINDRED_PREVIEWS_FIRST','1') == '1':
            discovery = progress().get('discovery') or {}
            pending_previews = indexer.main.db_query("SELECT 1 FROM nas_source_files WHERE preview_ready_at IS NULL AND preview_error IS NULL LIMIT 1")
            if not discovery.get('complete') or pending_previews:
                status.update(phase='waiting_for_previews',waiting=True)
                save_status(state,status)
                await asyncio.sleep(10)
                continue
        status['phase']='recognition'
        if not indexer.pending(1,library_only=True):
            status['waiting']=True;save_status(state,status);await asyncio.sleep(10);continue
        status['waiting']=False;save_status(state,status)
        result=await indexer.run(args)
        status['batches']+=1;status['last_batch_exit']=result
        status['completed'] += status.get('batch_completed', 0)
        status['failed'] += status.get('batch_failed', 0)
        save_status(state,status)
        await asyncio.sleep(1)


def run():
    with closing(psycopg2.connect(os.environ['DATABASE_URL'])) as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_try_advisory_lock(4921733105)')
            if not cursor.fetchone()[0]:
                raise RuntimeError('A recognition worker is already running')
        connection.commit()
        asyncio.run(watch_locked())


if __name__=='__main__':run()
