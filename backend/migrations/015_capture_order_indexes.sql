-- Match library_api's undated-last ordering exactly. The original indexes use
-- created_at as a fallback and cannot satisfy these cursor/page ORDER BYs.
CREATE INDEX IF NOT EXISTS idx_photos_capture_newest
    ON photos ((COALESCE(taken_at, '0001-01-01'::timestamptz)) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_photos_kind_capture_newest
    ON photos (media_kind, (COALESCE(taken_at, '0001-01-01'::timestamptz)) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_photos_capture_oldest
    ON photos ((COALESCE(taken_at, '9999-12-31'::timestamptz)) ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_photos_kind_capture_oldest
    ON photos (media_kind, (COALESCE(taken_at, '9999-12-31'::timestamptz)) ASC, id ASC);
