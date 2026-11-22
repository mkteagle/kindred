"""Cheap worker heartbeats, separate from catalog/recognition totals."""
import json
from datetime import datetime, timezone
from pathlib import Path

R2_STATUS_FILE = 'worker-status/r2-thumbnail-status.json'


def previews_finished(status):
    discovery = status.get("discovery") or {}
    previews = status.get("previews") or {}
    return bool(discovery.get("complete") and previews.get("counts_authoritative")
                and previews.get("stale") is False and previews.get("stage") == "queue_empty"
                and previews.get("in_flight") == 0)


def progress(root='/app/data'):
    root = Path(root)
    result = {}
    for key, filename in (
        ('inventory', 'nas-folder-inventory.json'),
        ('discovery', 'nas-discovery-status.json'),
        ('previews', 'nas-preview-status.json'),
        ('recognition', 'nas-recognition-status.json'),
        ('r2', R2_STATUS_FILE),
    ):
        try:
            path = root / filename
            value = json.loads(path.read_text())
            # Never return exception messages or source paths to household members.
            allowed = ('photos', 'videos', 'media_files', 'complete', 'phase', 'found',
                       'registered', 'unchanged', 'folders', 'errors', 'completed',
                       'failed', 'waiting', 'batches', 'batch_completed', 'updated_at', 'elapsed_seconds', 'thumbnail_total',
                       'stage', 'workers', 'in_flight', 'rate_per_minute', 'commit_batch_size', 'counts_authoritative', 'decode_seconds', 'metadata_seconds', 'commit_seconds')
            clean = {field: value[field] for field in allowed if field in value}
            age = max(0, datetime.now(timezone.utc).timestamp() - path.stat().st_mtime)
            clean['stale'] = age > 600
            clean['running'] = bool(value.get('running')) and not clean['stale']
            result[key] = clean
        except (OSError, ValueError, TypeError):
            result[key] = None
    discovery = result.get('discovery')
    if discovery:
        try:
            audit = json.loads((root / 'nas-discovery-reconciliation.json').read_text())
            exclusions = audit.get('exclusions', {})
            excluded = sum(exclusions.values())
            eligible = audit['catalog_total']
            inventory = result.get('inventory') or {}
            if (audit.get('unexplained_candidate_gap') == 0
                    and eligible == discovery.get('registered')
                    and audit['inventory_total'] == inventory.get('media_files')
                    and eligible + excluded == audit['inventory_total']):
                discovery.update(reconciled=True, eligible_total=eligible, excluded=excluded,
                                 excluded_reasons=exclusions)
        except (OSError, ValueError, TypeError, KeyError):
            pass
    return result
