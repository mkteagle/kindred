-- The activity feed reads existing durable history, including pre-feature records.
CREATE INDEX IF NOT EXISTS idx_processed_photos_activity
    ON processed_photos(processed_at DESC, photo_id DESC);
