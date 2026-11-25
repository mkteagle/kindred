-- Track face failures independently so category failures cannot block People.
ALTER TABLE nas_source_files ADD COLUMN IF NOT EXISTS face_error TEXT;

CREATE INDEX IF NOT EXISTS idx_detections_people_neighbors
    ON detections USING hnsw (embedding vector_cosine_ops)
    WHERE category = 'people' AND embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_detections_people_work
    ON detections (created_at, id) WHERE category = 'people' AND embedding IS NOT NULL;
