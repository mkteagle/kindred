"""Bounded, disposable platform cache. Call only AFTER authorizing a photo.

Originals stay in NAS storage; transformed bytes live in this evictable cache,
never in photo_copies. No URL supplied by a client is accepted here.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import os
import sqlite3
import threading
import time

from PIL import Image, ImageOps

WIDTHS = (160, 320, 480, 640, 960, 1280, 1600, 2048, 2560)
LEGACY_WIDTHS = dict(s=160, q=160, t=160, m=320, n=320, z=640, c=960, b=1280, h=1600, k=2048)
MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 80_000_000
CACHE_BYTES = 256 * 1024 * 1024
CACHE_TTL = 7 * 86400
# Limits CPU/decode memory and coalesces duplicate misses without an unbounded
# map of locks. Queueing happens off the ASGI event loop.
_LOCKS = [threading.Lock() for _ in range(32)]
_DECODERS = threading.BoundedSemaphore(2)
REMOTE_FETCHES = asyncio.Semaphore(3)


def parameters(width=None, quality=80, format='auto', accept='', size='b'):
    if width is None:
        if size not in LEGACY_WIDTHS:
            raise ValueError('Unknown image size')
        width = LEGACY_WIDTHS[size]
    if width not in WIDTHS:
        raise ValueError('width must be one of ' + ', '.join(map(str, WIDTHS)))
    if quality not in (70, 80, 90):
        raise ValueError('quality must be 70, 80, or 90')
    if format not in ('auto', 'avif', 'webp', 'jpeg'):
        raise ValueError('format must be auto, avif, webp, or jpeg')
    Image.init()
    if format == 'auto':
        accepted = {}
        for part in accept.lower().split(','):
            fields = part.strip().split(';')
            try:
                accepted[fields[0]] = next((float(f.strip()[2:]) for f in fields[1:] if f.strip().startswith('q=')), 1)
            except ValueError:
                continue
        format = next((f for f in ('avif', 'webp') if accepted.get('image/' + f, 0) > 0 and f.upper() in Image.SAVE), 'jpeg')
    if format.upper() not in Image.SAVE:
        raise ValueError('Requested encoder unavailable')
    return width, quality, format


def source_version(source: Path):
    stat = source.stat()
    return f'{source.resolve()}:{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}'


def cache_key(identity, width, quality, format):
    return sha256(f'v1:{identity}:{width}:{quality}:{format}'.encode()).hexdigest()


class TransformCache:
    def __init__(self, path=None, budget=CACHE_BYTES, ttl=CACHE_TTL):
        self.path = path or os.environ.get('IMAGE_CACHE_PATH', '/tmp/kindred-image-cache.sqlite3')
        self.budget = budget
        self.ttl = ttl
        self._ready = False
        self._init_lock = threading.Lock()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        if not self._ready:
            with self._init_lock:
                if not self._ready:
                    db.execute('PRAGMA journal_mode=WAL')
                    db.execute('CREATE TABLE IF NOT EXISTS images (key TEXT PRIMARY KEY, data BLOB, created REAL, accessed REAL)')
                    db.execute('CREATE INDEX IF NOT EXISTS images_created ON images(created)')
                    db.execute('CREATE INDEX IF NOT EXISTS images_accessed ON images(accessed)')
                    db.commit()
                    self._ready = True
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, key):
        with self.connect() as db:
            now = time.time()
            row = db.execute('SELECT data, accessed FROM images WHERE key=? AND created>?', (key, now - self.ttl)).fetchone()
            if row:
                # A cache hit should normally be read-only: don't serialize a
                # gallery burst behind one SQLite write transaction per image.
                if row[1] < now - 60:
                    db.execute('UPDATE images SET accessed=? WHERE key=?', (now, key))
                return row[0]
        return None

    def put(self, key, data):
        if len(data) > self.budget:
            return
        with self.connect() as db:
            now = time.time()
            db.execute('DELETE FROM images WHERE created<?', (now - self.ttl,))
            db.execute('INSERT OR REPLACE INTO images VALUES (?, ?, ?, ?)', (key, data, now, now))
            total = db.execute('SELECT coalesce(sum(length(data)), 0) FROM images').fetchone()[0]
            while total > self.budget:
                old_key, length = db.execute('SELECT key, length(data) FROM images ORDER BY accessed LIMIT 1').fetchone()
                db.execute('DELETE FROM images WHERE key=?', (old_key,))
                total -= length
        # SQLite reuses freed pages; physical storage is bounded by the budget
        # plus one insertion and SQLite overhead, without vacuum on every hit.

    def render(self, identity, source, width, quality, format):
        key = cache_key(identity, width, quality, format)
        with _LOCKS[int(key[:8], 16) % len(_LOCKS)]:
            data = self.get(key)
            if data is None:
                with _DECODERS:
                    data = encode(source, width, quality, format)
                self.put(key, data)
        return key, data


def encode(source, width, quality, format):
    if isinstance(source, Path):
        if source.stat().st_size > MAX_SOURCE_BYTES:
            raise ValueError('Photo is too large to transform')
        if source.suffix.lower() in ('.heic', '.heif'):
            from pillow_heif import register_heif_opener
            register_heif_opener()
    elif isinstance(source, bytes):
        if len(source) > MAX_SOURCE_BYTES:
            raise ValueError('Photo is too large to transform')
        source = BytesIO(source)
    try:
        opened = Image.open(source)
    except Image.DecompressionBombError as exc:
        raise ValueError('Photo exceeds decode pixel limit') from exc
    with opened as original:
        if original.width * original.height > MAX_PIXELS:
            raise ValueError('Photo exceeds decode pixel limit')
        # Decode JPEG at a reduced resolution before orientation/copying.
        original.draft('RGB', (width, width))
        image = ImageOps.exif_transpose(original)
        target = (min(width, image.width), min(2560, round(image.height * min(width / image.width, 1))))
        image.thumbnail(target, Image.Resampling.LANCZOS)
        image = image.convert('RGB')
        output = BytesIO()
        options = {'quality': quality}
        if format == 'avif':
            options.update(speed=8, max_threads=2)
        image.save(output, format.upper(), **options)
        return output.getvalue()


CACHE = TransformCache()


def local_transform(source, width, quality, format):
    return CACHE.render(source_version(source), source, width, quality, format)


def image_response(key, data, format, request=None):
    from fastapi.responses import Response
    headers = {
        # Revalidate access/source version even with a warm browser cache.
        'Cache-Control': 'private, no-cache',
        'Vary': 'Accept, Cookie, X-Session-Token, X-API-Key',
        'ETag': '"' + key + '"',
        'X-Content-Type-Options': 'nosniff',
    }
    if request and request.headers.get('if-none-match') == headers['ETag']:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type='image/' + format, headers=headers)
