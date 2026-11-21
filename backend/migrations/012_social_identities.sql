-- Provider identities are explicit links to household accounts. Never match by email.
-- The migration runner also runs on a fresh database, before API bootstrapping.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    flickr_user_id TEXT,
    flickr_oauth_token TEXT,
    flickr_oauth_secret TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_identities (
    provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
    subject TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject),
    UNIQUE (user_id, provider)
);
CREATE TABLE IF NOT EXISTS social_auth_assertions (
    id TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);
