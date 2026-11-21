"""Account-owned, resumable original-resource backups for the companion iOS app."""
from __future__ import annotations
from contextlib import contextmanager
from hashlib import sha256
import fcntl
import json
import os
from pathlib import Path
import time
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

CHUNK_BYTES = 8 * 1024 * 1024


class ResourcePlan(BaseModel):
    key: str = Field(min_length=1, max_length=1024)
    filename: str = Field(min_length=1, max_length=255)
    media_type: str = Field(max_length=150, pattern=r'^[a-zA-Z0-9.+_-]+/[a-zA-Z0-9.+_-]+$')
    is_primary: bool = False
    byte_size: int = Field(gt=0, le=100 * 1024**3)
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


class AssetPlan(BaseModel):
    device_id: uuid.UUID
    asset_identifier: str = Field(min_length=1, max_length=2000)
    revision: str = Field(pattern=r'^[0-9a-f]{64}$')
    created_at: float | None = None
    albums: list[str] = Field(default_factory=list, max_length=100)
    resources: list[ResourcePlan] = Field(min_length=1, max_length=32)


class PhoneBackupStore:
    def __init__(self, root):
        if not root:
            raise HTTPException(503, 'NAS upload storage is not configured')
        self.root = Path(root).resolve()

    def directory(self, owner, identity):
        return self.root / 'phone-backups' / str(uuid.UUID(str(owner))) / str(uuid.UUID(str(identity)))

    @contextmanager
    def locked(self, owner, identity, create=False):
        directory = self.directory(owner, identity)
        if create:
            directory.mkdir(parents=True, exist_ok=True)
        if not directory.is_dir():
            raise HTTPException(404, 'Backup not found')
        with (directory / '.lock').open('a+b') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield directory

    def save(self, directory, value):
        temporary = directory / ('.manifest-' + uuid.uuid4().hex)
        try:
            with temporary.open('x') as output:
                json.dump(value, output)
                output.flush();os.fsync(output.fileno())
            temporary.replace(directory / 'manifest.json')
            descriptor = os.open(directory, os.O_RDONLY)
            try: os.fsync(descriptor)
            finally: os.close(descriptor)
        finally:
            temporary.unlink(missing_ok=True)

    def load(self, directory):
        try:
            return json.loads((directory / 'manifest.json').read_text())
        except (OSError, ValueError):
            raise HTTPException(409, 'Backup manifest is unavailable; retry planning')

    @staticmethod
    def resource_file(directory, resource):
        # Only server-generated UUID paths; client filenames never form paths.
        suffix=Path(resource['filename']).suffix.lower()
        if not suffix or len(suffix)>12 or not suffix[1:].isalnum():suffix='.bin'
        return directory / (str(uuid.UUID(resource['id'])) + suffix)

    def view(self, directory, manifest):
        output = dict(manifest)
        output['resources'] = [dict(resource, received_bytes=(self.resource_file(directory, resource).stat().st_size
                                  if self.resource_file(directory, resource).is_file() else 0))
                               for resource in manifest['resources']]
        return output

    def plan(self, owner, plan: AssetPlan):
        identifier = str(uuid.uuid5(uuid.NAMESPACE_URL, f'kindred-phone:{owner}:{plan.device_id}:{plan.asset_identifier}:{plan.revision}'))
        resources = [dict(resource.model_dump(), id=str(uuid.uuid5(uuid.UUID(identifier), resource.key))) for resource in plan.resources]
        if len({r['key'] for r in resources}) != len(resources):
            raise HTTPException(400, 'Resource identifiers must be unique')
        with self.locked(owner, identifier, create=True) as directory:
            if (directory / 'manifest.json').exists():
                manifest = self.load(directory)
                if manifest['resources'] != resources:
                    raise HTTPException(409, 'This asset revision already has a different resource manifest')
            else:
                manifest = dict(id=identifier, device_id=str(plan.device_id), asset_identifier=plan.asset_identifier,
                                revision=plan.revision, created_at=plan.created_at, albums=plan.albums,
                                resources=resources, state='pending', verified_at=None)
                self.save(directory, manifest)
            return self.view(directory, manifest)

    def status(self, owner, identifier):
        directory = self.directory(owner,identifier)
        if not directory.is_dir():raise HTTPException(404,'Backup not found')
        return self.view(directory,self.load(directory))

    def append(self, owner, identifier, resource_id, offset, data):
        if not data or len(data) > CHUNK_BYTES or offset < 0:
            raise HTTPException(400, 'Chunks must contain 1–8 MB at a valid offset')
        with self.locked(owner, identifier) as directory:
            manifest = self.load(directory)
            resource = next((r for r in manifest['resources'] if r['id'] == resource_id), None)
            if resource is None: raise HTTPException(404, 'Resource not found')
            path = self.resource_file(directory, resource)
            size = path.stat().st_size if path.exists() else 0
            if offset + len(data) > resource['byte_size']:
                raise HTTPException(409, 'Chunk exceeds the expected original size')
            if offset < size:
                with path.open('rb') as existing:
                    existing.seek(offset)
                    if offset + len(data) > size or existing.read(len(data)) != data:
                        raise HTTPException(409, 'Retry does not match the saved chunk')
                return {'received_bytes': size}
            if offset != size:
                raise HTTPException(409, f'Resume from byte {size}')
            if manifest['state'] == 'verified':
                raise HTTPException(409, 'Verified originals are immutable')
            with path.open('ab') as output:
                try:
                    output.write(data);output.flush();os.fsync(output.fileno())
                except Exception:
                    output.truncate(size);output.flush();os.fsync(output.fileno())
                    raise
            manifest.update(state='pending', verified_at=None)
            self.save(directory, manifest)
            return {'received_bytes': size + len(data)}

    def verify(self, owner, identifier, register=None):
        # Always reread every original, including Live Photo video/adjustment resources.
        with self.locked(owner, identifier) as directory:
            manifest = self.load(directory)
            for resource in manifest['resources']:
                path = self.resource_file(directory, resource)
                if not path.is_file() or path.stat().st_size != resource['byte_size']:
                    raise HTTPException(409, 'An original resource is incomplete')
                before = path.stat()
                digest = sha256()
                with path.open('rb') as source:
                    while chunk := source.read(1024 * 1024): digest.update(chunk)
                after = path.stat()
                if (before.st_size,before.st_mtime_ns) != (after.st_size,after.st_mtime_ns) or digest.hexdigest() != resource['sha256']:
                    raise HTTPException(409, 'NAS original checksum verification failed')
            if register:
                for resource in manifest['resources']:
                    register(self.resource_file(directory,resource),resource,manifest,owner)
            manifest.update(state='verified', verified_at=time.time())
            self.save(directory, manifest)
            return self.view(directory, manifest)


