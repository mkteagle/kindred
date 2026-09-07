"""Faceted catalog search: free text crossed with media, date, person and album.

Anchored on `photos` rather than `detections`, so videos are searchable at all.
Detections and embeddings key photos by TEXT — a Flickr id for the legacy
library, a UUID string for anything uploaded since — so every join out to them
goes through `photo_ref_ids`, which lists the identities one catalog row can
be known by.

Ranking free text against pgvector is in tension with filtering: an ANN index
answers "nearest to this vector" and cannot also apply a WHERE clause. So text
searches take the nearest OVERFETCH x limit candidates from the index and
filter those, widening the pool when facets are active. With no text at all
the facets stand alone and the query is a plain indexed range scan.
"""
from fastapi import HTTPException

# How many ANN candidates to pull per requested result. Filtering happens after
# the index answers, so a selective facet needs a wider pool to fill a page.
OVERFETCH = 8
OVERFETCH_WITH_FACETS = 24
MAX_CANDIDATES = 2000

# pgvector caps an HNSW scan at hnsw.ef_search candidates, and the default is
# 40 — so a LIMIT above that silently returns fewer rows than asked for, no
# matter how wide the overfetch. ef_search must therefore be raised to at least
# the candidate pool on every vector query. 1000 is pgvector's own ceiling.
MAX_EF_SEARCH = 1000

JOINS = """
FROM photos p
LEFT JOIN photo_copies n ON n.photo_id=p.id AND n.provider='nas' AND n.status='available'
LEFT JOIN photo_copies f ON f.photo_id=p.id AND f.provider='flickr' AND f.status='available'
"""
AVAILABLE = "(n.photo_id IS NOT NULL OR f.photo_id IS NOT NULL)"

# The identities this catalog row may be stored under in the ML-era tables.
PHOTO_REF_IDS = "ARRAY[p.id::text, p.legacy_photo_id, f.provider_key]"

SELECT_COLUMNS = """p.id::text AS photo_id,
    COALESCE(NULLIF(p.title,''),p.original_filename,'Untitled') AS photo_title,
    COALESCE(p.taken_at,p.created_at) AS date_taken,
    p.media_kind, p.duration_seconds,
    f.remote_url AS flickr_url"""

MEDIA_KINDS = {"all", "photo", "video"}

# Which date a range filter applies to. "taken" is when the camera shot it;
# "added" is when it landed in Kindred, which is the one you want after a bulk
# import where everything shares an import date but spans decades of capture.
TAKEN = "COALESCE(p.taken_at,p.created_at)"
DATE_FIELDS = {"taken": TAKEN, "added": "p.created_at"}
SORTS = {"newest": "DESC", "oldest": "ASC"}


class Facets:
    """Validated filter set. Ordering of `params` follows the SQL it builds."""

    def __init__(self, media="all", date_from=None, date_to=None,
                 cluster_id=None, category=None, album_id=None, date_field="taken"):
        if media not in MEDIA_KINDS:
            raise HTTPException(400, "media must be all, photo, or video")
        if date_field not in DATE_FIELDS:
            raise HTTPException(400, "date_field must be taken or added")
        if cluster_id and not category:
            raise HTTPException(400, "category is required alongside cluster_id")
        self.media = media
        self.date_field = date_field
        self.date_column = DATE_FIELDS[date_field]
        self.date_from = date_from
        self.date_to = date_to
        self.cluster_id = cluster_id
        self.category = category
        self.album_id = album_id

    @property
    def active(self):
        return bool(self.media != "all" or self.date_from or self.date_to
                    or self.cluster_id or self.album_id)

    def where(self):
        """Return (sql_fragments, params) for everything except the text match."""
        clauses, params = [AVAILABLE], []
        if self.media != "all":
            clauses.append("p.media_kind = %s")
            params.append(self.media)
        if self.date_from:
            clauses.append(f"{self.date_column} >= %s")
            params.append(self.date_from)
        if self.date_to:
            # Callers pass a plain date; make the range inclusive of that day.
            clauses.append(f"{self.date_column} < (%s::date + 1)")
            params.append(self.date_to)
        if self.cluster_id:
            clauses.append(f"""EXISTS (
                SELECT 1 FROM detections d
                JOIN detection_clusters dc ON dc.detection_id = d.id
                WHERE d.photo_id = ANY({PHOTO_REF_IDS})
                  AND dc.cluster_id = %s AND dc.category = %s)""")
            params += [self.cluster_id, self.category]
        if self.album_id:
            clauses.append("EXISTS (SELECT 1 FROM album_photos ap "
                           "WHERE ap.photo_id = p.id AND ap.album_id = %s)")
            params.append(self.album_id)
        return clauses, params


