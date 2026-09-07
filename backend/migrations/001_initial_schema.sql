CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS detections (
    id UUID PRIMARY KEY,
    category TEXT NOT NULL,
    subtype TEXT,
    photo_id TEXT NOT NULL,
    photo_url TEXT NOT NULL DEFAULT '',
    thumb_url TEXT NOT NULL DEFAULT '',
    flickr_url TEXT NOT NULL DEFAULT '',
    photo_title TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',
    bbox JSONB,
    det_score REAL,
    chip TEXT,
    embedding vector(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_detections_photo ON detections(photo_id);
CREATE INDEX IF NOT EXISTS idx_detections_category ON detections(category);

CREATE TABLE IF NOT EXISTS clusters (
    id TEXT NOT NULL,
    category TEXT NOT NULL,
    label TEXT,
    label_source TEXT NOT NULL DEFAULT 'auto',
    avatar_detection_id UUID,
    cover_photo_id TEXT,
    cover_crop JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, category)
);

CREATE TABLE IF NOT EXISTS detection_clusters (
    detection_id UUID NOT NULL REFERENCES detections(id) ON DELETE CASCADE,
    cluster_id TEXT NOT NULL,
    category TEXT NOT NULL,
    pinned BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (detection_id, category)
);
CREATE INDEX IF NOT EXISTS idx_detection_clusters_cluster
    ON detection_clusters(cluster_id, category);

CREATE TABLE IF NOT EXISTS dismissed_faces (
    id BIGSERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    centroid vector(512),
    det_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processed_photos (
    photo_id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photo_embeddings (
    photo_id TEXT PRIMARY KEY,
    clip_embedding vector(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photo_metadata (
    photo_id TEXT PRIMARY KEY,
    date_taken TIMESTAMPTZ,
    latitude REAL,
    longitude REAL,
    location_name TEXT,
    tags TEXT[],
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scene_overrides (
    photo_id TEXT NOT NULL,
    scene TEXT NOT NULL,
    PRIMARY KEY (photo_id, scene)
);

CREATE TABLE IF NOT EXISTS photo_text (
    photo_id TEXT PRIMARY KEY,
    detected_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photo_colors (
    photo_id TEXT PRIMARY KEY,
    colors JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS endpoint_cache (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_labels (
    event_key TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_logs (
    id BIGSERIAL PRIMARY KEY,
    job_id TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    total_photos INTEGER NOT NULL DEFAULT 0,
    new_faces INTEGER NOT NULL DEFAULT 0,
    new_pets INTEGER NOT NULL DEFAULT 0,
    new_vehicles INTEGER NOT NULL DEFAULT 0,
    clusters_created INTEGER NOT NULL DEFAULT 0,
    error TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    flickr_user_id TEXT,
    flickr_oauth_token TEXT,
    flickr_oauth_secret TEXT,
    avatar_photo_id TEXT,
    avatar_upload BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    used_by UUID REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Default',
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
