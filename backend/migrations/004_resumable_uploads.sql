CREATE TABLE IF NOT EXISTS upload_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_upload_id TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    taken_at_unix BIGINT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    temp_path TEXT NOT NULL,
    received_bytes BIGINT NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'ready', 'finalizing', 'completed')),
    kindred_photo_id UUID REFERENCES photos(id) ON DELETE SET NULL,
    flickr_photo_id TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
    CHECK (received_bytes <= byte_size)
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_expiry
    ON upload_sessions(expires_at)
    WHERE status <> 'completed';
