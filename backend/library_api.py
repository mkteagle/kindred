"""Catalog queries shared by library counts and the paginated gallery."""
from fastapi import HTTPException
import base64
import binascii
import json

JOINS = """
FROM photos p
LEFT JOIN photo_copies n ON n.photo_id=p.id AND n.provider='nas' AND n.status='available'
LEFT JOIN photo_copies f ON f.photo_id=p.id AND f.provider='flickr' AND f.status='available'
"""
AVAILABLE = "(n.photo_id IS NOT NULL OR f.photo_id IS NOT NULL)"
IMAGE = "p.media_kind = 'photo'"
INDEXED = "EXISTS (SELECT 1 FROM processed_photos x WHERE x.photo_id IN (p.id::text, p.legacy_photo_id, f.provider_key))"

# Each sort names the expression it orders by and the direction. Ordering is
# always broken by p.id so the keyset cursor below addresses exactly one row.
SORTS = {
    "newest": ("COALESCE(p.taken_at,p.created_at)", "DESC"),
    "oldest": ("COALESCE(p.taken_at,p.created_at)", "ASC"),
    "added": ("p.created_at", "DESC"),
    "name": ("lower(COALESCE(NULLIF(p.title,''),p.original_filename,''))", "ASC"),
}

MEDIA = {"all": None, "photo": "photo", "video": "video"}


def facet_clauses(media, date_from=None, date_to=None, min_duration=None):
    """Filters the gallery understands beyond its media kind.

    The video screen's "this year" and "over a minute" chips need these: a
    client-side filter over the current page would silently hide matches that
    simply had not been scrolled to yet.
    """
    sql, params = media_clause(media)
    clauses = [sql]
    if date_from:
        clauses.append("COALESCE(p.taken_at,p.created_at) >= %s")
        params.append(date_from)
    if date_to:
        clauses.append("COALESCE(p.taken_at,p.created_at) < (%s::date + 1)")
        params.append(date_to)
    if min_duration is not None:
        clauses.append("p.duration_seconds >= %s")
        params.append(float(min_duration))
    return " AND ".join(clauses), params


def years(query, media="all"):
    """Every year the library covers, newest first, with a count each.

    The year scrubber needs the whole span up front; deriving it from the pages
    fetched so far would show a list that grows as you scroll, which is exactly
    the thing a scrubber exists to avoid.
    """
    kind_sql, params = media_clause(media)
    rows = query(
        f"""SELECT EXTRACT(YEAR FROM COALESCE(p.taken_at,p.created_at))::int AS year,
                   count(*) AS count
            {JOINS} WHERE {AVAILABLE} AND {kind_sql}
              AND COALESCE(p.taken_at,p.created_at) IS NOT NULL
            GROUP BY 1 ORDER BY 1 DESC""",
        tuple(params),
    )
    return [{"year": int(row["year"]), "count": int(row["count"])} for row in rows]


def media_clause(media):
    """Return (sql, params) restricting to one media kind."""
    if media not in MEDIA:
        raise HTTPException(400, "media must be all, photo, or video")
    kind = MEDIA[media]
    return ("p.media_kind = %s", [kind]) if kind else ("TRUE", [])


def encode_cursor(sort_value, photo_id):
    payload = json.dumps({"v": None if sort_value is None else str(sort_value), "id": str(photo_id)})
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_cursor(cursor):
    """Return (sort_value, photo_id) from an opaque cursor."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        return payload["v"], payload["id"]
    except (ValueError, KeyError, TypeError, binascii.Error):
        raise HTTPException(400, "Invalid pagination cursor")


def counts(query):
    row = dict(query(f"""SELECT
        count(*) AS total_files,
        count(*) FILTER (WHERE {IMAGE}) AS photos,
        count(*) FILTER (WHERE p.media_kind = 'video') AS videos,
        count(*) FILTER (WHERE n.photo_id IS NOT NULL) AS on_nas,
        count(*) FILTER (WHERE f.photo_id IS NOT NULL) AS on_flickr,
        count(*) FILTER (WHERE {IMAGE} AND {INDEXED}) AS indexed_photos
        {JOINS} WHERE {AVAILABLE}""")[0])
    row['pending_index'] = max(0, row['photos'] - row['indexed_photos'])
    return row


def gallery(query, sort, limit, media="all", cursor=None,
            date_from=None, date_to=None, min_duration=None, favorited_by=None):
    """One page of the catalog, ordered by `sort` and filtered by `media`.

    Pages by keyset rather than OFFSET: the cursor carries the last row's sort
    value and id, so page N costs the same as page 1 no matter how deep the
    scroll goes. Migration 006 adds the composite indexes this relies on.
    """
    if sort not in SORTS:
        raise HTTPException(400, 'Unsupported gallery sort')
    order_expr, direction = SORTS[sort]
    kind_sql, params = facet_clauses(media, date_from, date_to, min_duration)

    if favorited_by:
        # Favourites are one member's own, so this is always scoped to a user
        # rather than being a household-wide flag on the photo.
        kind_sql += (" AND EXISTS (SELECT 1 FROM photo_favorites pf"
                     " WHERE pf.photo_id = p.id AND pf.user_id = %s)")
        params.append(favorited_by)

    keyset = "TRUE"
    if cursor:
        sort_value, last_id = decode_cursor(cursor)
        # Strictly after the cursor row in the sort's own direction. The row
        # comparison keeps the tie-break on id consistent with ORDER BY.
        comparison = "<" if direction == "DESC" else ">"
        keyset = f"({order_expr}, p.id) {comparison} (%s, %s)"
        params += [sort_value, last_id]

    # One extra row tells us whether a further page exists.
    params += [limit + 1]
    rows = query(f"""SELECT p.id::text AS photo_id,
        COALESCE(NULLIF(p.title,''),p.original_filename,'Untitled') AS photo_title,
        COALESCE(p.taken_at,p.created_at) AS date_taken,
        p.media_kind, p.duration_seconds,
        {order_expr} AS sort_value,
        f.remote_url AS flickr_url
        {JOINS} WHERE {AVAILABLE} AND {kind_sql} AND {keyset}
        ORDER BY {order_expr} {direction}, p.id {direction} LIMIT %s""", tuple(params))

    has_more = len(rows) > limit
    page = [dict(row) for row in rows[:limit]]
    next_cursor = encode_cursor(page[-1]['sort_value'], page[-1]['photo_id']) if has_more and page else None
    for row in page:
        row.pop('sort_value', None)
    return {'photos': page, 'next_cursor': next_cursor}
