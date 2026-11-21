CREATE INDEX IF NOT EXISTS idx_photos_title_trgm
    ON photos USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_photos_original_filename_trgm
    ON photos USING gin (original_filename gin_trgm_ops);
