"""Durable previews are usable even when the original's mount is offline."""
from pathlib import Path
import os
import uuid

THUMBNAIL_ROOT = Path(os.environ.get('KINDRED_THUMBNAIL_ROOT', '/app/data/thumbnails'))


def thumbnail_identity(value):
    if not value:
        return None
    identity = str(value)
    try:
        return str(uuid.UUID(identity))
    except ValueError:
        return identity if identity.isascii() and identity.isdecimal() and len(identity) <= 25 else None


def cached_thumbnail(identities, root=None):
    root = Path(root) if root is not None else THUMBNAIL_ROOT
    resolved_root = root.resolve()
    for identity in dict.fromkeys(str(value) for value in identities if value):
        try:
            uuid.UUID(identity)
        except ValueError:
            if not identity.isascii() or not identity.isdecimal() or len(identity) > 25:
                continue
        for suffix in ('-poster.jpg', '.jpg'):
            candidate = root / f'{identity}{suffix}'
            try:
                candidate.resolve().relative_to(resolved_root)
            except ValueError:
                continue
            if candidate.is_file():
                return candidate
    return None


import threading
_PREVIEW_BUILDERS = threading.BoundedSemaphore(2)


def ensure_thumbnail(identity, source):
    """A visible cache miss creates the same durable preview as the background job."""
    identity = str(uuid.UUID(str(identity)))
    import image_transforms
    with _PREVIEW_BUILDERS:
        cached = cached_thumbnail([identity])
        if cached is not None:return cached
        THUMBNAIL_ROOT.mkdir(parents=True,exist_ok=True)
        destination = THUMBNAIL_ROOT / f'{identity}.jpg'
        temporary = THUMBNAIL_ROOT / f'.{identity}.{uuid.uuid4().hex}.jpg'
        try:
            temporary.write_bytes(image_transforms.encode(Path(source),480,80,'jpeg'))
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        return destination


def thumbnail_response(path, request=None):
    """Serve prebuilt JPEG bytes directly: no decode, conversion, or SQLite write."""
    from fastapi.responses import FileResponse, Response
    from PIL import Image
    with Image.open(path) as image:
        normalize = image.width > 512 or image.height > 2560 or image.format != 'JPEG'
    if normalize:
        import image_transforms
        with _PREVIEW_BUILDERS:
            temporary = path.with_name('.normalize-'+uuid.uuid4().hex+'.jpg')
            try:
                temporary.write_bytes(image_transforms.encode(path,480,80,'jpeg'))
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
    stat = path.stat()
    etag = f'"thumb-{stat.st_size:x}-{stat.st_mtime_ns:x}"'
    headers={'Cache-Control':'private, max-age=86400','ETag':etag}
    if request is not None and request.headers.get('if-none-match') == etag:
        return Response(status_code=304,headers=headers)
    return FileResponse(path,media_type='image/jpeg',headers=headers)
