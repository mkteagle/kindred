-- Kindred-owned albums. Flickr photosets and NAS symlink trees are both
-- projections of these rows, never the source of truth: an album exists the
-- moment it is created here, and its Flickr photoset is filled in lazily on
-- the first photo (flickr.photosets.create demands a primary photo id).

CREATE TABLE IF NOT EXISTS albums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (name <> ''),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
    description TEXT NOT NULL DEFAULT '',
    flickr_photoset_id TEXT UNIQUE,
    flickr_last_error TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS album_photos (
    album_id UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    -- Relative path of the NAS symlink, under the storage root. NULL when NAS
    -- storage is disabled or the link could not be written.
    nas_link_path TEXT,
    flickr_synced_at TIMESTAMPTZ,
    flickr_last_error TEXT,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (album_id, photo_id)
);

CREATE INDEX IF NOT EXISTS idx_album_photos_photo ON album_photos(photo_id);

-- Photos whose Flickr album membership still needs a retry.
CREATE INDEX IF NOT EXISTS idx_album_photos_pending_flickr
    ON album_photos(album_id)
    WHERE flickr_synced_at IS NULL;

-- Resumable uploads carry their album through to the background finalizer.
ALTER TABLE upload_sessions
    ADD COLUMN IF NOT EXISTS album_id UUID REFERENCES albums(id) ON DELETE SET NULL;
