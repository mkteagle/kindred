-- On a large live catalog, create these concurrently before running the
-- transactional migrations. The IF NOT EXISTS statements then record the
-- migration without taking a blocking index-build lock.
CREATE INDEX IF NOT EXISTS idx_photos_junk_scan_pending
    ON photos (id) WHERE media_kind = 'photo' AND junk_classification IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_junk_capture
    ON photos ((COALESCE(taken_at, '0001-01-01'::timestamptz)) DESC, id DESC)
    WHERE junk_classification IN ('screenshot', 'receipt', 'document', 'code', 'blank');
