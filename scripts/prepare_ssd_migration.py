#!/usr/bin/env python3
"""NAS-local online backup and manifest; never changes a disk or mount."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

BASE=Path('/volume1/docker/Files/kindred/deploy/ugreen/data')
ROOT=BASE/'ssd-migration'
ROOT.mkdir(parents=True,exist_ok=True);ROOT.chmod(0o700)
status={'phase':'preparing','updated_at':time.time()}

def save(**extra):
    status.update(extra,updated_at=time.time());p=ROOT/'status.tmp';p.write_text(json.dumps(status));p.replace(ROOT/'status.json')

try:
    for name in ['20261118-social-auth-api.yaml','20261118-library-workers.yaml']:
        destination=ROOT/('before-ssd-'+name)
        if not destination.exists():shutil.copy2(BASE/'deployments/configs'/name,destination)
        destination.chmod(0o600)
    for name in ['kindred-api-1','kindred-database-1','kindred-nas-previews','kindred-nas-recognition']:
        data=json.loads(subprocess.check_output(['/usr/bin/docker','inspect',name]))[0]
        manifest={'name':name,'image':data['Config']['Image'],'mounts':data['Mounts'],'started_at':data['State']['StartedAt']}
        manifest_path=ROOT/(name+'-mounts.json')
        if not manifest_path.exists():manifest_path.write_text(json.dumps(manifest,indent=2))
    archive=ROOT/'kindred-before-ssd.dump'
    if not archive.exists():
        save(phase='backing_up_database')
        partial=archive.with_suffix('.partial')
        fd=os.open(partial,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'wb') as output,(ROOT/'database-backup.stderr.log').open('wb') as errors:
            command=['/usr/bin/docker','exec','kindred-database-1','sh','-c','exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z1']
            subprocess.run(command,stdout=output,stderr=errors,check=True)
            output.flush();os.fsync(output.fileno())
        partial.replace(archive)
    save(phase='checking_backup_archive',backup_bytes=archive.stat().st_size)
    with archive.open('rb') as source,(ROOT/'database-backup-toc.txt').open('wb') as output:
        subprocess.run(['/usr/bin/docker','exec','-i','kindred-database-1','pg_restore','--list'],stdin=source,stdout=output,check=True)
    save(phase='ready',backup_bytes=archive.stat().st_size,note='Online backup and readable archive directory verified; no disks, cache policy, mounts or originals changed.')
except Exception as error:
    save(phase='failed',error=str(error)[:500]);raise
