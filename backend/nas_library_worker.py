#!/usr/bin/env python3
"""Supervise one importer and one indexer independently of the API."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time

DATA = Path(os.environ.get('KINDRED_WORKER_DATA', '/app/data'))
SCRIPTS = Path(__file__).resolve().parent
SOURCE = os.environ.get('KINDRED_IMPORT_SOURCE', '/data/photos/imports/AllPhotos')


def status(**fields):
    fields['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    temporary = DATA / 'nas-worker-status.json.tmp'
    temporary.write_text(json.dumps(fields, indent=2))
    temporary.replace(DATA / 'nas-worker-status.json')


def launch(name, args):
    with (DATA / ('nas-worker-' + name + '.log')).open('a', buffering=1) as log:
        log.write('\n[worker] Starting ' + time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
        return subprocess.Popen([sys.executable, '-u', *args], stdout=log, stderr=subprocess.STDOUT)


def run_pass():
    importer = launch('import', [str(SCRIPTS / 'resume_nas_library.py'), SOURCE,
                               '--progress', str(DATA / 'staged-import-progress.json'), '--defer-analysis'])
    indexer = None
    final_index = False
    next_index = 0
    index_result = None
    try:
        while True:
            import_result = importer.poll()
            if indexer is not None:
                index_result = indexer.poll()
                if index_result is not None:
                    if final_index:
                        return import_result, index_result
                    indexer = None
                    next_index = time.monotonic() + (300 if index_result else 30)
            # Index current NAS photos immediately while uploads continue. A final
            # pass after import exits catches photos added after an earlier snapshot.
            if indexer is None and (import_result is not None or time.monotonic() >= next_index):
                final_index = import_result is not None
                indexer = launch('index', [str(SCRIPTS / 'index_nas_library.py')])
                index_result = None
            status(phase='indexing' if import_result is not None else 'importing_and_indexing',
                   pid=os.getpid(), import_pid=importer.pid, import_exit=import_result,
                   index_pid=indexer.pid if indexer else None, index_exit=index_result,
                   final_index_pass=final_index, source=SOURCE)
            time.sleep(5)
    finally:
        # If the supervisor itself errors, don't leave detached workers behind.
        for process in (importer, indexer):
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def run():
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA / 'nas-library-worker.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('A NAS library worker is already running', flush=True)
            return 0
        attempt = 0
        while True:
            attempt += 1
            imported, indexed = run_pass()
            if imported == 0 and indexed == 0:
                status(phase='complete', import_exit=0, index_exit=0, attempts=attempt)
                return 0
            status(phase='retry_wait', import_exit=imported, index_exit=indexed,
                   attempts=attempt, retry_in_seconds=300)
            time.sleep(300)


if __name__ == '__main__':
    raise SystemExit(run())
