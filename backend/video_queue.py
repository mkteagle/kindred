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


async def process(main, path):
    with path.with_name('job.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        job = json.loads(path.read_text())
        if job['status'] in ('done', 'failed') or job.get('next_attempt', 0) > time.time():
            return
        job.update(status='running', attempts=job['attempts'] + 1)
        video_mirror.save(path, job)
        replication_id = None
        try:
            photo_id = job['photo_id']
            if not main._existing_flickr_copy(photo_id):
                credentials = main.get_flickr_credentials()
                if not credentials:
                    raise RuntimeError('Flickr OAuth is not configured')
                replication_id = main._queue_flickr_replication(photo_id)
                main._set_replication_status(replication_id, 'running')
                metadata = job['metadata']
                flickr_id = await video_mirror.mirror(main, photo_id, Path(job['source']),
                    metadata['title'], metadata['description'], credentials, job['privacy'], metadata=metadata)
                # Only the complete set counts as a Flickr mirror.
                main._record_flickr_copy(photo_id, flickr_id, credentials.get('user_id', ''))
                main._set_replication_status(replication_id, 'done')
                main.invalidate_cache('timeline')
            job.update(status='done', error=None)
        except Exception as exc:
            error = f'{type(exc).__name__}: {exc}'[:1000]
            state = ('failed' if isinstance(exc, video_mirror.VideoRejected) else
                     'processing' if isinstance(exc, video_mirror.VideoProcessing) else 'retry')
            job.update(status=state, error=error, next_attempt=time.time() + 300)
            if replication_id is not None:
                main._set_replication_status(replication_id, 'failed' if state == 'failed' else 'retry', error)
            print(f"[video] {job['photo_id']}: {error}", flush=True)
        video_mirror.save(path, job)


async def run():
    import main
    root = queue_root()
    # One transcoder for the entire NAS, including container restart overlap.
    with (root / 'worker.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            for path in sorted(root.glob('*/job.json')):
                try:
                    await process(main, path)
                except Exception as exc:
                    print(f'[video] invalid job {path}: {type(exc).__name__}: {exc}', flush=True)
            await asyncio.sleep(15)


if __name__ == '__main__':
    asyncio.run(run())
