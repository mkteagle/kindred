#!/usr/bin/env python3
"""Recover only context-matched originals; remove confirmed empty placeholders."""
import collections
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import time
import uuid
import zipfile

BASE=Path('/volume1/docker/Files/kindred/deploy/ugreen/data')
ROOT=BASE/'empty-media-recovery'
LIBRARY=Path('/volume1/Family/Photos')


def atomic(path,value):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=True,indent=2));tmp.replace(path)

def identity(st):return (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)

def empty_identity(path):
    st=path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_size!=0:raise ValueError('Target is no longer an empty regular file')
    return identity(st)

def remove_empty(path,expected):
    if empty_identity(path)!=expected:raise ValueError('Target changed before removal')
    path.unlink()

def digest(path,beat=lambda:None):
    h=hashlib.sha256()
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        before=identity(os.fstat(stream.fileno()))
        if not before[2]:raise ValueError('Recovery source is empty')
        while True:
            block=stream.read(4*1024*1024)
            if not block:break
            h.update(block);beat()
        if before!=identity(os.fstat(stream.fileno())):raise ValueError('Recovery source changed')
    return h.hexdigest(),before

def confidence(target,source):
    """A reused basename alone never establishes which original was intended."""
    t=Path(target);parts=[p.casefold() for p in Path(source).parts]
    score=0
    years=set(re.findall(r'(?<!\d)(?:19|20)\d{2}(?!\d)',str(t.parent)))
    source_years=set(re.findall(r'(?<!\d)(?:19|20)\d{2}(?!\d)',str(Path(source).parent)))
    if years and source_years and not years.intersection(source_years):return 0
    if years.intersection(source_years):score+=3
    parent=t.parent.name.casefold()
    if parent and not parent.isdigit() and not re.fullmatch(r'\d{2} [a-z]+',parent) and parent in parts:
        score+=10
    for p in t.parent.parts:
        if re.fullmatch(r'\d{2} [A-Za-z]+',p) and p.casefold() in parts:score+=3
    return score


