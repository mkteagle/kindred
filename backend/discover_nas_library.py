#!/usr/bin/env python3
"""Register media in place: bounded batches, no original copies, hashes or ML."""
from __future__ import annotations
import argparse
import fcntl
import json
import mimetypes
import os
import stat as stat_mode
from pathlib import Path
import time
import uuid
from contextlib import closing
from dataclasses import dataclass
import psycopg2
import throttle
from psycopg2.extras import execute_values
from capture_date import parse_filename_datetime
from nas_browser import IMAGES, VIDEOS

RAW = {'.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2'}
MORE_VIDEO = {'.mts', '.m2v', '.m4p', '.ogg', '.ogv'}


@dataclass(frozen=True)
class SourceFile:
    relative_path: str
    size: int
    mtime_ns: int
    media_type: str
    photo_id: str
    taken_at: object = None


def source_file(root: Path, path: Path, source_key='family-photos'):
    relative = path.relative_to(root).as_posix()
    extension = path.suffix.lower()
    if extension not in IMAGES | VIDEOS | RAW | MORE_VIDEO or path.is_symlink():
        return None
    stat = path.stat()
    if not stat_mode.S_ISREG(stat.st_mode) or stat.st_size == 0:
        return None
    kind = 'video' if extension in VIDEOS | MORE_VIDEO else 'image'
    mime = mimetypes.guess_type(path.name)[0]
    if not mime or not mime.startswith(kind + '/'):
        mime = kind + '/x-raw' if kind == 'image' else 'video/octet-stream'
    identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f'kindred:source:{source_key}:{relative}'))
    return SourceFile(relative, stat.st_size, stat.st_mtime_ns, mime, identity,
                      parse_filename_datetime(path.name))


def register_batch(connection, rows, source_key='family-photos'):
    if not rows:
        return 0
    with connection.cursor() as cur:
        cur.execute('SELECT relative_path, byte_size, mtime_ns FROM nas_source_files WHERE source_key=%s AND relative_path=ANY(%s)',
                    (source_key, [row.relative_path for row in rows]))
        known = {path: (size, modified) for path, size, modified in cur.fetchall()}
        changed = [row for row in rows if known.get(row.relative_path) != (row.size, row.mtime_ns)]
        if not changed:
            connection.commit()
            return 0
        execute_values(cur, '''INSERT INTO photos (id, original_filename, media_type, byte_size, title, taken_at)
            VALUES %s ON CONFLICT (id) DO UPDATE SET byte_size=EXCLUDED.byte_size, updated_at=now()''',
            [(row.photo_id, Path(row.relative_path).name, row.media_type, row.size,
              Path(row.relative_path).stem, row.taken_at) for row in changed], page_size=1000)
        # source paths are read-only pointers, not verified off-site backups.
        execute_values(cur, '''INSERT INTO photo_copies (photo_id, provider, provider_key, storage_path, byte_size, status)
            VALUES %s ON CONFLICT (photo_id,provider) DO UPDATE SET provider_key=EXCLUDED.provider_key,
            storage_path=EXCLUDED.storage_path, byte_size=EXCLUDED.byte_size, status='available', updated_at=now()''',
            [(row.photo_id, 'nas', 'library/' + row.relative_path, 'library/' + row.relative_path,
              row.size, 'available') for row in changed], page_size=1000)
        execute_values(cur, '''INSERT INTO nas_source_files (source_key, relative_path, photo_id, byte_size, mtime_ns)
            VALUES %s ON CONFLICT (source_key,relative_path) DO UPDATE SET byte_size=EXCLUDED.byte_size,
            mtime_ns=EXCLUDED.mtime_ns, preview_ready_at=NULL, metadata_ready_at=NULL,
            preview_error=NULL, ml_error=NULL, seen_at=now()''',
            [(source_key, row.relative_path, row.photo_id, row.size, row.mtime_ns) for row in changed], page_size=1000)
    connection.commit()
    return sum(row.relative_path not in known for row in changed)


