-- Short-lived codes that pair a phone with a household's own server.
--
-- A self-hoster's instance lives at a URL only they know, behind their own
-- tunnel. Typing that URL and a password into a phone is the worst part of
-- installing Kindred, so instead the web UI mints a code, the phone reads it,
-- and the phone learns both the address and its credentials in one step.
--
-- The code is a bearer credential for the seconds it lives, so it is stored
-- hashed, expires quickly, and can be claimed exactly once.

CREATE TABLE IF NOT EXISTS pairing_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- What the phone should call itself once paired; set when claimed.
    device_name TEXT,
    -- The address the phone should use, captured at mint time so the code
    -- carries the reachable URL rather than the phone having to guess.
    server_url TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ,
    claimed_ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sweeping expired codes, and rate-limiting how many one account may have open.
CREATE INDEX IF NOT EXISTS idx_pairing_codes_user
    ON pairing_codes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_open
    ON pairing_codes(expires_at)
    WHERE claimed_at IS NULL;
