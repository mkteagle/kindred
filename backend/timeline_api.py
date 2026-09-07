"""Month-paginated timeline queries.

The timeline used to return the whole library in one response and group it in
Python, so its cost grew with the library forever. Grouping now happens in SQL
and the endpoint hands back a bounded page of months at a time.
"""
from fastapi import HTTPException

from search_api import AVAILABLE, JOINS, Facets

MAX_MONTHS = 24


def month_key(value):
    """YYYY-MM for a datetime or an ISO-ish string."""
    return value.strftime("%Y-%m") if hasattr(value, "strftime") else str(value)[:7]


def months_page(query, facets, months=3, before=None):
    """Return the newest `months` month buckets, older than `before`.

    Two queries rather than one: the month list is a cheap indexed aggregate,
    and only the photos inside those months are then fetched.
    """
    if not 1 <= months <= MAX_MONTHS:
        raise HTTPException(400, f"months must be between 1 and {MAX_MONTHS}")

    clauses, params = facets.where()
    # Undated photos have no bucket to sit in, and a NULL month sorts ahead of
    # every real one under DESC, so it would head the page.
    clauses = list(clauses) + ["p.taken_at IS NOT NULL"]
    # A month view can only show photos that have a month. Undated photos used
    # to fall back to created_at, which piled every one of them into the month
    # they were imported; they belong in the gallery's "Undated" section, not
    # in a bucket labelled with the day they arrived.
    bucket = "to_char(p.taken_at, 'YYYY-MM')"

    month_clauses = list(clauses)
    month_params = list(params)
    if before:
        month_clauses.append(f"{bucket} < %s")
        month_params.append(before)

    # One extra bucket tells us whether an older page exists.
    rows = query(
        f"""SELECT {bucket} AS month, count(*) AS count {JOINS}
            WHERE {' AND '.join(month_clauses)}
            GROUP BY 1 ORDER BY 1 DESC LIMIT %s""",
        tuple(month_params + [months + 1]),
    )
    buckets = [dict(row) for row in rows]
    has_more = len(buckets) > months
    buckets = buckets[:months]
    if not buckets:
        return [], None

    photo_clauses = list(clauses) + [f"{bucket} = ANY(%s)"]
    photos = query(
        f"""SELECT p.id::text AS photo_id, {bucket} AS month,
            p.taken_at AS date_taken,
            COALESCE(NULLIF(p.title,''),p.original_filename,'') AS photo_title,
            p.media_kind, p.duration_seconds,
            f.remote_url AS flickr_url, n.provider_key AS nas_provider_key
            {JOINS} WHERE {' AND '.join(photo_clauses)}
            ORDER BY p.taken_at DESC, p.id DESC""",
        tuple(list(params) + [[b["month"] for b in buckets]]),
    )

    grouped = {b["month"]: [] for b in buckets}
    for row in photos:
        grouped.setdefault(row["month"], []).append(dict(row))
    page = [{"month": b["month"], "count": int(b["count"]), "photos": grouped[b["month"]]}
            for b in buckets]
    return page, (buckets[-1]["month"] if has_more else None)