def save_status(path, status):
    path.parent.mkdir(parents=True, exist_ok=True)
    status['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(status));temporary.replace(path)


def run(args):
    root = Path(args.source).resolve()
    if not root.is_dir():
        raise RuntimeError('The configured photo tree is unavailable')
    state = Path(args.status)
    state.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_path = state.with_suffix('.checkpoint.json')
    checkpoint = dict(source=str(root),source_key=args.source_key,completed_dirs={},complete=False)
    try:
        saved = json.loads(checkpoint_path.read_text())
        if saved.get('source') == str(root) and saved.get('source_key') == args.source_key:
            checkpoint = saved
    except (OSError,ValueError):
        pass
    started=time.monotonic();last=started;last_checkpoint=started;batch=[];pending_dirs={};seen=0
    status=dict(running=True,phase='resuming_discovery',found=0,registered=0,unchanged=0,folders=0,errors=0,complete=False)
    with state.with_suffix('.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with closing(psycopg2.connect(os.environ['DATABASE_URL'])) as connection:
            with connection.cursor() as cursor:
                # One grouped read recovers already cataloged folders from older
                # workers too. Complete folders need no per-file stat/read/UPSERT.
                cursor.execute('''SELECT CASE WHEN strpos(relative_path,'/')>0
                    THEN regexp_replace(relative_path,'/[^/]+$','') ELSE '' END AS directory,
                    count(*) FROM nas_source_files WHERE source_key=%s GROUP BY 1''',(args.source_key,))
                known_folders=dict(cursor.fetchall())
            connection.commit()
            status['registered']=sum(known_folders.values());status['found']=status['registered']
            if checkpoint.get('complete') and not getattr(args,'rescan',False) and not args.limit:
                status.update(running=False,phase='complete',complete=True)
                save_status(state,status);print(json.dumps(status),flush=True);return
            status['phase']='discovering';save_status(state,status)

            def flush():
                nonlocal batch,pending_dirs,last_checkpoint
                if batch:
                    added=register_batch(connection,batch,args.source_key)
                    status['registered']+=added;status['found']=status['registered'];batch=[]
                # Only checkpoint completed folders whose final DB batch committed.
                if not args.limit:checkpoint['completed_dirs'].update(pending_dirs)
                pending_dirs={}
                if not args.limit and time.monotonic()-last_checkpoint>=15:
                    save_status(checkpoint_path,checkpoint);last_checkpoint=time.monotonic()
                status['elapsed_seconds']=round(time.monotonic()-started,1)
                save_status(state,status)

            def walk_error(error):status['errors']+=1
            for directory,dirs,files in os.walk(root,onerror=walk_error,followlinks=False):
                dirs[:]=sorted([name for name in dirs if not name.startswith('.') and name not in ('@eaDir','@Recycle')],
                               key=lambda name:(name.isdigit(),name),reverse=True)
                status['folders']+=1
                relative=Path(directory).relative_to(root).as_posix()
                if relative=='.':relative=''
                try:mtime=Path(directory).stat().st_mtime_ns
                except OSError:status['errors']+=1;continue
                candidates=[name for name in files if Path(name).suffix.lower() in IMAGES|VIDEOS|RAW|MORE_VIDEO]
                saved=checkpoint['completed_dirs'].get(relative)
                can_skip = not args.limit and not getattr(args,'rescan',False) and (
                    saved == [mtime,len(candidates)] or known_folders.get(relative,0)==len(candidates))
                if can_skip:
                    pending_dirs[relative]=[mtime,len(candidates)]
                else:
                    for name in candidates:
                        try:row=source_file(root,Path(directory)/name,args.source_key)
                        except OSError:status['errors']+=1;continue
                        if row is None:continue
                        seen+=1;batch.append(row)
                        if len(batch)>=args.batch_size:flush()
                        if args.limit and seen>=args.limit:break
                    pending_dirs[relative]=[mtime,len(candidates)]
                if len(pending_dirs)>=100 and not batch:flush()
                if time.monotonic()-last>=5:
                    status['elapsed_seconds']=round(time.monotonic()-started,1)
                    save_status(state,status);print(json.dumps(status),flush=True);last=time.monotonic()
                if args.limit and seen>=args.limit:break
            flush()
            complete=not args.limit and status['errors']==0
            checkpoint['complete']=complete
            if not args.limit:save_status(checkpoint_path,checkpoint)
    status.update(running=False,phase='complete' if complete else 'partial',complete=complete,elapsed_seconds=round(time.monotonic()-started,1))
    save_status(state,status);print(json.dumps(status),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('--source-key',default='family-photos')
    parser.add_argument('--status',default='/app/data/nas-discovery-status.json')
    parser.add_argument('--batch-size',type=int,default=10000)
    parser.add_argument('--rescan',action='store_true',help='Explicitly recheck an already completed source scan')
    parser.add_argument('--limit',type=int)
    run(parser.parse_args())
