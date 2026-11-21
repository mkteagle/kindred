-- A fast filesystem catalog, separate from original-byte hashing and ML.
CREATE TABLE IF NOT EXISTS nas_source_files (
    source_key TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    byte_size BIGINT NOT NULL,
    mtime_ns BIGINT NOT NULL,
    preview_ready_at TIMESTAMPTZ,
    metadata_ready_at TIMESTAMPTZ,
    preview_error TEXT,
    ml_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_key, relative_path),
    UNIQUE (photo_id)
);
CREATE INDEX IF NOT EXISTS idx_nas_source_preview_pending
    ON nas_source_files (created_at, photo_id) WHERE preview_ready_at IS NULL AND preview_error IS NULL;
