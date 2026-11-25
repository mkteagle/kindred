#!/usr/bin/env python3
"""Progress for installed Kindred workers, based on fresh heartbeats."""
from __future__ import annotations

from dataclasses import dataclass, asdict

from library_progress import previews_finished


PIPELINE_PRIORITY = (
    'flickr_backup', 'flickr_match', 'discovery', 'previews', 'r2', 'index', 'categorization', 'faces',
)
RECOGNITION_PHASES = {'categorization': 'categories', 'faces': 'faces'}


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


def catalog_progress(query) -> dict:
    """Measure all three NAS passes against the same source catalog."""
    return dict(query("""
        WITH flickr_indexed AS (
            SELECT DISTINCT copy.photo_id
            FROM processed_photos finished
            JOIN photo_copies copy ON copy.provider_key = finished.photo_id
            WHERE copy.provider = 'flickr' AND copy.status = 'available'
        ), nas_progress AS (
            SELECT source.preview_ready_at IS NOT NULL AS preview_ready,
                   source.preview_error IS NOT NULL AS preview_failed,
                   starts_with(photo.media_type, 'image/') AS image,
                   direct.photo_id IS NOT NULL OR flickr.photo_id IS NOT NULL AS indexed,
                   source.categorized_at IS NOT NULL AS categorized,
                   source.ml_error IS NOT NULL AS category_failed,
                   source.face_error IS NOT NULL AS face_failed
            FROM nas_source_files source
            JOIN photos photo ON photo.id = source.photo_id
            LEFT JOIN processed_photos direct ON direct.photo_id = source.photo_id::text
            LEFT JOIN flickr_indexed flickr ON flickr.photo_id = source.photo_id
        )
        SELECT count(*) AS registered,
               count(*) FILTER (WHERE preview_ready) AS previews_ready,
               count(*) FILTER (WHERE NOT preview_ready AND preview_failed) AS previews_failed,
               count(*) FILTER (WHERE image AND indexed) AS indexed,
               count(*) FILTER (WHERE image IS NOT TRUE) AS index_skipped,
               count(*) FILTER (WHERE image AND (preview_ready OR indexed)) AS recognition_total,
               count(*) FILTER (WHERE image AND ((indexed AND NOT category_failed) OR (preview_ready AND categorized))) AS categorized,
               count(*) FILTER (WHERE image AND preview_ready AND NOT categorized
                               AND category_failed) AS categorization_failed,
               count(*) FILTER (WHERE image AND preview_ready AND NOT indexed AND face_failed) AS faces_failed
        FROM nas_progress
    """)[0])


