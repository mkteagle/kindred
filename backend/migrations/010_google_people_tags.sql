-- Google's own face tags, as exported in each Takeout sidecar.
--
-- Google names the people in a photo but never says which face is which: a
-- sidecar carries [{"name": "Madison Teagle"}, {"name": "Britain Teagle"}] and
-- no bounding boxes. That is still enough to name a face cluster, because a
-- photo tagged with exactly one name and containing exactly one face is an
-- unambiguous statement about that face.
--
-- Kept as raw evidence rather than applied directly. Google's tags are one
-- household's labelling of its own photos, sometimes wrong, and a name written
-- into a cluster is hard to take back -- so these are stored, matched, and then
-- proposed.

CREATE TABLE IF NOT EXISTS photo_people_tags (
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'google_takeout',
    PRIMARY KEY (photo_id, name, source)
);

-- "which photos is this name on" — the matcher's inner loop.
CREATE INDEX IF NOT EXISTS idx_photo_people_tags_name
    ON photo_people_tags(name);

-- "how many names does this photo carry" — one is the unambiguous case.
CREATE INDEX IF NOT EXISTS idx_photo_people_tags_photo
    ON photo_people_tags(photo_id);
