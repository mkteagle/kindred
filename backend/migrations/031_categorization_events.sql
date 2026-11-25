CREATE TABLE categorization_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    source_mtime_ns BIGINT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('historical_failure', 'failed', 'recovered')),
    attempt INTEGER NOT NULL CHECK (attempt >= 0),
    code TEXT NOT NULL,
    detail TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX categorization_events_photo_latest ON categorization_events (photo_id, id DESC);

CREATE TABLE categorization_retries (
    photo_id UUID PRIMARY KEY REFERENCES nas_source_files(photo_id) ON DELETE CASCADE,
    source_mtime_ns BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX categorization_retries_due ON categorization_retries (next_attempt_at, photo_id);

WITH previous_failures AS (
    INSERT INTO categorization_retries (photo_id, source_mtime_ns)
    SELECT photo_id, mtime_ns FROM nas_source_files
    WHERE categorized_at IS NULL AND ml_error IS NOT NULL
    RETURNING photo_id, source_mtime_ns
)
INSERT INTO categorization_events (photo_id, source_mtime_ns, outcome, attempt, code, detail)
SELECT photo_id, source_mtime_ns, 'historical_failure', 0, 'legacy_failure',
       'The previous worker did not record a specific reason. This item is queued for a new attempt.'
FROM previous_failures;

ALTER TABLE detections
    ADD COLUMN bbox_frame_width INTEGER,
    ADD COLUMN bbox_frame_height INTEGER;
