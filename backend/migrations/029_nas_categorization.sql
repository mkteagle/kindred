-- Preserve existing full-recognition receipts and track the early category pass separately.
ALTER TABLE nas_source_files ADD COLUMN IF NOT EXISTS categorized_at TIMESTAMPTZ;
