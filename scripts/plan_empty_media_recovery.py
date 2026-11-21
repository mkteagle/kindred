#!/usr/bin/env python3
"""Resume a metadata-only search for the audited empty media's recovery sources."""
import collections
import csv
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time
import urllib.parse
import yaml

BASE=Path('/volume1/docker/Files/kindred/deploy/ugreen/data')
ROOT=BASE/'empty-media-recovery'
ROOT.mkdir(parents=True,exist_ok=True)
DB=sqlite3.connect(ROOT/'plan.sqlite3')
DB.executescript('''PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS targets(path TEXT PRIMARY KEY,name TEXT);
CREATE TABLE IF NOT EXISTS candidates(target TEXT,kind TEXT,path TEXT,member TEXT,size INTEGER,crc INTEGER, UNIQUE(target,kind,path,member));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS names_done(name TEXT PRIMARY KEY);
''')

def status(phase,**extra):
    value={'phase':phase,'updated_at':time.time(),**extra}
    tmp=ROOT/'status.tmp';tmp.write_text(json.dumps(value));tmp.replace(ROOT/'status.json')

def decode(path):return os.fsdecode(bytes.fromhex(path[7:])) if path.startswith('@fshex:') else path

def flag(key,value):
    DB.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',(key,str(value)));DB.commit()

def get(key):
    r=DB.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone();return r[0] if r else None

if not get('targets_loaded'):
    audit=json.loads((BASE/'backend/nas-discovery-reconciliation.json').read_text())
    (ROOT/'original-audit.json').write_text(json.dumps(audit,ensure_ascii=True,indent=2))
    DB.executemany('INSERT OR IGNORE INTO targets VALUES(?,?)',[(f['path'],Path(f['path']).name) for f in audit['files']]);DB.commit();flag('targets_loaded',1)
if not get('casefold_lookup'):
    DB.execute('DELETE FROM names_done');flag('casefold_lookup',1)
by_name=collections.defaultdict(list)
for target,name in DB.execute('SELECT path,name FROM targets'):by_name[name].append(target)
folded=collections.defaultdict(list)
for name,targets in by_name.items():folded[name.casefold()].extend(targets)
source=sqlite3.connect('file:/home/mkteagle/photo-recovery-20261024/inventory.sqlite3?mode=ro',uri=True)
for name,targets in by_name.items():
    if DB.execute('SELECT 1 FROM names_done WHERE name=?',(name,)).fetchone():continue
    status('checking_recorded_originals',names_checked=DB.execute('SELECT count(*) FROM names_done').fetchone()[0],names_total=len(by_name))
    variants=sorted({name,name.lower(),name.upper(),Path(name).stem+Path(name).suffix.lower(),Path(name).stem+Path(name).suffix.upper()})
    rows=source.execute('SELECT path,size FROM files WHERE name IN ('+','.join('?' for _ in variants)+') AND size>0',variants).fetchall()
    for path,size in rows:
        for target in targets:DB.execute('INSERT OR IGNORE INTO candidates VALUES(?,?,?,?,?,?)',(target,'file',decode(path),'',size,None))
    DB.execute('INSERT INTO names_done VALUES(?)',(name,));DB.commit()

if not get('archives_complete'):
    cursor=int(get('archive_cursor') or 0);last=time.monotonic();scanned=cursor
    for rowid,archive,member,size,crc in source.execute('SELECT rowid,archive,name,size,crc FROM members WHERE rowid>? ORDER BY rowid',(cursor,)):
        scanned=rowid;name=Path(decode(member)).name.casefold()
        if name in folded:
            for target in folded[name]:DB.execute('INSERT OR IGNORE INTO candidates VALUES(?,?,?,?,?,?)',(target,'archive',decode(archive),decode(member),size,crc))
        if time.monotonic()-last>5:
            flag('archive_cursor',scanned);status('checking_archive_members',archive_rows_checked=scanned);last=time.monotonic()
    flag('archive_cursor',scanned);flag('archives_complete',1)

if not get('flickr_catalog_complete'):
    status('checking_flickr_catalog')
    config=yaml.safe_load((BASE/'deployments/configs/20261118-social-auth-api.yaml').read_text())
    e=config['services']['api']['environment'];e=dict(v.split('=',1) for v in e) if isinstance(e,list) else e
    u=urllib.parse.urlsplit(e['DATABASE_URL']);info=json.loads(subprocess.check_output(['/usr/bin/docker','inspect','kindred-database-1']))[0]
    ip=next(iter(info['NetworkSettings']['Networks'].values()))['IPAddress']
    env=dict(os.environ,PGHOST=ip,PGPORT='5432',PGUSER=urllib.parse.unquote(u.username),PGPASSWORD=urllib.parse.unquote(u.password),PGDATABASE=u.path[1:],PGCONNECT_TIMEOUT='8',PGOPTIONS='-c statement_timeout=90000')
    names=','.join("'"+name.replace("'","''")+"'" for name in folded)
    sql="COPY (SELECT p.original_filename,c.provider_key FROM photos p JOIN photo_copies c ON c.photo_id=p.id AND c.provider='flickr' AND c.status='available' WHERE lower(p.original_filename)=ANY(ARRAY["+names+"])) TO STDOUT WITH CSV"
    result=subprocess.run(['psql','-X','-q','-c',sql],env=env,capture_output=True,timeout=100)
    if result.returncode:raise RuntimeError(result.stderr.decode()[:500])
    for name,photo_id in csv.reader(io.StringIO(result.stdout.decode())):
        for target in folded[name.casefold()]:DB.execute('INSERT OR IGNORE INTO candidates VALUES(?,?,?,?,?,?)',(target,'flickr',photo_id,'',None,None))
    flag('flickr_catalog_complete',1)
summary={'targets':DB.execute('SELECT count(*) FROM targets').fetchone()[0],
 'with_recorded_file_candidates':DB.execute("SELECT count(DISTINCT target) FROM candidates WHERE kind='file'").fetchone()[0],
 'with_nonempty_archive_candidates':DB.execute("SELECT count(DISTINCT target) FROM candidates WHERE kind='archive' AND size>0").fetchone()[0],
 'with_flickr_candidates':DB.execute("SELECT count(DISTINCT target) FROM candidates WHERE kind='flickr'").fetchone()[0],
 'without_nonempty_candidates':DB.execute("SELECT count(*) FROM targets t WHERE NOT EXISTS(SELECT 1 FROM candidates c WHERE c.target=t.path AND (c.size>0 OR c.kind='flickr'))").fetchone()[0]}
status('recovery_sources_ready',**summary)
(ROOT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary),flush=True)
