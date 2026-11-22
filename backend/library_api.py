"""Catalog queries shared by library counts and the paginated gallery."""
from fastapi import HTTPException
import base64
import binascii
import json

from library_junk import JUNK, visibility

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
# A photo whose capture date we could not recover has no date. Falling back
# to created_at made every such photo claim the day it was imported, which put
# all of them at the top of "newest" and made the library look like it was shot
# this afternoon. Sort them to the far end instead, with a sentinel that keeps
# the expression non-null so the keyset cursor below still compares cleanly.
UNDATED_LAST_DESC = "COALESCE(p.taken_at,'0001-01-01')"
UNDATED_LAST_ASC = "COALESCE(p.taken_at,'9999-12-31')"

SORTS = {
    "newest": (UNDATED_LAST_DESC, "DESC"),
    "oldest": (UNDATED_LAST_ASC, "ASC"),
    "added": ("p.created_at", "DESC"),
    "name": ("lower(COALESCE(NULLIF(p.title,''),p.original_filename,''))", "ASC"),
}

MEDIA = {"all": None, "photo": "photo", "video": "video"}


def facet_clauses(media, date_from=None, date_to=None, min_duration=None, *, capture_order=None):
    """Filters the gallery understands beyond its media kind.

    The video screen's "this year" and "over a minute" chips need these: a
    client-side filter over the current page would silently hide matches that
    simply had not been scrolled to yet.
    """
    sql, params = media_clause(media)
    clauses = [sql]
    date_column = capture_order or "p.taken_at"
    if capture_order and (date_from or date_to):
        # Keep undated rows out even when only one bound is supplied. Use the
        # indexed sort expression for the bounds so Postgres can seek to them.
        clauses.append("p.taken_at IS NOT NULL")
    if date_from:
        clauses.append(f"{date_column} >= %s")
        params.append(date_from)
    if date_to:
        clauses.append(f"{date_column} < (%s::date + 1)")
        params.append(date_to)
    if min_duration is not None:
        clauses.append("p.duration_seconds >= %s")
        params.append(float(min_duration))
    return " AND ".join(clauses), params


