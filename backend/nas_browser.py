"""Owner-only, paged browsing inside one explicitly mounted media directory."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
import base64
import heapq
import json
import os
import threading
import uuid
from fastapi import HTTPException

IMAGES = {'.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.avif'}
VIDEOS = {'.mp4', '.mov', '.m4v', '.avi', '.wmv', '.mpeg', '.mpg', '.3gp', '.m2ts', '.mkv', '.webm'}
LOCKS = [threading.Lock() for _ in range(16)]
VIDEO_RENDERS = threading.BoundedSemaphore(1)


def resolve_media_path(root, relative=''):
    if not root:
        raise HTTPException(503, 'Mount a media folder and configure KINDRED_BROWSE_ROOT on the server.')
    root = Path(root).resolve()
    if not root.is_dir():
        raise HTTPException(503, 'The media folder is offline. Check the server mount.')
    key = PurePosixPath(relative)
    if key.is_absolute() or '..' in key.parts or '\\' in relative or '\x00' in relative or any(p.startswith('.') for p in key.parts):
        raise HTTPException(400, 'Invalid folder path')
    try:
        target = root.joinpath(*key.parts).resolve(strict=True)
        target.relative_to(root)
    except ValueError:
        raise HTTPException(403, 'This path is outside the configured media folder')
    except (FileNotFoundError, OSError):
        raise HTTPException(404, 'This file or folder is no longer available')
    return root, target


def browse(root, relative='', cursor=None, limit=100):
    root, directory = resolve_media_path(root, relative)
    if not directory.is_dir():
        raise HTTPException(400, 'Choose a folder')
    after = None
    if cursor:
        try:
            after = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
            if not isinstance(after, list) or len(after) != 3 or after[0] not in (0, 1) or not all(isinstance(v, str) for v in after[1:]):
                raise ValueError()
            after = tuple(after)
        except (ValueError, TypeError):
            raise HTTPException(400, 'Invalid folder cursor')

    def candidates(entries):
        for entry in entries:
            if entry.name.startswith('.'):
                continue
            try:
                is_dir = entry.is_dir()
                if entry.is_symlink():
                    Path(entry.path).resolve().relative_to(root)
                kind = 'folder' if is_dir else 'video' if Path(entry.name).suffix.lower() in VIDEOS else 'photo' if Path(entry.name).suffix.lower() in IMAGES else None
                if kind is None:
                    continue
                key = (0 if is_dir else 1, entry.name.casefold(), entry.name)
                if after is None or key > after:
                    yield key, entry, kind
            except (OSError, ValueError):
                continue
    try:
        # Bounded memory, one directory only. Never walk descendants to open a folder.
        with os.scandir(directory) as entries:
            selected = heapq.nsmallest(limit + 1, candidates(entries), key=lambda row: row[0])
        items = []
        for key, entry, kind in selected[:limit]:
            try:
                stat = entry.stat()
                items.append({'name': entry.name, 'path': (PurePosixPath(relative) / entry.name).as_posix(),
                              'kind': kind, 'byte_size': stat.st_size if kind != 'folder' else None,
                              'modified_at': stat.st_mtime_ns // 1_000_000})
            except OSError:
                continue
    except PermissionError:
        raise HTTPException(403, 'The server cannot read this folder')
    except OSError:
        raise HTTPException(503, 'The folder became unavailable. Check the server mount.')
    next_cursor = base64.urlsafe_b64encode(json.dumps(selected[limit - 1][0]).encode()).decode().rstrip('=') if len(selected) > limit else None
    return {'path': PurePosixPath(relative).as_posix() if relative else '', 'entries': items, 'next_cursor': next_cursor}


def preview(root, relative, cache_root):
    _, source = resolve_media_path(root, relative)
    extension = source.suffix.lower()
    if not source.is_file() or extension not in IMAGES | VIDEOS:
        raise HTTPException(415, 'This file has no photo or video preview')
    import image_transforms
    try:
        identity = image_transforms.source_version(source)
    except OSError:
        raise HTTPException(404, "This file is no longer available")
    key = sha256(identity.encode()).hexdigest()
    destination = Path(cache_root) / 'browse' / f'{key}.jpg'
    with LOCKS[int(key[:8], 16) % len(LOCKS)]:
        if destination.is_file():
            return destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f'{key}.{uuid.uuid4().hex}.tmp.jpg')
        try:
            if extension in VIDEOS:
                import video_preview
                with VIDEO_RENDERS:
                    duration = video_preview.probe_duration(source)
                    video_preview.render(video_preview.poster_command(source, temporary, duration), temporary)
            else:
                _, data = image_transforms.CACHE.render(identity, source, 480, 80, 'jpeg')
                temporary.write_bytes(data)
            os.replace(temporary, destination)
        except Exception:
            raise HTTPException(422, 'This file could not be previewed')
        finally:
            temporary.unlink(missing_ok=True)
    return destination
