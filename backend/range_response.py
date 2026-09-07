"""HTTP byte-range serving for video.

`<video>` playback is built on range requests: the browser asks for
`Range: bytes=0-` and expects `206 Partial Content` with `Accept-Ranges: bytes`.
Without that, seeking is impossible everywhere and Safari refuses to play at
all.

Starlette's FileResponse only grew range support after the version FastAPI
0.111 pins (0.37.2), so this implements the parts of RFC 9110 §14 that matter
for media playback. Parsing is kept pure so the edge cases are testable.
"""

from __future__ import annotations

# One read per chunk; large enough to stream efficiently, small enough that a
# seek-heavy player does not pull megabytes it will discard.
CHUNK_SIZE = 1024 * 256


class InvalidRange(ValueError):
    """The Range header was syntactically valid but unsatisfiable."""


def parse_range(header: str | None, file_size: int) -> tuple[int, int] | None:
    """Return the inclusive (start, end) a Range header asks for.

    None means "no range requested; send the whole thing". Only single ranges
    are honoured — multipart ranges are legal but no media player needs them,
    and answering with the full body is a valid response to any range request.
    """
    if not header:
        return None
    header = header.strip()
    if not header.lower().startswith("bytes=") or "," in header:
        return None

    spec = header[len("bytes="):].strip()
    start_text, _, end_text = spec.partition("-")

    if not start_text:
        # "bytes=-500" — the final 500 bytes.
        if not end_text:
            return None
        suffix = int(end_text)
        if suffix <= 0:
            raise InvalidRange("suffix range must be positive")
        start = max(0, file_size - suffix)
        return start, file_size - 1

    start = int(start_text)
    end = int(end_text) if end_text else file_size - 1
    end = min(end, file_size - 1)

    if start >= file_size or start > end:
        raise InvalidRange(f"range {start}-{end} outside 0-{file_size - 1}")
    return start, end


def content_range(start: int, end: int, file_size: int) -> str:
    return f"bytes {start}-{end}/{file_size}"


def iter_file_range(path, start: int, end: int, chunk_size: int = CHUNK_SIZE):
    """Yield the inclusive byte range [start, end] from a file."""
    remaining = end - start + 1
    with open(path, "rb") as handle:
        handle.seek(start)
        while remaining > 0:
            chunk = handle.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
