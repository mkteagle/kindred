CREATE TABLE IF NOT EXISTS r2_thumbnail_objects (
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    PRIMARY KEY (bucket, object_key)
);
