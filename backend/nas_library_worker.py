#!/usr/bin/env python3
"""Supervise checkpoint import and local indexing independently of the API."""
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


def phase(name, args):
    status(phase=name, pid=os.getpid(), source=SOURCE)
    with (DATA / ('nas-worker-' + name + '.log')).open('a', buffering=1) as log:
        log.write('\n[worker] Starting ' + time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
        return subprocess.call([sys.executable, '-u', *args], stdout=log, stderr=subprocess.STDOUT)


def run():
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA / 'nas-library-worker.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('A NAS library worker is already running', flush=True)
            return 0
        # A failed mirror must not prevent local indexing. Preserve individual
        # phase results and retry failures after a cooldown, without API restarts.
        attempt = 0
        while True:
            attempt += 1
            imported = phase('import', [str(SCRIPTS / 'resume_nas_library.py'), SOURCE,
                                      '--progress', str(DATA / 'staged-import-progress.json'), '--defer-analysis'])
            indexed = phase('index', [str(SCRIPTS / 'index_nas_library.py')])
            if imported == 0 and indexed == 0:
                status(phase='complete', import_exit=0, index_exit=0, attempts=attempt)
                return 0
            status(phase='retry_wait', import_exit=imported, index_exit=indexed,
                   attempts=attempt, retry_in_seconds=300)
            time.sleep(300)


if __name__ == '__main__':
    raise SystemExit(run())
