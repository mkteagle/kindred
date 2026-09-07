ALTER TABLE photos ADD COLUMN IF NOT EXISTS client_upload_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_client_upload_id
    ON photos(client_upload_id)
    WHERE client_upload_id IS NOT NULL;