def run():
    ROOT.mkdir(parents=True,exist_ok=True);ROOT.chmod(0o700)
    completed=ROOT/'repair-report.json'
    if completed.exists():
        report=json.loads(completed.read_text())
        if report.get('phase')=='complete' and report.get('remaining_empty')==0:
            return  # Never overwrite later inventory/discovery results on NAS boot.
    lock=(ROOT/'repair.lock').open('a+');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    snapshot=ROOT/'original-inventory.json'
    if not snapshot.exists():snapshot.write_bytes((BASE/'backend/nas-folder-inventory.json').read_bytes())
    for baseline in [snapshot,ROOT/'original-audit.json']:
        with baseline.open('rb') as stream:os.fsync(stream.fileno())
    c=sqlite3.connect(ROOT/'plan.sqlite3',timeout=30)
    c.execute('PRAGMA synchronous=NORMAL')
    c.execute('''CREATE TABLE IF NOT EXISTS repairs(target TEXT PRIMARY KEY,status TEXT,source TEXT,sha256 TEXT,size INTEGER,error TEXT)''');c.commit()
    state={'phase':'waiting_for_source_audit','updated_at':time.time()}
    last=0
    def beat(force=False,**extra):
        nonlocal last
        state.update(extra)
        if force or time.monotonic()-last>=3:
            state['updated_at']=time.time();atomic(ROOT/'repair-status.json',state);last=time.monotonic()
    def record(target,status,source=None,sha=None,size=0,error=None):
        c.execute('INSERT OR REPLACE INTO repairs VALUES(?,?,?,?,?,?)',(target,status,source,sha,size,error));c.commit()
    while not all(c.execute('SELECT 1 FROM settings WHERE key=?',(k,)).fetchone() for k in ['archives_complete','flickr_catalog_complete']):
        beat(force=True);time.sleep(15)
    beat(phase='recovering_empty_media',force=True)
    for (relative,) in c.execute('SELECT path FROM targets ORDER BY path').fetchall():
        old=c.execute('SELECT status FROM repairs WHERE target=?',(relative,)).fetchone()
        if old and old[0] not in ('prepared_delete','prepared_restore','retry_error'):continue
        target=LIBRARY/relative
        beat(current_file=relative)
        try:
            if not target.resolve().is_relative_to(LIBRARY.resolve()):raise ValueError('Target escapes the library')
            if not target.exists():
                record(relative,'deleted_empty' if old and old[0]=='prepared_delete' else 'already_absent');continue
            if target.is_file() and not target.is_symlink() and target.stat().st_size>0:
                record(relative,'already_nonempty');continue
            expected=empty_identity(target)
            def remove_placeholder(label,reason):
                record(relative,'prepared_delete',error=reason)
                remove_empty(target,expected);record(relative,label,error=reason)
            rows=c.execute('SELECT kind,path,member,size,crc FROM candidates WHERE target=? AND (size>0 OR kind=\'flickr\')',(relative,)).fetchall()
            if not rows:
                record(relative,'prepared_delete')
                remove_empty(target,expected);record(relative,'deleted_no_recoverable_source');continue
            files=[r for r in rows if r[0]=='file' and confidence(relative,r[1])>=6]
            files.sort(key=lambda r:confidence(relative,r[1]),reverse=True)
            live=[]
            for row in files[:24]:
                p=Path(row[1])
                if p.is_file() and not p.is_symlink() and p.stat().st_size:
                    live.append(row)
            if live:
                best=confidence(relative,live[0][1]);live=[r for r in live if confidence(relative,r[1])==best]
                hashes=[]
                for row in live:
                    sha,s=digest(Path(row[1]),beat);hashes.append((sha,s,row))
                if len({r[0] for r in hashes})!=1:
                    remove_placeholder('deleted_empty_candidates_preserved','Different originals match the album/date context');continue
                sha,s,row=hashes[0];source=Path(row[1])
                canonical=next((r for r in hashes if Path(r[2][1]).resolve().is_relative_to(LIBRARY.resolve())),None)
                if canonical:
                    sha,s,row=canonical;source=Path(row[1])
                    if identity(source.stat())!=s:raise ValueError('Canonical original changed')
                    record(relative,'prepared_delete',str(source),sha,s[2])
                    remove_empty(target,expected);record(relative,'already_preserved_elsewhere',str(source),sha,s[2]);continue
                temp=target.with_name('.kindred-recovery-'+uuid.uuid4().hex+target.suffix)
                try:
                    os.link(source,temp)
                    if identity(source.stat())[:4]!=s[:4] or empty_identity(target)!=expected:raise ValueError('Source or target changed')
                    record(relative,'prepared_restore',str(source),sha,s[2])
                    os.replace(temp,target);record(relative,'restored',str(source),sha,s[2])
                finally:temp.unlink(missing_ok=True)
                continue
            archives=[r for r in rows if r[0]=='archive' and confidence(relative,r[2])>=6]
            if archives:
                best=max(confidence(relative,r[2]) for r in archives)
                archives=[r for r in archives if confidence(relative,r[2])==best]
                if len({(r[3],r[4]) for r in archives})!=1:
                    remove_placeholder('deleted_empty_candidates_preserved','Archive originals differ');continue
                recovered=False
                for row in archives:
                    temp=target.with_name('.kindred-recovery-'+uuid.uuid4().hex+target.suffix)
                    try:
                        h=hashlib.sha256();count=0
                        with zipfile.ZipFile(row[1]) as archive:
                            info=archive.getinfo(row[2])
                            if info.file_size!=row[3] or info.CRC!=row[4]:raise ValueError('Archive member changed')
                            with archive.open(info) as src,temp.open('xb') as dst:
                                while True:
                                    block=src.read(4*1024*1024)
                                    if not block:break
                                    dst.write(block);h.update(block);count+=len(block);beat()
                                dst.flush();os.fsync(dst.fileno())
                        if count!=row[3] or not count:raise ValueError('Incomplete recovery')
                        if empty_identity(target)!=expected:raise ValueError('Target changed')
                        record(relative,'prepared_restore',row[1]+'::'+row[2],h.hexdigest(),count)
                        os.replace(temp,target);record(relative,'restored',row[1]+'::'+row[2],h.hexdigest(),count)
                        recovered=True;break
                    except (OSError,ValueError,zipfile.BadZipFile,KeyError):
                        continue
                    finally:temp.unlink(missing_ok=True)
                if recovered:continue
                remove_placeholder('deleted_empty_sources_preserved','Matching archive originals could not be read');continue
            remove_placeholder('deleted_empty_candidates_preserved','Filename matches exist but album/date identity is unconfirmed')
        except FileNotFoundError:
            record(relative,'already_absent')
        except Exception as error:
            record(relative,'retry_error',error=str(error)[:500])
    restored=[r[0] for r in c.execute("SELECT target FROM repairs WHERE status IN ('restored','already_nonempty')")]
    if restored:
        beat(phase='registering_recovered_originals',force=True)
        code="""import os,json,psycopg2
from pathlib import Path
from discover_nas_library import source_file,register_batch
root=Path('/data/library')
paths=PATHS
rows=[source_file(root,root/p) for p in paths]
with psycopg2.connect(os.environ['DATABASE_URL']) as connection:
 print('registered_recoveries',register_batch(connection,[r for r in rows if r is not None]))
""".replace('PATHS',repr(restored))
        subprocess.run(['/usr/bin/docker','exec','-i','kindred-api-1','python','-'],input=code.encode(),check=True)
    original=json.loads((ROOT/'original-audit.json').read_text())
    remaining=[];deleted=[];recovered=[]
    for f in original['files']:
        p=LIBRARY/f['path']
        try:
            s=p.lstat()
            if stat.S_ISREG(s.st_mode) and s.st_size==0:remaining.append(f)
            elif stat.S_ISREG(s.st_mode) and s.st_size>0:recovered.append(f)
        except FileNotFoundError:deleted.append(f)
    inventory_path=BASE/'backend/nas-folder-inventory.json';inventory=json.loads((ROOT/'original-inventory.json').read_text())
    images=sum(Path(f['path']).suffix.lower()!='.mov' for f in deleted)
    inventory['photos']-=images;inventory['videos']-=len(deleted)-images
    inventory['media_files']=inventory['photos']+inventory['videos']
    atomic(inventory_path,inventory)
    eligible=original['catalog_total']+len(recovered)
    audit={**original,'catalog_total':eligible,'inventory_total':inventory['media_files'],
           'checkpoint_candidates':inventory['media_files'],'candidate_gap':len(remaining),
           'exclusions':{'empty_file':len(remaining)},'files':remaining,
           'unexplained_candidate_gap':inventory['media_files']-eligible-len(remaining)}
    atomic(BASE/'backend/nas-discovery-reconciliation.json',audit)
    discovery_path=BASE/'backend/nas-discovery-status.json';discovery=json.loads(discovery_path.read_text())
    discovery.update(registered=eligible,found=eligible);atomic(discovery_path,discovery)
    totals={status:count for status,count in c.execute('SELECT status,count(*) FROM repairs GROUP BY status')}
    beat(phase='complete',totals=totals,remaining_empty=len(remaining),force=True)
    atomic(ROOT/'repair-report.json',state)
    print(json.dumps(totals),flush=True)

if __name__=='__main__':
    try:run()
    except Exception as error:
        atomic(ROOT/'repair-status.json',{'phase':'failed','updated_at':time.time(),'error':str(error)[:500]})
        raise