def browse(query, facets, sort="newest", limit=60):
    """Facets with no free text: an indexed range scan, newest first."""
    if sort not in SORTS:
        raise HTTPException(400, "sort must be newest or oldest")
    clauses, params = facets.where()
    rows = query(
        f"""SELECT {SELECT_COLUMNS} {JOINS} WHERE {' AND '.join(clauses)}
            ORDER BY COALESCE(p.taken_at,p.created_at) {SORTS[sort]}, p.id {SORTS[sort]}
            LIMIT %s""",
        tuple(params + [limit]),
    )
    return [dict(row) for row in rows]


def candidate_pool(limit, facets):
    """How many ANN candidates to ask the vector index for."""
    factor = OVERFETCH_WITH_FACETS if facets.active else OVERFETCH
    return min(limit * factor, MAX_CANDIDATES)


def ef_search_for(pool):
    """Search-list size for an HNSW scan expected to yield `pool` candidates.

    Must be >= the LIMIT or the index returns short. Kept an int and clamped so
    it can be inlined into SQL — it is derived from our own constants, never
    from caller input.
    """
    return max(1, min(int(pool), MAX_EF_SEARCH))


def by_vector(query, embedding, facets, limit=60):
    """Rank by CLIP distance, then apply facets to the candidate pool.

    The inner query is what touches the ANN index: it must stay a bare
    ORDER BY <-> ... LIMIT over photo_embeddings for the index to be used.
    """
    clauses, params = facets.where()
    pool = candidate_pool(limit, facets)
    rows = query(
        f"""SET LOCAL hnsw.ef_search = {ef_search_for(pool)};
            WITH nearest AS (
                SELECT pe.photo_id, pe.clip_embedding <=> %s AS distance
                FROM photo_embeddings pe
                ORDER BY pe.clip_embedding <=> %s
                LIMIT %s
            )
            SELECT {SELECT_COLUMNS}, nearest.distance {JOINS}
            JOIN nearest ON nearest.photo_id = ANY({PHOTO_REF_IDS})
            WHERE {' AND '.join(clauses)}
            ORDER BY nearest.distance ASC LIMIT %s""",
        tuple([embedding, embedding, pool] + params + [limit]),
    )
    return [dict(row) for row in rows]


def by_text(query, text, facets, limit=60):
    """Literal match on title and filename.

    Videos have no embeddings or detections, so this is the only way free text
    reaches them — without it a text search silently excludes every video.
    """
    clauses, params = facets.where()
    pattern = f"%{text}%"
    rows = query(
        f"""SELECT {SELECT_COLUMNS} {JOINS}
            WHERE {' AND '.join(clauses)}
              AND (p.title ILIKE %s OR p.original_filename ILIKE %s)
            ORDER BY COALESCE(p.taken_at,p.created_at) DESC, p.id DESC
            LIMIT %s""",
        tuple(params + [pattern, pattern, limit]),
    )
    return [dict(row) for row in rows]


def merge(*result_sets, limit):
    """Concatenate ranked result sets, keeping the first hit for each photo."""
    seen, merged = set(), []
    for results in result_sets:
        for row in results:
            if row["photo_id"] in seen:
                continue
            seen.add(row["photo_id"])
            merged.append(row)
            if len(merged) >= limit:
                return merged
    return merged
