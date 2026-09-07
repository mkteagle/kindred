"""Poster frames and short looping previews for video originals.

Videos need two derived artefacts to sit in a grid: a still poster for the
first paint, and a short silent clip for hover. Both are cached next to the
image thumbnails and are cheap to regenerate, so nothing here is precious.

GIF is deliberately not used. A three-second 320px GIF runs 1-3 MB because it
is limited to 256 colours and stores whole frames; the same clip as h264 is
around 100 KB with better colour. The size difference matters once the cache
covers a whole library.
"""

from __future__ import annotations

from pathlib import Path
import json
import subprocess

# Deliberately small: these are grid tiles, never the viewing experience.
POSTER_EDGE = 512
CLIP_WIDTH = 360
CLIP_SECONDS = 3.0
CLIP_FPS = 15
CLIP_CRF = 30

FFMPEG_TIMEOUT = 120


class VideoPreviewError(RuntimeError):
    """ffmpeg or ffprobe could not read the source."""


def probe_duration(source: Path, run=subprocess.run) -> float | None:
    """Duration in seconds, or None when the container does not report one."""
    completed = run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json", str(source),
        ],
        capture_output=True, text=True, timeout=FFMPEG_TIMEOUT,
    )
    if completed.returncode != 0:
        raise VideoPreviewError(f"ffprobe failed: {(completed.stderr or '').strip()[:300]}")
    try:
        duration = float(json.loads(completed.stdout)["format"]["duration"])
    except (ValueError, KeyError, TypeError):
        return None
    return duration if duration > 0 else None


def seek_for(duration: float | None) -> float:
    """Where to sample from.

    A tenth of the way in skips fades, slates and the black first frame that
    phone videos so often open on, while staying inside very short clips.
    """
    if not duration or duration <= 0:
        return 0.0
    return min(max(duration * 0.1, 0.0), max(duration - 0.1, 0.0))


def poster_command(source: Path, destination: Path, duration: float | None,
                   edge: int = POSTER_EDGE) -> list[str]:
    """One scaled JPEG frame. `-ss` before `-i` so ffmpeg seeks rather than decodes."""
    return [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{seek_for(duration):.3f}",
        "-i", str(source),
        "-frames:v", "1",
        # Never upscale: min(edge, iw) leaves a small source at its own size.
        "-vf", f"scale='min({edge},iw)':-2",
        "-q:v", "4",
        str(destination),
    ]


def clip_command(source: Path, destination: Path, duration: float | None,
                 width: int = CLIP_WIDTH, seconds: float = CLIP_SECONDS) -> list[str]:
    """A short, silent, seekable h264 loop.

    yuv420p and +faststart are what make it play inline everywhere, Safari on
    iOS included; -an drops audio the grid would never play anyway.
    """
    return [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{seek_for(duration):.3f}",
        "-t", f"{min(seconds, duration or seconds):.3f}",
        "-i", str(source),
        "-an",
        "-vf", f"scale='min({width},iw)':-2,fps={CLIP_FPS}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(CLIP_CRF),
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(destination),
    ]


def render(command: list[str], destination: Path, run=subprocess.run) -> Path:
    """Run one ffmpeg command, leaving no partial file behind on failure."""
    completed = run(command, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    if completed.returncode != 0 or not destination.exists() or destination.stat().st_size == 0:
        destination.unlink(missing_ok=True)
        raise VideoPreviewError(f"ffmpeg failed: {(completed.stderr or '').strip()[:300]}")
    return destination
