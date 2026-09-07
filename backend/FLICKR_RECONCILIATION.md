# Flickr to NAS dry run

`flickr_reconcile.py` inventories the authenticated Flickr account's photos and
videos and compares exact Flickr IDs to the NAS catalog and video manifests.
It has no transfer or deletion mode. Credentials stay in the existing backend.

Run in the backend runtime, with the existing database and storage mounts:

```sh
python flickr_reconcile.py --output /app/data/flickr-reconciliation.json
```

The default checks local file presence and size without hashing originals. It
reports `linked_requires_hash`; this is not proof of an intact backup. After
Takeout resource contention ends, `--verify-sha256` verifies linked original bytes
and reports `skip_verified_original`. Every mapped video part shares its source
original verification. Missing/incorrect owner or hash stamps and conflicting
links are review items, never automatic skips. HEIF/JPEG conversion labels are
inferred from an existing identity link and formats, not a historic encoder receipt.

Unlinked photos are `download_candidate`: the NAS may have an unlinked copy.
Unlinked videos are `resolve_video_original`; a thumbnail URL must never be used
as a video original. Missing known originals are `recover_missing_original`.

The report includes per-item reasons, part numbers/time ranges, source paths and
aggregate counts. `complete` describes pagination coverage, not backup completion.
Active Flickr uploads can change pagination; changed totals, duplicate IDs or
limited samples require a repeat scan. `--max-pages N` bounds an exploratory run.
The scan freezes `max_upload_date` at startup, includes all four content types,
and requests `safe_search=3` with the owner's credentials. Later uploads require
another incremental scan. The cutoff reduces shifting pages but cannot prevent
changes to existing items or delayed Flickr indexing.
Exit 2 means incomplete inventory; exceptions mean the run failed. Output refuses
to overwrite an existing report. Original files, SQL rows and manifests are read-only.

Remaining before bulk recovery: source URL resolution (especially real video
originals), resumable downloads with integrity validation, durable catalog/receipt
updates, unlinked-original matching, metadata/album preservation, and restart/restore
tests. No cloud deletion is authorized by this report. A Flickr derivative may
not retain the bytes/quality of the original uploaded from a device.

API: https://www.flickr.com/services/api/flickr.people.getPhotos.html

## NAS validation, 2026-09-07

The cutoff scan finished with exit 0: 89,892 unique Flickr items across 180 pages,
matching a stable reported total. Of these, 11,269 linked Flickr items map to
11,253 NAS originals with matching sizes (not yet hashed); 78,228 photos and 395
videos remain unlinked candidates. Linked items include 850 inferred HEIF/JPEG
conversions and 38 video derivative parts. One manifest has an unverified owner
and requires review. This proves inventory coverage for the cutoff, not a complete
NAS backup or recovery readiness.

The script and reports are retained in the API container's persistent `/app/data`
mount, backed by `/volume1/docker/Files/kindred/deploy/ugreen/data/backend` on the
NAS. Final report: `flickr-reconciliation-20260907-cutoff.json`. The earlier
`flickr-reconciliation-20260907.json` is an incomplete scan retained for diagnosis.

Run another metadata-only scan on the NAS with a new output filename:

```sh
sudo docker exec -e PYTHONPATH=/app kindred-api-1 \
  python /app/data/flickr_reconcile.py \
  --output /app/data/flickr-reconciliation-NEW-RUN.json
```

Thirteen focused tests pass, covering converted originals, multipart videos,
incorrect/missing hashes, ownership, unsafe paths, fixed-cutoff pagination,
duplicate IDs and changing totals. Bulk downloads and cloud deletion were not run.
