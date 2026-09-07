-- Share links: a capability granting read access to exactly one photo or one
-- album, to someone with no Kindred account.
--
-- The token is stored only as a SHA-256 hash, the way api_keys are handled, so
-- a database leak does not hand over working share links. Lookup is by hash of
-- the presented token, which is deterministic and therefore still indexable.
--
-- A share is scoped, revocable and optionally expiring. Nothing here grants
-- access to search or to the catalog: the share endpoints resolve a token to
-- its subject and serve only media inside it.

CREATE TABLE IF NOT EXISTS shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('photo', 'album')),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    album_id UUID REFERENCES albums(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    -- bcrypt hash when the share is password-protected; NULL when it is not.
    password_hash TEXT,
    allow_download BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    view_count BIGINT NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Exactly one subject, matching subject_type. Deleting the subject deletes
    -- the share, so a revoked photo cannot leak through a stale link.
    CHECK (
        (subject_type = 'photo' AND photo_id IS NOT NULL AND album_id IS NULL)
        OR (subject_type = 'album' AND album_id IS NOT NULL AND photo_id IS NULL)
    )
);

-- Listing a household's shares, and finding the shares that expose one subject.
CREATE INDEX IF NOT EXISTS idx_shares_created_by ON shares(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shares_album ON shares(album_id) WHERE album_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shares_photo ON shares(photo_id) WHERE photo_id IS NOT NULL;

-- Live shares only, for expiry sweeps.
CREATE INDEX IF NOT EXISTS idx_shares_expiry ON shares(expires_at)
    WHERE revoked_at IS NULL AND expires_at IS NOT NULL;
