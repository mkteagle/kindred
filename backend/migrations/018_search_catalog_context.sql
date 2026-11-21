CREATE INDEX IF NOT EXISTS idx_photos_description_trgm
    ON photos USING gin (description gin_trgm_ops) WHERE description <> '';

CREATE INDEX IF NOT EXISTS idx_nas_copy_path_trgm
    ON photo_copies USING gin (provider_key gin_trgm_ops)
    WHERE provider = 'nas' AND status = 'available';
