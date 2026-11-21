ALTER TABLE replication_jobs
    ADD COLUMN IF NOT EXISTS phone_backup boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_replication_jobs_phone_photo
    ON replication_jobs (photo_id) WHERE phone_backup;