def years(query, media="all", junk="all"):
    """Every year the library covers, newest first, with a count each.

    The year scrubber needs the whole span up front; deriving it from the pages
    fetched so far would show a list that grows as you scroll, which is exactly
    the thing a scrubber exists to avoid.
    """
    kind_sql, params = media_clause(media)
    junk_sql, junk_params = visibility(junk)
    rows = query(
        f"""/*kindred-catalog-aggregate*/ SELECT EXTRACT(YEAR FROM p.taken_at)::int AS year,
                   count(*) AS count
            {JOINS} WHERE {AVAILABLE} AND {kind_sql} AND {junk_sql}
              AND p.taken_at IS NOT NULL
            GROUP BY 1 ORDER BY 1 DESC""",
        tuple(params + junk_params),
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
    row = dict(query(f"""/*kindred-catalog-aggregate*/ WITH indexed_ids AS (
        SELECT p.id FROM processed_photos x JOIN photos p ON x.photo_id=p.id::text
        UNION
        SELECT p.id FROM processed_photos x JOIN photos p ON x.photo_id=p.legacy_photo_id
        UNION
        SELECT copy.photo_id FROM processed_photos x JOIN photo_copies copy
          ON copy.provider='flickr' AND copy.status='available' AND copy.provider_key=x.photo_id
    ) SELECT
        count(*) AS total_files,
        count(*) FILTER (WHERE {IMAGE}) AS photos,
        count(*) FILTER (WHERE p.media_kind = 'video') AS videos,
        count(*) FILTER (WHERE n.photo_id IS NOT NULL) AS on_nas,
        count(*) FILTER (WHERE f.photo_id IS NOT NULL) AS on_flickr,
        count(*) FILTER (WHERE {IMAGE} AND done_ids.id IS NOT NULL) AS indexed_photos
        {JOINS} LEFT JOIN indexed_ids done_ids ON done_ids.id=p.id WHERE {AVAILABLE}""")[0])
    row['pending_index'] = max(0, row['photos'] - row['indexed_photos'])
    return row


def visible_counts(query, junk, viewer_id=None):
    junk_sql, params = visibility(junk, viewer_id)
    return dict(query(
        f"""/*kindred-catalog-aggregate*/ SELECT
            count(*) AS total_files,
            count(*) FILTER (WHERE {IMAGE}) AS photos,
            count(*) FILTER (WHERE p.media_kind = 'video') AS videos
            {JOINS} WHERE {AVAILABLE} AND {junk_sql}""",
        tuple(params),
    )[0])


def is_favorite(query, photo_id, user_id):
    rows = query(
        "SELECT 1 FROM photo_favorites WHERE photo_id = %s AND user_id = %s",
        (photo_id, user_id),
    )
    return bool(rows)


def gallery(query, sort, limit, media="all", cursor=None,
            date_from=None, date_to=None, min_duration=None, favorited_by=None, album_id=None,
            junk="all", viewer_id=None, thumbnail_bucket=None):
    """One page of the catalog, ordered by `sort` and filtered by `media`.

    Pages by keyset rather than OFFSET: the cursor carries the last row's sort
    value and id, so page N costs the same as page 1 no matter how deep the
    scroll goes. Migration 006 adds the composite indexes this relies on.
    """
    if sort not in SORTS:
        raise HTTPException(400, 'Unsupported gallery sort')
    order_expr, direction = SORTS[sort]
    capture_order = order_expr if sort in {"newest", "oldest"} else None
    kind_sql, params = facet_clauses(media, date_from, date_to, min_duration, capture_order=capture_order)

    if favorited_by:
        # Favourites are one member's own, so this is always scoped to a user
        # rather than being a household-wide flag on the photo.
        kind_sql += (" AND EXISTS (SELECT 1 FROM photo_favorites pf"
                     " WHERE pf.photo_id = p.id AND pf.user_id = %s)")
        params.append(favorited_by)

    if album_id:
        kind_sql += " AND EXISTS (SELECT 1 FROM album_photos ap WHERE ap.photo_id = p.id AND ap.album_id = %s)"
        params.append(album_id)

    junk_sql, junk_params = visibility(junk, viewer_id)
    params += junk_params

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
    page_sql = f"""SELECT p.id::text AS photo_id,
        COALESCE(NULLIF(p.title,''),p.original_filename,'Untitled') AS photo_title,
        p.taken_at AS date_taken,
        p.media_kind, p.duration_seconds,
        CASE WHEN {JUNK} THEN p.junk_classification END AS junk_reason,
        {order_expr} AS sort_value,
        f.remote_url AS flickr_url
        {JOINS} WHERE {AVAILABLE} AND {kind_sql} AND {junk_sql} AND {keyset}
        ORDER BY {order_expr} {direction}, p.id {direction} LIMIT %s"""
    if thumbnail_bucket:
        from r2_thumbnails import THUMBNAIL_PREFIX

        # Limit the catalog query first, then look up only this page's R2 keys.
        page_sql = f"""SELECT page.*, thumbnail.object_key AS thumbnail_object_key
            FROM ({page_sql}) page
            LEFT JOIN r2_thumbnail_objects thumbnail ON thumbnail.bucket = %s
              AND thumbnail.object_key = %s || page.photo_id || '.jpg'
            ORDER BY page.sort_value {direction}, page.photo_id::uuid {direction}"""
        params += [thumbnail_bucket, THUMBNAIL_PREFIX]
    rows = query(page_sql, tuple(params))

    has_more = len(rows) > limit
    page = [dict(row) for row in rows[:limit]]
    next_cursor = encode_cursor(page[-1]['sort_value'], page[-1]['photo_id']) if has_more and page else None
    for row in page:
        row.pop('sort_value', None)
    return {'photos': page, 'next_cursor': next_cursor}
