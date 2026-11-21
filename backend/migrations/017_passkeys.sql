CREATE TABLE IF NOT EXISTS user_passkeys (
    credential_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rp_id TEXT NOT NULL,
    public_key BYTEA NOT NULL,
    sign_count BIGINT NOT NULL CHECK (sign_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys(user_id, rp_id);

CREATE TABLE IF NOT EXISTS passkey_challenges (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    origin TEXT NOT NULL,
    challenge BYTEA NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK ((purpose = 'register') = (user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expiry ON passkey_challenges(expires_at);
