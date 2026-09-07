"""Catalog queries shared by library counts and paginated gallery."""
from fastapi import HTTPException

JOINS = """
FROM photos p
LEFT JOIN photo_copies n ON n.photo_id=p.id AND n.provider='nas' AND n.status='available'
LEFT JOIN photo_copies f ON f.photo_id=p.id AND f.provider='flickr' AND f.status='available'
"""
AVAILABLE = "(n.photo_id IS NOT NULL OR f.photo_id IS NOT NULL)"
IMAGE = "(p.media_type IS NULL OR p.media_type LIKE 'image/%')"
INDEXED = "EXISTS (SELECT 1 FROM processed_photos x WHERE x.photo_id IN (p.id::text, p.legacy_photo_id, f.provider_key))"
SORTS = {
    "newest": "COALESCE(p.taken_at,p.created_at) DESC, p.id DESC",
    "oldest": "COALESCE(p.taken_at,p.created_at) ASC, p.id ASC",
    "added": "p.created_at DESC, p.id DESC",
    "name": "lower(COALESCE(NULLIF(p.title,''),p.original_filename,'')) ASC, p.id ASC",
}


def counts(query):
    row = dict(query(f"""SELECT
        count(*) AS total_files,
        count(*) FILTER (WHERE {IMAGE}) AS photos,
        count(*) FILTER (WHERE p.media_type LIKE 'video/%') AS videos,
        count(*) FILTER (WHERE n.photo_id IS NOT NULL) AS on_nas,
        count(*) FILTER (WHERE f.photo_id IS NOT NULL) AS on_flickr,
        count(*) FILTER (WHERE {IMAGE} AND {INDEXED}) AS indexed_photos
        {JOINS} WHERE {AVAILABLE}""")[0])
    row['pending_index'] = max(0, row['photos'] - row['indexed_photos'])
    return row


def gallery(query, sort, offset, limit):
    if sort not in SORTS:
        raise HTTPException(400, 'Unsupported gallery sort')
    # Fetch one extra row to determine whether another page exists.
    rows = query(f"""SELECT p.id::text AS photo_id,
        COALESCE(NULLIF(p.title,''),p.original_filename,'Untitled') AS photo_title,
        COALESCE(p.taken_at,p.created_at) AS date_taken,
        f.remote_url AS flickr_url
        {JOINS} WHERE {AVAILABLE} AND {IMAGE}
        ORDER BY {SORTS[sort]} LIMIT %s OFFSET %s""", (limit + 1, offset))
    has_more = len(rows) > limit
    return {'photos': [dict(row) for row in rows[:limit]],
            'next_offset': offset + limit if has_more else None}
