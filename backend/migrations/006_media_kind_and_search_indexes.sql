-- Make video a first-class media kind, and give the catalog and search the
-- indexes they have been running without.
--
-- The dominant cost in search was photo_embeddings: a 512-dimension cosine
-- distance computed over every row, every query, with no index at all. The
-- gallery had a matching problem — no index backing its sort — so every page
-- re-sorted the library.

-- OPERATIONAL NOTE: adding a STORED generated column rewrites the photos table,
-- and these CREATE INDEX statements take a write lock while they build. The
-- migration runner wraps each file in one transaction, so CONCURRENTLY is not
-- available here. On a large library, run this during a maintenance window.

-- ── media_kind ───────────────────────────────────────────────────────────────
-- media_type is a MIME string, so filtering it means LIKE 'video/%', which no
-- btree can serve. A stored generated column turns the media facet into an
-- equality predicate that composite indexes can lead with. NULL media_type
-- stays a photo, preserving the behaviour of the old IMAGE filter.
ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS media_kind TEXT
    GENERATED ALWAYS AS (
        CASE WHEN media_type LIKE 'video/%' THEN 'video' ELSE 'photo' END
    ) STORED;

-- Videos carry a duration for the grid badge and the player. Filled in lazily
-- by ffprobe the first time a poster frame is generated.
ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION;

-- ── Catalog ordering ─────────────────────────────────────────────────────────
-- Each gallery sort gets an index that satisfies both its ORDER BY and its
-- keyset cursor, in two shapes: one leading with media_kind for a filtered
-- section, one without for the unfiltered grid.
CREATE INDEX IF NOT EXISTS idx_photos_taken
    ON photos ((COALESCE(taken_at, created_at)) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_photos_kind_taken
    ON photos (media_kind, (COALESCE(taken_at, created_at)) DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_added
    ON photos (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_photos_kind_added
    ON photos (media_kind, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_name
    ON photos ((lower(COALESCE(NULLIF(title, ''), original_filename, ''))) ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_photos_kind_name
    ON photos (media_kind, (lower(COALESCE(NULLIF(title, ''), original_filename, ''))) ASC, id ASC);

-- ── Search ───────────────────────────────────────────────────────────────────
-- Approximate nearest neighbour over the CLIP embeddings. HNSW where the
-- installed pgvector supports it, ivfflat otherwise; either is worth orders of
-- magnitude over the sequential scan this replaces.
DO $$
BEGIN
    BEGIN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_photo_embeddings_clip_hnsw '
                'ON photo_embeddings USING hnsw (clip_embedding vector_cosine_ops)';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'hnsw unavailable (%), falling back to ivfflat', SQLERRM;
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_photo_embeddings_clip_ivfflat '
                'ON photo_embeddings USING ivfflat (clip_embedding vector_cosine_ops) '
                'WITH (lists = 100)';
    END;
END $$;

-- Person search matches with similarity() and ILIKE '%name%'; pg_trgm was
-- already installed but nothing indexed with it.
CREATE INDEX IF NOT EXISTS idx_clusters_label_trgm
    ON clusters USING gin (label gin_trgm_ops);

-- Date faceting. The person facet's path is already covered: detections has
-- idx_detections_photo, and detection_clusters is served by its primary key
-- (detection_id, category) plus idx_detection_clusters_cluster.
CREATE INDEX IF NOT EXISTS idx_photo_metadata_date ON photo_metadata(date_taken DESC);