def build(rows: dict, disk: dict | None = None, workers: dict | None = None) -> list[dict]:
    """Only installed Kindred workers appear; saved import folders are not jobs."""
    disk, workers = disk or {}, workers or {}
    discovery = workers.get('discovery') or {}
    registered = rows.get('registered', discovery.get('registered', 0))
    estimate = discovery['eligible_total'] if discovery.get('reconciled') else disk.get('media_files')
    nas_total = rows.get('registered') if not discovery or discovery.get('complete') else None
    if estimate is not None:
        nas_total = max(registered, estimate)
    skipped_index = rows.get('index_skipped', 0)
    previews_ready = rows.get('previews_ready', 0)
    previews_failed = rows.get('previews_failed', 0)
    previews_done = previews_finished(workers) and (
        'registered' not in rows or previews_ready + previews_failed == registered
    )
    specifications = [
        ('discovery', 'discovery', 'NAS file discovery', registered,
         nas_total, 'Photo and video file locations registered in place'),
        ('previews', 'previews', 'NAS previews', previews_ready,
         nas_total, 'Cached previews and capture-date metadata'),
        ('r2', 'r2', 'R2 thumbnail uploads', 0, None,
         'Thumbnails available to upload as the NAS makes previews'),
        ('flickr_match', 'flickr_match', 'Flickr original matching', 0, None,
         'Comparing Flickr originals with NAS files'),
        ('flickr_backup', 'flickr_backup', 'NAS backup to Flickr', 0, None,
         'Privately mirrors eligible NAS originals to the household Flickr account'),
    ]
    recognition = workers.get('recognition') or {}
    if recognition.get('split_stages'):
        specifications.append((
            'categorization', 'recognition', 'Photo categorization', rows.get('categorized', 0),
            rows.get('recognition_total'), 'Analyzes photos for visual search and categories',
        ))
        if recognition.get('faces_enabled', True):
            specifications.append((
                'faces', 'recognition', 'Face recognition', rows.get('indexed', 0),
                rows.get('recognition_total'), 'Finds faces and groups photos by person',
            ))
    else:
        specifications.append((
            'index', 'recognition', 'Search and face indexing', rows.get('indexed', 0) + skipped_index,
            rows.get('photos', nas_total), 'Photos processed for visual search and recognition',
        ))
    result = []
    for key, worker_key, label, done, total, detail in specifications:
        worker = workers.get(worker_key)
        if worker is None:
            continue
        phase = worker.get('phase')
        failed = worker.get('failed', 0)
        skipped = worker.get('skipped', 0)
        stale = bool(worker.get('stale', True))
        complete = False
        terminal_failures = 0
        excluded = 0
        if key == 'discovery':
            if worker.get('reconciled'):
                excluded = worker.get('excluded', 0)
                if worker.get('complete'):
                    detail = f'File scan complete with {excluded:,} empty or unsupported file entries excluded'
            complete = bool(worker.get('complete'))
        if key == 'previews':
            failed = terminal_failures = previews_failed
            complete = previews_done and total is not None and done + failed >= total
            if failed:
                detail = f'{done:,} previews ready · {failed:,} failed'
            if worker.get('stage') == 'queue_empty' and not stale and not complete:
                if total is not None and done + failed < total:
                    phase = 'reconciliation_needed'
                    detail = f'{total - done - failed:,} files still have no preview result'
                else:
                    phase = 'checking_completion'
            elif complete and not failed:
                detail = 'All NAS previews are ready'
        if key in RECOGNITION_PHASES:
            failed = rows.get(f'{key}_failed', 0)
            terminal_failures = failed if key == 'faces' else 0
            complete = previews_done and total is not None and done + terminal_failures >= total
            if failed:
                detail = f'{detail} · {failed:,} failed'
            if phase in RECOGNITION_PHASES.values() and phase != RECOGNITION_PHASES[key]:
                phase = 'queued'
            elif phase == 'caught_up' and not complete:
                if not previews_done:
                    phase = 'waiting_for_previews'
                elif key == 'categorization' and failed:
                    phase = 'waiting_for_categorization_retry'
                else:
                    phase = 'needs_review'
        if key == 'index':
            complete = total is not None and done >= total
            skipped = skipped_index
        if key == 'r2':
            done = worker.get('completed', 0)
            inventory = worker.get('thumbnail_total')
            available = inventory
            preview_worker = workers.get('previews') or {}
            if available is None and preview_worker.get('counts_authoritative'):
                preview_estimate = preview_worker.get('completed', 0)
                if preview_estimate > done:
                    available = preview_estimate
            total = max(done, available) if available is not None else None
            if phase == 'caught_up':
                complete = not stale and previews_done and inventory is not None and done >= inventory
                if not previews_done:
                    phase = 'waiting_for_previews'
                    detail = 'Waiting for more NAS thumbnails to become available'
                else:
                    detail = 'All thumbnails found in the last upload scan are in R2'
            elif phase == 'retrying':
                detail = f'{failed:,} thumbnails could not upload in the last pass'
            elif phase == 'stopped':
                detail = 'Publisher stopped and will resume from its checkpoint'
            elif inventory is None and phase not in ('waiting_for_discovery', 'waiting_for_previews'):
                if total is None:
                    phase = 'counting_thumbnails'
                    detail = 'Counting thumbnails and video posters on the NAS'
                else:
                    detail = 'Using the NAS preview count while the full thumbnail inventory runs'
        if key == 'flickr_match':
            done, total = worker.get('completed', 0), worker.get('remote_total')
            complete = bool(worker.get('complete'))
            if done:
                detail = (f"{worker.get('matched', 0):,} linked · {worker.get('unmatched', 0):,} without a match"
                          f" · {skipped + failed:,} need review")
        if key == 'flickr_backup':
            done = worker.get('matched', 0)
            if done:
                detail = f'{done:,} linked to Flickr · {skipped + failed:,} need review or retry'
            if phase == 'caught_up':
                phase = 'retrying' if failed else 'needs_review' if skipped else phase
                if phase == 'caught_up':
                    detail = 'Finished the current backup pass and will check again for new originals'
        if complete and terminal_failures:
            phase = 'complete_with_errors'
        running = bool(worker.get('running')) and not (
            complete or stale or worker.get('waiting') or phase == 'queued'
            or (phase or '').startswith('waiting_for_')
        )
        handled = done + terminal_failures
        value = Progress(key, label, handled, total, running, detail,
                         worker.get('updated_at')).as_dict()
        value.update(done=done, phase=phase, stage=worker.get('stage'), workers=worker.get('workers'),
                     in_flight=worker.get('in_flight'), excluded=excluded, failed=failed,
                     complete=complete and total is not None and handled >= total, stale=stale)
        if key == 'index':
            value['skipped'] = skipped
        if key == 'discovery' and complete and total is not None and done < total:
            value.update(phase='reconciliation_needed',
                         detail=f'Scan finished with {total - done:,} file entries still to reconcile')
        elif stale and not value['complete']:
            value['detail'] = 'Worker has not reported recently'
        elif phase == 'waiting_for_discovery':
            value['detail'] = 'Starts after the initial NAS discovery pass finishes'
        elif phase == 'waiting_for_previews':
            value['detail'] = 'Resumes when the NAS thumbnail queue is caught up'
        elif phase == 'waiting_for_capacity':
            value['detail'] = 'Waiting for NAS disk or memory pressure to ease'
        elif phase == 'waiting_for_flickr_match':
            value['detail'] = 'Starts after the Flickr original comparison finishes'
        result.append(value)
    return sorted(result, key=lambda row: (
        row['complete'], not row['running'], PIPELINE_PRIORITY.index(row['key']),
    ))
