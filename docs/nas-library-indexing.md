# Index an existing NAS library in place

Kindred can catalog an existing media tree without copying its originals into managed storage. The source mount is read-only. Every installation supplies its own PostgreSQL database, media mount, session secrets, and optional provider credentials; no shared Kindling database is required.

Configure `NAS_LIBRARY_SOURCE`, `KINDRED_DATA_ROOT`, and the release variables in your private environment file. Build the API from the same revision as the source files, then combine the release template with `deploy/ugreen/docker-compose.library.yml`. Start only the intended services:

```sh
docker compose -f docker-compose.release.yml -f docker-compose.library.yml up -d database api nas-discovery nas-previews nas-recognition
```

Do not enable the legacy `library-worker` copy importer for an in-place installation. Existing uploads can continue to use managed storage alongside the read-only library.

The workers follow discovery → previews → recognition:

1. Discovery walks the source tree and commits bounded batches of file locations. It reads file metadata and filenames, without copying, hashing, or decoding originals. Resource-pressure thresholds do not pause discovery. Source plus relative path gives a stable identity; rerunning discovery skips unchanged size/mtime pairs. Completed folders are checkpointed and a finished pass exits normally. Later changes require an explicit `--rescan`; restarting a completed pass does not begin discovery again.
2. Previews start after discovery completes, write persistent 480px JPEGs (video posters use 512px), and extract capture date/location metadata. Four render threads feed one database writer by default. Results are committed in groups of up to 64 using bulk updates; unchanged photo metadata avoids another photo/index rewrite. `KINDRED_PREVIEW_WORKERS` (1–8) and `KINDRED_PREVIEW_COMMIT_SIZE` (16–128) configure these bounds. Restarting retries only uncommitted work; it does not mark a partial batch as complete. Derived files live in the persistent backend data volume, outside the original tree.
3. Recognition, R2 thumbnail publishing and catalog sync, Flickr matching, and bulk NAS-to-Flickr backup wait until discovery is complete and the preview worker has checked that the thumbnail queue is empty. If discovery runs again or new previews enter the queue, these workers finish their current items and stop taking new ones. They resume from their checkpoints when previews catch up.

Recognition processes images using the existing face, object, and visual search models. The Compose worker runs two independent inference processes by default. `KINDRED_RECOGNITION_WORKERS` sets the number of processes, and `KINDRED_RECOGNITION_CPUS` sets the CPU limit. The recognition pass skips color extraction. Videos receive posters and date metadata. Clustering is deferred during this pass, so new detections need a subsequent clustering run to appear as grouped people.

The authenticated `/library/discovery` endpoint reads worker heartbeats. `/library/counts` returns catalog totals cached for up to 60 seconds; indexed photos are counted separately. File locations include duplicate content across folders and may overlap existing imported records; this scan does not claim content deduplication or verified off-site backup. Missing/deleted source files are not automatically removed by discovery.

The owner can browse the configured media directory through `/storage`; members retain library access without raw directory browsing. Path traversal and symlink escapes outside the mount are rejected.

NAS preview recovery generates a JPEG up to 480 pixels per side from oversized images, an embedded RAW preview, or a readable video frame. The Docker image includes libvips, ExifTool, and FFmpeg for these paths. Recovery writes to the preview cache and reads originals from the NAS mount.

Failures remain visible in `nas_source_files.preview_error` and `ml_error`. After fixing the underlying file or decoder issue, an administrator can clear the relevant error to retry it. Unsupported files and files without a readable image or video frame stay in the catalog with an error.

Back up PostgreSQL and persistent backend data. Thumbnails can be regenerated; identities, albums, labels, and account mappings depend on the database. Flickr remains an optional integration and does not make an unverified NAS pointer a backup.

For social login, configure the web server's own Google/Apple credentials from `.env.example`, with exact callback URLs `/api/auth/google/callback` and `/api/auth/apple/callback`. Apple requires an HTTPS domain. Owner-approved verified identity mappings attach existing household accounts; matching an email alone does not grant arbitrary access to a household.

An Apple sign-in can attach to an existing Google-linked account when Apple provides the same verified Gmail address and the account has no conflicting Apple connection. Apple relay addresses and third-party Google addresses can be linked explicitly in Settings → Integrations.

Set `AUTH_ORIGIN` to the canonical web origin on both the web and API services. Google development credentials must allow the exact localhost callback, including its port. Apple web sign-in uses the registered HTTPS domain. For passkeys, sign in to that same Kindred address and add a key under Settings → Integrations. Passkeys are scoped to that site and can be removed from the same screen.

Preview heartbeats update every three seconds while fetching, rendering, or saving. Counts are initialized from committed database rows and only advance after a successful transaction. The live event stream updates preview totals directly without repeatedly recounting millions of rows; a rolling worker rate avoids conflicting estimates from multiple open browser tabs. Timing totals distinguish rendering, metadata extraction, and database commits. Decode time is summed across threads, not elapsed wall time.

The Teagle NAS (40 GB RAM) was running PostgreSQL 16 with its default 128 MB shared buffer cache and 1 GB WAL checkpoint limit. Its measured configuration now uses `shared_buffers=2GB`, `effective_cache_size=20GB`, `max_wal_size=8GB`, `checkpoint_timeout=15min`, `bgwriter_lru_maxpages=1000`, and `wal_compression=on`. Both `fsync` and `synchronous_commit` remain enabled. These are instance-specific settings, not assumed requirements for every installation. PostgreSQL's previous auto configuration is retained in its data directory as `postgresql.auto.conf.kindred-before-preview-tuning-20261119`.

The preview deployment uses four CPU cores and a 4 GB memory ceiling. The NAS's separate native thumbnail service is masked for this indexing pass; the NAS Photos application itself remains active.
