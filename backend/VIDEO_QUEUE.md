# NAS video mirrors

The full original remains byte-for-byte in `PHOTO_STORAGE_ROOT/videos/xx/UUID/original.ext`.
The existing `video-worker` service, `video_queue.enqueue(photo_id, source, metadata, privacy)`
contract, `/app/data/video-mirrors/<UUID>/job.json`, and dictionary-based `manifest.json` are retained.
`KINDRED_WORKER_DATA` controls the queue parent directory. Back up both jobs and manifests; they
contain durable receipts, never OAuth credentials. No second service or new queue location is used.

The API's ordinary, batch and resumable upload paths, staged importer, checkpoint recovery and
legacy Python bulk uploader all queue video mirroring after durable NAS storage. The original-file
limit is independent of Flickr's derivative limit: 64 GiB by default, overridable through
`VIDEO_ORIGINAL_MAX_BYTES`. Proxy/tunnel limits still apply; use the resumable API or a direct NAS
connection for large files. Desktop receipts allow a nullable Flickr ID and persist the Kindred ID
separately. The existing browser upload page remains photo-only.

A successful upload with `nas_status=available, flickr_status=pending` means the original is safe
and the derivative mirror is queued. A resumable session can be completed before the video mirror;
the worker updates its Flickr receipt later. `GET /photos/<Kindred UUID>/video-mirror` exposes job
status, phase, all part IDs, processing state and errors, including jobs not yet converted.

## Worker phases and integrity

One singleton worker lock remains. Two coroutines independently dispatch conversion and upload;
blocking FFmpeg runs in a thread, so a long conversion does not hold up uploads of already prepared
videos. The existing per-job lock prevents overlapping phases for the same video. Producers return
immediately for an existing job, even while its conversion lock is held. Photos and indexing never
wait for either phase. Conversion/credential failures retry in five minutes; malformed jobs do not
stop queue scanning.

The converter resolves the current NAS catalog provider key rather than trusting the queued absolute
path, verifies the catalog SHA-256, and records a manifest SHA-256 in addition to the legacy size/mtime
fingerprint. The current migration's compatibility symlinks and checkpoint IDs remain valid. New
outputs are numbered H.264/AAC MP4 parts of at most nine minutes, limited to 1080p, 10 Mbps video
bitrate and two encoding threads. Original and output durations/bytes are probed before any upload.
Outputs must be at most 950,000,000 bytes, strictly below 600 seconds, and within two seconds of the
planned duration. The shared Flickr upload helper repeats preflight. Invalid cached outputs return
to conversion; recorded remote parts are never reuploaded. Originals are never transcoded in place.

The five reported durations produce 3, 6, 10, 2 and 2 parts. This configuration assumes Flickr Pro:
[Flickr's limits](https://www.flickrhelp.com/hc/en-us/articles/4404079649300-Flickr-upload-requirements)
allow 1 GB per video and ten-minute Pro playback; free accounts play only three minutes.

Upload acceptance is not playback readiness. The existing authenticated `flickr.photos.getInfo`
verification remains: every part must report `ready=1`, `pending=0`, `failed=0`. Accepted parts retain
receipts while the job is `processing`; rechecks do not reupload them. Explicit remote rejection
stops the job as `failed`, preserving receipts for investigation. Capture timestamps include each
part's source offset, and GPS is applied to every ready part with durable metadata receipts.

After every part is playable, metadata and album synchronization must finish before the catalog
copy becomes available. Part one remains the catalog's primary link; all IDs stay in the manifest.
All parts are added to albums present at completion and to later album additions. Existing generic
album-removal logic is unchanged and does not yet expand removals to every derivative. Resumable
receipts are updated; checkpoint recovery picks up the primary Flickr ID on its next pass. A
manifest's `complete` flag means remote parts are playable; `job.status=done` additionally means
album/catalog synchronization finished. The status API reports the latter as aggregate completion.

## Ambiguous uploads and existing manifests

Version 2 manifests save `uploading` intent before the network request, then fsync the returned
receipt. A timeout or crash in between may mean Flickr accepted the part. The job pauses as
`needs_reconciliation`; other videos continue. It never retries such an upload blindly.

Check the saved destination account for the Kindred UUID and part number in the description, then:

```sh
python /app/reconcile_video_part.py UUID PART --verified-flickr-id FLICKR_ID
# Only after confirming there is no such part in that account:
python /app/reconcile_video_part.py UUID PART --confirmed-absent
```

These arguments are explicit operator assertions. Normal remote readiness verification still runs.
The destination account is stamped before the first upload; changing household Flickr accounts
cannot silently mix parts across accounts.

Old job files are read in place and acquire a `phase` field. Old manifest part dictionaries and
Flickr IDs remain intact. Old cached, unreceipted derivatives pause for reconciliation because the
old worker did not record upload intent. Old partial receipts without an account stamp require an
operator to verify the destination before they resume:

```sh
python /app/reconcile_video_part.py UUID --verified-owner-id FLICKR_NSID
```

For old titles, search by title and part number: the old description did not contain the UUID.
Already completed jobs stay completed. Stop the old worker before starting the reviewed revision;
both use the same service, singleton lock, per-job locks, queue directory and receipt files.

## Deployment, migration and review boundary

Use the existing pinned Git release tooling and `video-worker` service. This integration leaves
`deploy.py`, revision labels, rollback behavior, the reexec launcher, both Compose files, persistent
model-cache code and the FFmpeg-after-pip Docker layer unchanged. No new deployment profile is needed.
No NAS deployment or file migration was performed during development.

Main's checksum-verified `migrate_video_originals.py` remains unchanged. It defaults to dry run;
`--apply` creates a same-filesystem hard link, atomically replaces the old name with a relative
symlink, then updates SQL. Interrupted runs remain readable and resumable. Stop storage writers
before migration; keep compatibility aliases until every external consumer has migrated. Existing
album symlinks and staged source/checkpoint IDs remain valid. Do not delete staged sources here.
The unrelated `006_media_kind_and_search_indexes.sql` work is not included or changed.

Optional private YouTube copies remain design-only. Confirm the destination Google account and
channel ID first, including Brand Account selection. Setup requires a Google Cloud project with
YouTube Data API enabled, OAuth consent/client credentials, a securely stored refresh token with
minimum `youtube.upload` scope, and long-video eligibility. Explicitly request private visibility;
store resumable session/channel/video IDs and processing status separately from Flickr. See
[Google's API setup](https://developers.google.com/youtube/v3/getting-started) and
[video status documentation](https://developers.google.com/youtube/v3/docs/videos). NAS originals
remain the archive. No YouTube API calls or uploads were made.

Validation: 71 backend tests and five deployment tests pass. The backend suite includes real FFmpeg conversion, API orchestration, accepted/pending/
failed Flickr states, uncertain-upload recovery, legacy receipt upgrade, account and checksum guards,
migration path resolution, all-part album additions, and independent conversion/upload dispatch.
Network and PostgreSQL calls are mocked; no live NAS/Flickr test was run. Cargo is unavailable on
this host, so the small desktop Rust receipt/schema adjustment requires compilation before release.
