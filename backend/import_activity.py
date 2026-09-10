"""Read-only file history backed by the catalog's durable timestamps.

Catalog creation is not the photo capture date or a reconstructed upload time.
Index completion means analysis finished, not that a face was necessarily found.
"""
import base64
import binascii
from datetime import datetime
import json

from fastapi import HTTPException


def history(query, *, kind='all', search='', cursor=None, limit=50):
    if kind not in ('all', 'imported', 'indexed') or not 1 <= limit <= 100:
        raise HTTPException(400, 'Invalid activity filter')
    clauses, params = [], []
    if kind != 'all':
        clauses.append('kind = %s')
        params.append(kind)
    search = search.strip()
    if len(search) > 200:
        raise HTTPException(400, 'Search must be 200 characters or fewer')
    if search:
        clauses.append("LOWER(filename) LIKE LOWER(%s) ESCAPE '\\'")
        params.append('%' + search.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%')
    if cursor:
        try:
            if len(cursor) > 1024:
                raise ValueError()
            stamp, event_id = json.loads(base64.urlsafe_b64decode(cursor.encode()))
            parsed = datetime.fromisoformat(stamp)
            if parsed.tzinfo is None or not isinstance(event_id, str) or len(event_id) > 200:
                raise ValueError()
        except (ValueError, TypeError, binascii.Error, UnicodeError):
            raise HTTPException(400, 'Invalid activity cursor') from None
        clauses.append('(occurred_at, event_id) < (%s, %s)')
        params.extend((stamp, event_id))
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    rows = query('''
        WITH events AS (
            SELECT 'imported:' || p.id::text AS event_id, p.id::text AS photo_id,
                   COALESCE(NULLIF(p.original_filename, ''), NULLIF(p.title, ''), p.id::text) AS filename,
                   p.created_at AS occurred_at, 'imported' AS kind
            FROM photos p
            UNION ALL
            SELECT 'indexed:' || done.photo_id || ':' || p.id::text AS event_id, p.id::text AS photo_id,
                   COALESCE(NULLIF(p.original_filename, ''), NULLIF(p.title, ''), done.photo_id) AS filename,
                   done.processed_at AS occurred_at, 'indexed' AS kind
            FROM processed_photos done
            JOIN LATERAL (
                SELECT candidate.id, candidate.original_filename, candidate.title
                FROM photos candidate
                WHERE candidate.id = CASE WHEN done.photo_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                    THEN done.photo_id::uuid ELSE NULL END
                UNION
                SELECT candidate.id, candidate.original_filename, candidate.title
                FROM photos candidate WHERE candidate.legacy_photo_id = done.photo_id
                UNION
                SELECT candidate.id, candidate.original_filename, candidate.title
                FROM photo_copies f JOIN photos candidate ON candidate.id = f.photo_id
                WHERE f.provider = 'flickr' AND f.provider_key = done.photo_id
            ) p ON true
        )
        SELECT event_id, photo_id, filename, occurred_at, kind FROM events
    ''' + where + ' ORDER BY occurred_at DESC, event_id DESC LIMIT %s', (*params, limit + 1))
    page = [dict(row) for row in rows[:limit]]
    next_cursor = None
    if len(rows) > limit and page:
        last = page[-1]
        stamp = last['occurred_at']
        if hasattr(stamp, 'isoformat'):
            stamp = stamp.isoformat()
        next_cursor = base64.urlsafe_b64encode(json.dumps([stamp, last['event_id']]).encode()).decode()
    return {'events': page, 'next_cursor': next_cursor}
