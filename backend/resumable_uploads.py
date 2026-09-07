"""Dependency-free helpers for safely appending resumable upload chunks."""

from __future__ import annotations

from pathlib import Path


class ChunkAppendError(ValueError):
    """Raised when a chunk does not match the server's confirmed upload state."""


def append_chunk(
    path: str | Path,
    *,
    expected_offset: int,
    expected_size: int,
    chunk: bytes,
) -> int:
    """Append one chunk and return the new confirmed offset.

    The database offset and actual staging-file length must agree before data is
    accepted. This makes a repeated or out-of-order request fail closed instead
    of silently corrupting an original.
    """
    target = Path(path)
    if expected_offset < 0 or expected_size <= 0:
        raise ChunkAppendError("Invalid upload size or offset")
    if not chunk:
        raise ChunkAppendError("Upload chunk is empty")

    next_offset = expected_offset + len(chunk)
    if next_offset > expected_size:
        raise ChunkAppendError("Upload chunk exceeds the declared file size")

    actual_size = target.stat().st_size if target.exists() else 0
    if actual_size == next_offset:
        # The process may have stopped after flushing the file but before the
        # database offset committed. Accept an exact replay of that chunk.
        with target.open("rb") as source:
            source.seek(expected_offset)
            if source.read(len(chunk)) == chunk:
                return next_offset
    if actual_size != expected_offset:
        raise ChunkAppendError(
            f"Staging file is {actual_size} bytes; expected {expected_offset}"
        )

    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("ab") as destination:
        destination.write(chunk)
        destination.flush()

    return next_offset
