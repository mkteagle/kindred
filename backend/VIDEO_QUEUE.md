# NAS video mirrors

The checkpoint importer catalogs the full original on NAS, then queues its managed
path in `/app/data/video-mirrors/<photo UUID>/job.json`. It continues importing
photos immediately. `video-worker` consumes these jobs separately from the API,
importer and indexer. Jobs contain privacy and descriptive metadata, never OAuth
credentials. One process lock bounds NAS video conversion to one worker.

FFprobe measures the actual video. FFmpeg generates H.264/AAC MP4 derivatives in
nine-minute segments, with bounded bitrate and two encoding threads. Every output
is checked to be below 950,000,000 bytes and 600 seconds, with duration matching its
source segment. The source is never modified. Numbered Flickr titles and the
manifest preserve ordering. The manifest is atomically saved after each upload;
on restart, recorded parts are skipped. Only completion of every part creates an
available Flickr copy in the catalog. The catalog points to part one; all part
IDs are retained in `manifest.json`. Temporary derivatives are removed after their
receipts are saved. Failures retry after five minutes and include exception type.

Deploy using the Git release deployment command. It builds the API image including
FFmpeg, and starts the additional `video-worker` service. Inspect that container's
logs and the job/manifest JSON files to distinguish queued, retrying and complete
videos. The library worker completing does not mean the video queue is complete.

Current scope is the NAS checkpoint importer. Browser/resumable API upload paths
still need explicit queue response/UI contracts and album propagation for every
part. New managed videos are stored under `originals/videos/xx/UUID/original.ext`.
For existing managed originals, run `python /app/migrate_video_originals.py` to
verify checksums and preview destinations, then repeat with `--apply`. The script
creates a same-filesystem hardlink at the new path and atomically replaces the
old path with a relative symlink before updating the catalog. Every interruption
leaves the original readable, and rerunning completes interrupted database updates.
Existing album links and queued jobs remain readable through the legacy alias.
Checkpoint source paths in the staged export are unchanged. File counts and gallery
fallbacks include the new layout without counting legacy aliases twice. Keep aliases
until all external consumers have migrated; never delete staged sources as part of
this operation. No migration runs automatically during deployment. YouTube uploads are not enabled.

As with other Flickr uploads, a process crash after Flickr accepts a part but
before its receipt reaches disk can leave an unrecorded remote copy. Such an
ambiguous upload cannot be made exactly-once without remote reconciliation.

Upload acceptance is not playback readiness. After all IDs are saved, the worker
checks authenticated `flickr.photos.getInfo` for every part. Flickr's video fields
must report `ready=1`, `pending=0`, `failed=0` before the aggregate copy is available.
Pending jobs keep a `processing` state and recheck after five minutes without
uploading recorded parts again. Explicit remote failures stop the job as `failed`
for investigation, preserving every ID; re-uploading rejected parts requires an
intentional repair. Capture timestamps (offset by each part's start) and location
are applied to every ready part, with durable metadata receipts.

API semantics: https://code.flickr.net/2008/05/01/videos-in-the-flickr-api/
