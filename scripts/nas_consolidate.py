#!/usr/bin/env python3
"""NAS-local exact-content Takeout cleanup; never alters library files or ZIPs."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import time
import urllib.request

MEDIA = {'.jpg','.jpeg','.heic','.heif','.png','.gif','.webp','.tif','.tiff','.dng','.cr2','.cr3','.nef','.arw','.raf','.orf','.rw2','.mov','.mp4','.m4v','.avi','.mts','.m2ts','.3gp','.mpg','.mpeg','.mkv'}

def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=True))
    tmp.replace(path)

def encode_path(path):
    path = str(path)
    try:
        path.encode('utf-8')
        return path
    except UnicodeEncodeError:
        return '@fshex:' + os.fsencode(path).hex()

def decode_path(path):
    return os.fsdecode(bytes.fromhex(path[7:])) if path.startswith('@fshex:') else path

def identity(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)

def fingerprint(path, beat, sample=False):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('not a regular file')
        h = hashlib.sha256()
        if sample:
            for offset in sorted({0, max(0, before.st_size // 2 - 32768), max(0, before.st_size - 65536)}):
                stream.seek(offset)
                h.update(stream.read(65536))
        else:
            while True:
                chunk = stream.read(4 * 1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
                beat(bytes_read=len(chunk))
                # Limit sequential reads to roughly 64 MiB/s, leaving NAS I/O available.
                time.sleep(len(chunk) / (64 * 1024 * 1024))
        if identity(before) != identity(os.fstat(stream.fileno())):
            raise ValueError('file changed during verification')
    return h.hexdigest(), identity(before)

def verified_remove(source, canonical, receipt, beat):
    source, canonical = Path(source), Path(canonical)
    if source.resolve() == canonical.resolve() or source.is_symlink() or canonical.is_symlink():
        raise ValueError('unsafe path')
    digest, src_stat = fingerprint(source, beat)
    other, dst_stat = fingerprint(canonical, beat)
    if digest != other:
        return False
    if identity(source.lstat()) != src_stat or identity(canonical.lstat()) != dst_stat:
        raise ValueError('file changed before removal')
    receipt(digest, src_stat[2])  # Durable evidence must precede unlink.
    source.unlink()
    return True

class Job:
    def __init__(self, config):
        self.c = config
        self.root = Path(config['state_dir']); self.root.mkdir(parents=True, exist_ok=True)
        self.status = {'phase':'starting', 'bytes_read':0, 'updated_at':time.time()}
        self.last = 0
        self.db = sqlite3.connect(self.root / 'ledger.sqlite3')
        self.db.executescript('''
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS canonical(path TEXT PRIMARY KEY,size INTEGER);
        CREATE INDEX IF NOT EXISTS canonical_size ON canonical(size);
        CREATE TABLE IF NOT EXISTS folders(path TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS checked(path TEXT PRIMARY KEY,status TEXT,canonical TEXT,sha256 TEXT,size INTEGER,error TEXT);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
        ''')
    def beat(self, bytes_read=0, force=False, **values):
        self.status['bytes_read'] += bytes_read
        self.status.update(values)
        if force or time.monotonic() - self.last >= 5:
            self.status['updated_at'] = time.time()
            atomic_json(self.root / 'status.json', self.status)
            runtime = Path(self.c.get('heartbeat', '/tmp/kindred-consolidation-heartbeat.json'))
            atomic_json(runtime, self.status)
            self.last = time.monotonic()
    def scan(self):
        library = Path(self.c['library']).resolve()
        self.beat(phase='inventory_library', force=True)
        def fail(error):
            raise error
        for parent, dirs, files in os.walk(library, followlinks=False, onerror=fail):
            dirs[:] = [d for d in dirs if not Path(parent,d).is_symlink()]
            if self.db.execute('SELECT 1 FROM folders WHERE path=?',(encode_path(parent),)).fetchone():
                continue
            rows=[]
            for name in files:
                p=Path(parent,name)
                if p.suffix.lower() in MEDIA and not p.is_symlink():
                    s=p.stat()
                    if stat.S_ISREG(s.st_mode) and s.st_size:
                        rows.append((encode_path(p),s.st_size))
            with self.db:
                self.db.executemany('INSERT OR REPLACE INTO canonical VALUES(?,?)',rows)
                self.db.execute('INSERT INTO folders VALUES(?)',(encode_path(parent),))
            self.beat(current_directory=parent)
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES('inventory_complete','1')")
    def run(self):
        while True:
            try:
                discovery=json.loads(Path(self.c['discovery_status']).read_text())
                self.status['discovery_updated_at'] = discovery.get('updated_at')
                if discovery.get('complete') is True and discovery.get('phase') == 'complete':
                    break
            except (OSError, ValueError):
                pass
            self.beat(phase='waiting_for_discovery', force=True)
            time.sleep(30)
        if not self.db.execute("SELECT 1 FROM settings WHERE key='inventory_complete'").fetchone():
            self.scan()
        self.beat(phase='verify_takeout_duplicates', force=True)
        library = Path(self.c['library']).resolve()
        for root in self.c['staging']:
            root = Path(root).resolve()
            if root == library or library in root.parents or root in library.parents:
                raise ValueError('staging and library overlap')
            for parent, dirs, files in os.walk(root, followlinks=False, onerror=lambda e: (_ for _ in ()).throw(e)):
                dirs[:] = [d for d in dirs if not Path(parent,d).is_symlink()]
                for name in files:
                    source = Path(parent,name)
                    if source.suffix.lower() not in MEDIA or source.is_symlink():
                        continue
                    key=encode_path(source)
                    previous = self.db.execute('SELECT status FROM checked WHERE path=?',(key,)).fetchone()
                    if previous and previous[0] != 'verified_pending_unlink':
                        continue
                    self.beat(current_file=key)
                    try:
                        size=source.stat().st_size
                        candidates=self.db.execute('SELECT path FROM canonical WHERE size=?',(size,)).fetchall() if size else []
                        matched=False
                        sample=None
                        for (target,) in candidates:
                            canonical=Path(decode_path(target))
                            if not canonical.is_file() or canonical.is_symlink() or not canonical.resolve().is_relative_to(library):
                                continue
                            if sample is None:
                                sample,_=fingerprint(source,self.beat,True)
                            other,_=fingerprint(canonical,self.beat,True)
                            if sample != other:
                                continue
                            def receipt(digest, count):
                                with self.db:
                                    self.db.execute('INSERT OR REPLACE INTO checked VALUES(?,?,?,?,?,NULL)',(key,'verified_pending_unlink',target,digest,count))
                            if verified_remove(source,canonical,receipt,self.beat):
                                with self.db:
                                    self.db.execute("UPDATE checked SET status='removed_exact_duplicate' WHERE path=?",(key,))
                                matched=True
                                break
                        if not matched:
                            with self.db:
                                self.db.execute('INSERT OR REPLACE INTO checked VALUES(?,?,NULL,NULL,?,NULL)',(key,'retained_no_exact_match',size))
                    except (OSError,ValueError) as error:
                        with self.db:
                            self.db.execute('INSERT OR REPLACE INTO checked VALUES(?,?,NULL,NULL,0,?)',(key,'retained_error',str(error)))
                    self.beat()
        # An interrupted unlink can leave a committed receipt after the directory entry vanished.
        for (key,) in self.db.execute("SELECT path FROM checked WHERE status='verified_pending_unlink'").fetchall():
            if not Path(decode_path(key)).exists():
                with self.db:
                    self.db.execute("UPDATE checked SET status='removed_exact_duplicate' WHERE path=?",(key,))
        totals={r[0]:{'files':r[1],'bytes':r[2]} for r in self.db.execute('SELECT status,count(*),sum(size) FROM checked GROUP BY status')}
        self.beat(phase='complete', totals=totals, note='Raw ZIPs, sidecars and unmatched originals retained. Library-internal deduplication is not included.', force=True)
        atomic_json(self.root/'report.json',self.status)

def notify(config, event, status):
    env={}
    secret=Path(config['resend_env'])
    if not secret.exists():
        return False
    for line in secret.read_text().splitlines():
        if '=' in line:
            k,v=line.split('=',1);env[k]=v.strip().strip('"').strip("'")
    if not env.get('RESEND_API_KEY') or not env.get('RESEND_FROM_EMAIL'):
        return False
    payload={'from':env['RESEND_FROM_EMAIL'],'to':[config['email']], 'subject':'Kindred NAS: '+event, 'text':json.dumps(status,indent=2)}
    req=urllib.request.Request('https://api.resend.com/emails',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+env['RESEND_API_KEY'],'Content-Type':'application/json','User-Agent':'KindredNAS/1.0'},method='POST')
    with urllib.request.urlopen(req,timeout=25) as response:
        return response.status < 300

def watch(config):
    root=Path(config['state_dir']); ledger=root/'notifications.json'
    sent=json.loads(ledger.read_text()) if ledger.exists() else {}
    while True:
        try:
            p=Path(config.get('heartbeat','/tmp/kindred-consolidation-heartbeat.json'))
            state=json.loads(p.read_text())
            age=time.time()-state['updated_at']
            phase=state['phase']
            if phase == 'waiting_for_discovery' and state.get('discovery_updated_at'):
                from datetime import datetime
                age = max(age, time.time()-datetime.fromisoformat(state['discovery_updated_at'].replace('Z','+00:00')).timestamp())
            event='cleanup pass finished — review retained files' if phase=='complete' else 'job failed' if phase=='failed' else 'job stalled' if age>1800 else None
            if event and event not in sent and notify(config,event,state):
                sent[event]=time.time();atomic_json(ledger,sent)
        except Exception:
            pass  # Retry delivery; a missing sender never stops cleanup.
        time.sleep(30)

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--watch',action='store_true');args=p.parse_args()
    config=json.loads(Path(args.config).read_text())
    if args.watch:
        watch(config);return
    Path(config['state_dir']).mkdir(parents=True,exist_ok=True)
    with open(Path(config['state_dir'])/'worker.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        job=Job(config)
        if (job.root/'report.json').exists():
            job.status=json.loads((job.root/'report.json').read_text());job.beat(force=True);return
        try:
            job.run()
        except Exception as error:
            job.beat(phase='failed',error=str(error),force=True)
            raise
if __name__=='__main__':
    main()
