-- Per-member favourites.
--
-- Deliberately per member, not per household: two people in a house do not
-- keep the same photos close, and a shared list would mean one person's taste
-- quietly overwriting another's. The sidebar count is therefore the signed-in
-- member's own, never a household total.

CREATE TABLE IF NOT EXISTS photo_favorites (
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (photo_id, user_id)
);

-- "My favourites, newest first" — the only query the Favorites screen makes.
CREATE INDEX IF NOT EXISTS idx_photo_favorites_user
    ON photo_favorites(user_id, created_at DESC);
