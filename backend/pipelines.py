#!/usr/bin/env python3
"""Progress for the long-running pipelines, in a shape a progress bar can use.

Five things run for days at a time here -- the Takeout import, the iCloud
download, ML indexing, the Flickr mirror and video derivatives -- and until now
the only way to know how any of them was doing was to read a container log.
That is how the iCloud download sat stopped for twenty minutes without anyone
noticing: its container said "healthy" the whole time.

The numbers come from two very different places, and the difference matters:

  the database   cheap, exact, live. Counting indexed photos is an index scan.
  the filesystem expensive. Counting the Takeout tree means walking a million
                 files, which takes minutes and competes with the importer for
                 the disk it is trying to measure.

So filesystem totals are never gathered during a request. They are read from
whatever the last background scan left behind, and reported with the time they
were taken, because a progress bar built on a number of unknown age is worse
than one that admits it does not know yet.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class Progress:
    """One pipeline's state, ready to render."""

    key: str
    label: str
    done: int
    total: int | None
    running: bool
    detail: str = ""
    measured_at: str | None = None

    @property
    def percent(self) -> float | None:
        """None when the total is unknown -- an honest indeterminate bar."""
        if not self.total or self.total <= 0:
            return None
        return round(min(100.0, 100.0 * self.done / self.total), 1)

    @property
    def remaining(self) -> int | None:
        if self.total is None:
            return None
        return max(0, self.total - self.done)

    def as_dict(self) -> dict:
        payload = asdict(self)
        payload["percent"] = self.percent
        payload["remaining"] = self.remaining
        return payload


def eta_seconds(done: int, total: int | None, rate_per_minute: float | None) -> int | None:
    """Seconds remaining, or None when it cannot honestly be estimated.

    A rate of zero is not "finishing now", it is "not moving" -- reporting an
    ETA for a stalled pipeline is how a stall gets mistaken for progress.
    """
    if total is None or rate_per_minute is None or rate_per_minute <= 0:
        return None
    remaining = max(0, total - done)
    if remaining == 0:
        return 0
    return int(remaining / rate_per_minute * 60)


def format_eta(seconds: int | None) -> str:
    """A duration a person can read, or an empty string when unknown."""
    if seconds is None:
        return ""
    if seconds < 60:
        return "under a minute"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes / 60
    if hours < 48:
        return f"{hours:.1f} hours"
    return f"{hours / 24:.1f} days"


def build(rows: dict, disk: dict | None = None) -> list[dict]:
    """Assemble every pipeline from counts already gathered.

    Pure, so the arithmetic that decides what a bar shows can be tested without
    a database, a filesystem or a running import.
    """
    disk = disk or {}
    measured = disk.get("measured_at")

    photos = rows.get("photos", 0)
    indexed = rows.get("indexed", 0)
    on_nas = rows.get("on_nas", 0)
    on_flickr = rows.get("on_flickr", 0)
    videos = rows.get("videos", 0)
    videos_ready = rows.get("videos_ready", 0)

    pipelines = [
        Progress(
            key="import",
            label="Takeout import",
            done=rows.get("imported", 0),
            total=disk.get("takeout_files"),
            running=rows.get("import_running", False),
            detail="Google Takeout files copied into the library",
            measured_at=measured,
        ),
        Progress(
            key="icloud",
            label="iCloud download",
            done=disk.get("icloud_files", 0),
            total=disk.get("icloud_total"),
            running=rows.get("icloud_running", False),
            detail="Originals pulled from iCloud onto the NAS",
            measured_at=measured,
        ),
        Progress(
            key="index",
            label="Search and face indexing",
            done=indexed,
            total=photos,
            running=rows.get("index_running", False),
            detail="Photos with CLIP embeddings and detected faces",
        ),
        Progress(
            key="flickr",
            label="Flickr mirror",
            done=on_flickr,
            total=on_nas,
            running=rows.get("flickr_running", False),
            detail="Originals with an off-site Flickr copy",
        ),
        Progress(
            key="video",
            label="Video posters",
            done=videos_ready,
            total=videos,
            running=rows.get("video_running", False),
            detail="Videos with a poster frame and hover clip",
        ),
    ]
    return [p.as_dict() for p in pipelines]
