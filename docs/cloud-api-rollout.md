# Kindred cloud API rollout

Vercel handles accounts, shared catalog reads, search filters, and upload coordination. Railway is the source of truth for the catalog. The NAS holds originals and runs ingest, image decoding, video processing, and inference. Cloudflare R2 carries private gallery thumbnails. Flickr receives a second copy asynchronously for files it accepts.

## 1. Sign-in and catalog

- Deploy a separate Vercel FastAPI project from `backend/`. `app.py` exposes the existing account and catalog handlers. The NAS uses `main:app` with the full worker dependencies. The cloud entry point does not run schema migrations on startup.
- Back up the NAS catalog and Railway's existing Kindred database. Compare the two before choosing the cutover snapshot. Restore and migrate into a separate destination database if Railway has existing data. Verify extensions, users, provider identities, sessions, albums, original-copy mappings, and embeddings before replacing catalog traffic. `backend/check_catalog_cutover.py` checks row counts and identity fingerprints with read-only transactions. Freeze catalog writers during the final comparison.
- Configure both APIs to use the same verified Railway database through a TLS connection. Keep `API_KEY` consistent across the web bridge and APIs. Preserve the existing web origin, session cookie secret, and Apple and Google client settings. Set `KINDRED_CATALOG_BACKEND_URL` on the web deployment only after authenticating against the cloud API and checking the first library page. `BACKEND_URL` continues to identify the NAS media service.
- Test password, Google, Apple, and passkey sign-in where enrolled. Disconnect the NAS from a staging client and verify sign-in, search, albums, favorites, and the gallery. Keep the original catalog snapshot and routing settings for rollback. After live writes begin, preserve or reconcile those writes before reverting the database.

## 2. Private gallery thumbnails

- Use the existing private R2 Standard bucket `kindred-thumbnails`. Configure `KINDRED_R2_BUCKET`, `KINDRED_R2_ACCOUNT_ID`, `KINDRED_R2_ACCESS_KEY_ID`, and `KINDRED_R2_SECRET_ACCESS_KEY` in deployment secrets. Give the Vercel API a bucket-scoped read credential and the NAS publisher a bucket-scoped write credential.
- Publish a small sample from the NAS preview directory with `python publish_r2_thumbnails.py --checkpoint /app/data/r2-thumbnails.sqlite --limit 50`. Check an authenticated gallery tile, a video poster, and a denied anonymous request. Use a NAS-side scheduler to publish the remainder and reconcile new previews. Reuse the checkpoint for the same bucket. The uploader reads derived previews only.
- Vercel authorizes the catalog identity before issuing a short-lived signed R2 URL. The web gateway returns the redirect to the browser without forwarding Kindred credentials to R2. Until a thumbnail is mirrored, the gallery can fall back to the NAS. Originals and videos use the NAS media service.

## 3. Search by the date it was taken

Use a deterministic date parser for exact date phrases before running text matching or inference. Show the interpreted range as a removable date chip. Use the household's selected time zone and keep a separate capture day when original metadata records a local date without an offset.

| Input | Result |
| --- | --- |
| `November 4` | November 4 of the current household year. Offer **All years** when looking for an older memory. |
| `November 2026` | The entire month, November 1 inclusive to December 1 exclusive. |
| `November 4, 2026` or `2026-11-04` | That one calendar day. |
| `videos November 2026` | Videos taken that month. |
| `bees November 2026` | Match bees within the date range. |

Default to capture date. Keep **Date added** as a separate filter and keep undated files out of exact capture-date results. Query indexed date bounds and paginate with a stable cursor. Show Photos, Videos, and Albums in one results page. An album qualifies when it contains media matching the date range, even if the album was created later. Show its matching count and open it with the same date filter applied.

## 4. Upload once

Use a single durable upload queue across the web dialog and Uploads page. Reuse the resumable backend protocol with an idempotency key and a last-confirmed offset. Vercel creates and authorizes the upload; send large chunks directly to the authenticated NAS ingest endpoint so they bypass Vercel's function payload limit. Preserve the original, commit the catalog receipt once, then return **Saved to Kindred**. Show thumbnail processing and Flickr mirroring as separate background stages.

An interrupted transfer resumes without creating a duplicate. A Flickr outage leaves the NAS original and catalog entry usable; retry transient failures with backoff and show unsupported files as **Kept on NAS**. Preserve capture metadata and explicit privacy settings when mirroring. An upload initiated while the NAS is offline stays pending for retry. A later optional staging design can accept originals in the cloud during NAS outages with its own storage and retention budget.
