CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_photo_id TEXT UNIQUE,
    sha256 TEXT UNIQUE,
    original_filename TEXT,
    media_type TEXT,
    byte_size BIGINT,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    taken_at TIMESTAMPTZ,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS photo_copies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('nas', 'flickr')),
    provider_key TEXT,
    storage_path TEXT,
    remote_url TEXT,
    sha256 TEXT,
    byte_size BIGINT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'available', 'failed', 'deleted')),
    last_error TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (photo_id, provider),
    UNIQUE (provider, provider_key),
    CHECK (
        (provider = 'nas' AND storage_path IS NOT NULL)
        OR provider = 'flickr'
    )
);
CREATE INDEX IF NOT EXISTS idx_photo_copies_status ON photo_copies(provider, status);

CREATE TABLE IF NOT EXISTS replication_jobs (
    id BIGSERIAL PRIMARY KEY,
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    source_provider TEXT NOT NULL CHECK (source_provider IN ('nas', 'flickr')),
    target_provider TEXT NOT NULL CHECK (target_provider IN ('nas', 'flickr')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'retry', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    CHECK (source_provider <> target_provider)
);
CREATE INDEX IF NOT EXISTS idx_replication_jobs_queue
    ON replication_jobs(status, next_attempt_at);

-- Preserve the Flickr-era identity while introducing stable Kindred UUIDs.
INSERT INTO photos (legacy_photo_id, title, taken_at, latitude, longitude)
SELECT ids.photo_id,
       COALESCE(d.photo_title, ''),
       pm.date_taken,
       pm.latitude,
       pm.longitude
FROM (
    SELECT photo_id FROM detections
    UNION
    SELECT photo_id FROM photo_metadata
    UNION
    SELECT photo_id FROM photo_embeddings
    UNION
    SELECT photo_id FROM processed_photos
) ids
LEFT JOIN LATERAL (
    SELECT photo_title
    FROM detections
    WHERE detections.photo_id = ids.photo_id
    LIMIT 1
) d ON true
LEFT JOIN photo_metadata pm ON pm.photo_id = ids.photo_id
ON CONFLICT (legacy_photo_id) DO NOTHING;

INSERT INTO photo_copies (
    photo_id, provider, provider_key, remote_url, status, last_synced_at
)
SELECT p.id,
       'flickr',
       p.legacy_photo_id,
       NULLIF(d.flickr_url, ''),
       'available',
       now()
FROM photos p
LEFT JOIN LATERAL (
    SELECT flickr_url
    FROM detections
    WHERE detections.photo_id = p.legacy_photo_id
    LIMIT 1
) d ON true
WHERE p.legacy_photo_id IS NOT NULL
ON CONFLICT (provider, provider_key) DO NOTHING;
