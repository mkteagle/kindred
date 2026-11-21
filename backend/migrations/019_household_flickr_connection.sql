CREATE TABLE IF NOT EXISTS household_flickr_connection (
    singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    flickr_user_id text NOT NULL CHECK (length(btrim(flickr_user_id)) > 0),
    oauth_token text NOT NULL CHECK (length(btrim(oauth_token)) > 0),
    oauth_secret text NOT NULL CHECK (length(btrim(oauth_secret)) > 0),
    verified_at timestamptz
);

-- Retain the destination of an installation with a single previously linked
-- Flickr identity. Multiple distinct identities require an explicit choice.
WITH existing AS (
    SELECT btrim(flickr_user_id) AS flickr_user_id, flickr_oauth_token,
           flickr_oauth_secret, updated_at, id
    FROM users
    WHERE role = 'admin'
      AND NULLIF(btrim(flickr_user_id), '') IS NOT NULL
      AND NULLIF(btrim(flickr_oauth_token), '') IS NOT NULL
      AND NULLIF(btrim(flickr_oauth_secret), '') IS NOT NULL
)
INSERT INTO household_flickr_connection (flickr_user_id, oauth_token, oauth_secret)
SELECT flickr_user_id, flickr_oauth_token, flickr_oauth_secret
FROM existing
WHERE (SELECT count(DISTINCT flickr_user_id) FROM existing) = 1
ORDER BY updated_at DESC, id
LIMIT 1
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE photo_copies ADD COLUMN IF NOT EXISTS provider_owner_id text;

-- Preserve owner evidence from URLs produced by Kindred's Flickr recorder.
UPDATE photo_copies
SET provider_owner_id = split_part(remote_url, '/', 5)
WHERE provider = 'flickr'
  AND provider_owner_id IS NULL
  AND remote_url ~ '^https://www[.]flickr[.]com/photos/[A-Za-z0-9@_-]+/[0-9]+/?$'
  AND rtrim(split_part(remote_url, '/', 6), '/') = provider_key;
