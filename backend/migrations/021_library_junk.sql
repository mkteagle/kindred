ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_library_junk BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS junk_classification TEXT;

-- Existing rows have NULL in the new column. Enforce the constraint on writes
-- without scanning the catalog while the ALTER TABLE lock is held.
ALTER TABLE photos ADD CONSTRAINT photos_junk_classification_valid
    CHECK (junk_classification IN ('photo', 'keep', 'screenshot', 'receipt', 'document', 'code', 'blank'))
    NOT VALID;
