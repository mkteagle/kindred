"""Generate small derivatives when the normal NAS preview decoder fails."""
from pathlib import Path
import subprocess
import tempfile
from threading import BoundedSemaphore

from PIL import Image

from discover_nas_library import RAW


EDGE = 480
DECODE_TIMEOUT = 30
_FALLBACK_SLOT = BoundedSemaphore(1)
_MOVIE_BRANDS = {b'qt  ', b'isom', b'iso2', b'mp41', b'mp42', b'avc1', b'M4V ', b'3gp4'}
_JPEG_OR_TIFF = (b'\xff\xd8\xff', b'II*\0', b'MM\0*')
_IMAGE_SIGNATURES = _JPEG_OR_TIFF + (b'\x89PNG\r\n\x1a\n', b'GIF8')


def _run(command, *, stdin=None, stdout=subprocess.DEVNULL):
    # Linux decoder limits apply to the child process only. One fallback runs at
    # a time, so an oversized original cannot multiply memory use across the pool.
    try:
        result = subprocess.run(
            ['prlimit', '--as=1342177280', '--fsize=268435456', '--', *command],
            stdin=stdin, stdout=stdout, stderr=subprocess.DEVNULL, timeout=DECODE_TIMEOUT,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def _valid_preview(destination):
    try:
        with Image.open(destination) as image:
            if image.format == 'JPEG' and 0 < min(image.size) <= max(image.size) <= EDGE:
                image.load()
                return True
    except (OSError, ValueError):
        pass
    destination.unlink(missing_ok=True)
    return False


def _embedded_jpeg(source, destination):
    # A camera's rendered preview can be intact even when the full image cannot decode.
    for tag in ('PreviewImage', 'JpgFromRaw', 'ThumbnailImage'):
        with tempfile.TemporaryFile(buffering=0) as extracted:
            if not _run(['exiftool', '-config', '', '-b', f'-{tag}', str(source)], stdout=extracted):
                continue
            extracted.seek(0)
            if extracted.read(3) != b'\xff\xd8\xff':
                continue
            extracted.seek(0)
            if _shrink_image(extracted, destination):
                return True
    return False


def _shrink_image(original, destination):
    destination.unlink(missing_ok=True)
    rendered = _run([
        'vips', 'thumbnail_source', '[descriptor=0]', f'{destination}[Q=80,strip]',
        str(EDGE), '--height', str(EDGE), '--size', 'down', '--fail-on', 'truncated',
        '--vips-concurrency=1',
    ], stdin=original)
    return rendered and _valid_preview(destination)


def recover_video(source, destination):
    # Seeking can fail on a damaged index even when a first frame is readable.
    # Limit the fallback to local container protocols and one video stream.
    destination.unlink(missing_ok=True)
    with _FALLBACK_SLOT, source.open('rb') as original:
        rendered = _run([
            'ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-protocol_whitelist', 'fd',
            '-threads', '1', '-filter_threads', '1', '-fd', '0', '-i', 'fd:', '-map', '0:V:0',
            '-frames:v', '1', '-vf',
            f"scale='min({EDGE},iw)':'min({EDGE},ih)':force_original_aspect_ratio=decrease",
            '-threads', '1', '-q:v', '4', str(destination),
        ], stdin=original)
        return rendered and _valid_preview(destination)


def recover_image(source: Path, destination: Path):
    with source.open('rb') as original:
        header = original.read(12)
    if header[4:8] == b'ftyp' and header[8:12] in _MOVIE_BRANDS:
        return 'video/quicktime' if recover_video(source, destination) else None
    with _FALLBACK_SLOT:
        if source.suffix.lower() in RAW:
            return 'image/jpeg' if _embedded_jpeg(source, destination) else None
        if header.startswith(_IMAGE_SIGNATURES):
            with source.open('rb') as original:
                if _shrink_image(original, destination):
                    return 'image/jpeg'
            if header.startswith(_JPEG_OR_TIFF) and _embedded_jpeg(source, destination):
                return 'image/jpeg'
    return None