def router(authorize, storage_root, register):
    routes = APIRouter(prefix='/phone-backups', tags=['iPhone backup'])
    def owner(user=Depends(authorize)):
        if not user.get('user_id'):raise HTTPException(403, 'Sign in to your household account')
        return str(uuid.UUID(str(user['user_id'])))
    def store():return PhoneBackupStore(storage_root)

    @routes.post('/plan')
    def plan(body: AssetPlan, user=Depends(owner)):
        return store().plan(user,body)

    @routes.get('/{identifier}')
    def status(identifier: uuid.UUID, user=Depends(owner)):
        return store().status(user,str(identifier))

    @routes.put('/{identifier}/{resource_id}')
    async def append(identifier: uuid.UUID, resource_id: uuid.UUID, request: Request, offset: int, user=Depends(owner)):
        data=bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data)>CHUNK_BYTES:raise HTTPException(413,'Upload chunks must be at most 8 MB')
        import asyncio
        return await asyncio.to_thread(store().append,user,str(identifier),str(resource_id),offset,bytes(data))

    @routes.post('/{identifier}/verify')
    def verify(identifier: uuid.UUID, tasks: BackgroundTasks, user=Depends(owner)):
        storage=store();identity=str(identifier)
        operation=str(uuid.uuid4())
        with storage.locked(user,identity) as directory:
            manifest=storage.load(directory)
            manifest.update(state='verifying',verification_id=operation,verified_at=None)
            storage.save(directory,manifest)
        def work():
            try:
                storage.verify(user,identity,register)
            except Exception:
                with storage.locked(user,identity) as directory:
                    manifest=storage.load(directory)
                    manifest.update(state='failed',verified_at=None)
                    storage.save(directory,manifest)
        tasks.add_task(work)
        return {'verification_id':operation,'state':'verifying'}
    return routes
