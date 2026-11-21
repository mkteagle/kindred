#!/usr/bin/env python3
"""Progress for installed Kindred workers, based on fresh heartbeats."""
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
        return min(99.9, round(100.0 * self.done / self.total, 1)) if self.done < self.total else 100.0

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


def build(rows: dict, disk: dict | None = None, workers: dict | None = None) -> list[dict]:
    """Only installed Kindred workers appear; saved import folders are not jobs."""
    disk, workers = disk or {}, workers or {}
    specifications = [
        ('discovery', 'discovery', 'NAS file discovery', rows.get('registered', 0),
         disk.get('media_files'), 'Photo and video file locations registered in place'),
        ('previews', 'previews', 'NAS previews', rows.get('previews_ready', 0),
         rows.get('registered'), 'Cached previews and capture-date metadata'),
        ('index', 'recognition', 'Search and face indexing', rows.get('indexed', 0),
         rows.get('photos'), 'Photos processed for visual search and recognition'),
    ]
    result = []
    for key, worker_key, label, done, total, detail in specifications:
        worker = workers.get(worker_key)
        if worker is None:
            continue
        excluded = 0
        if key == 'previews' and worker.get('counts_authoritative'):
            done = worker.get('completed', done)
        if key == 'discovery':
            done = worker.get('registered', done)
            if worker.get('reconciled'):
                total = worker['eligible_total']
                excluded = worker.get('excluded', 0)
                detail = f'File scan complete; {excluded:,} empty or unsupported file entries excluded' if worker.get('complete') else detail
        running = bool(worker.get('running')) and not worker.get('stale', True) and not worker.get('waiting')
        value = Progress(key, label, done, total, running, detail,
                         worker.get('updated_at')).as_dict()
        value['phase'] = worker.get('phase')
        value['stage'] = worker.get('stage')
        value['workers'] = worker.get('workers')
        value['in_flight'] = worker.get('in_flight')
        value['excluded'] = excluded
        value['complete'] = bool(worker.get('complete')) and total is not None and done >= total
        if key == 'discovery' and worker.get('complete') and total is not None and done < total:
            value['phase'] = 'reconciliation_needed'
            value['detail'] = f'Scan finished; {total - done:,} file entries still need reconciliation'
        value['stale'] = bool(worker.get('stale', True))
        if value['stale'] and not worker.get('complete'):
            value['detail'] = 'Progress update delayed; worker may be waiting on the NAS. Process status is unconfirmed.'
        if worker.get('phase') == 'waiting_for_discovery':
            value['detail'] = 'Starts after the initial NAS discovery pass finishes'
        if worker.get('phase') == 'waiting_for_previews':
            value['detail'] = 'Starts after file discovery and thumbnail generation'
        if worker.get('phase') == 'waiting_for_capacity':
            value['detail'] = 'Waiting for NAS disk or memory pressure to ease'
        result.append(value)
    return result
