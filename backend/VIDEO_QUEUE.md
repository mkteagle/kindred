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
part. A dedicated original-video directory migration is intentionally separate:
existing provider paths, album hardlinks and checkpoint recovery must be migrated
together, with checksums and a rollback plan. No existing originals are moved by
this change. YouTube uploads are not enabled.

As with other Flickr uploads, a process crash after Flickr accepts a part but
before its receipt reaches disk can leave an unrecorded remote copy. Such an
ambiguous upload cannot be made exactly-once without remote reconciliation.
