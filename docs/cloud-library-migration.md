# Cloud library migration preparation

Prepared September 7, 2026. No provider sessions, downloads, deletions, deployment,
or subscription changes are performed by this preparation work.

## Implementation available now

`backend/cloud_migration.py` is a standard-library, offline Python CLI. It creates
an account-scoped SHA-256 inventory of a completed local export, including all files
(HEIC, RAW, video, Live Photo motion components, edits and metadata sidecars).
Its audit command checks explicitly mapped NAS files against that snapshot.
It does not establish that an export includes everything in a cloud library or
that its files are unmodified cloud originals. Reports always block cloud cleanup.
Account keys isolate records; this is not yet a server authorization mechanism.

The sample configuration has independent iCloud and Google sources for Michael
and his wife. These are labels, not authenticated accounts. Adjust the directories
to actual completed exports; do not move or rescan the active Takeout transfer.
Keep snapshots/configuration outside git and outside the export root, for example
in the ignored `backend/data/` directory. No passwords or session cookies belong
in configuration, source control, reports, command arguments or logs.

Example commands, when the relevant export has finished:

```sh
python3 backend/cloud_migration.py inventory \
  --config backend/cloud-migration.example.json --account michael-icloud \
  > backend/data/michael-icloud-inventory.json

python3 backend/cloud_migration.py audit \
  --snapshot backend/data/michael-icloud-inventory.json \
  --account michael-icloud --nas-root /data/photos
```

Create the output directory first. Inventory reads/hashes local data only; it can
still consume NAS disk bandwidth and should not run over an actively changing
export. Each resource starts with null `nas_relative_path` and `provider_asset_id`.
The importer adapter must populate the NAS path from a verified receipt, never by
filename guessing. Until that integration exists, audit reports unmapped resources.
Exit codes: 0 = inventory success or all recorded files match; 2 = incomplete NAS
audit; 1 = invalid input/read failure. Exit 0 never authorizes cloud deletion.

## Pipeline to build

Python workers reuse Kindred's durable NAS storage and video queue. Source adapters
feed one migration ledger; web and iOS expose the same per-account progress and
review API. Maintain source ownership even if two people have identical files.
Physical checksum deduplication must not merge account identity or cleanup scope.

1. Bind each person's Kindred identity to a confirmed provider account, library ID
   and destination Flickr account. Separate credential stores, sessions, checkpoints
   and staging directories. Explicitly scope personal versus shared libraries.
2. Inventory stable provider asset IDs, versions, all required resources, albums,
   edits and metadata. Record export generation/completion and capture a subsequent
   delta before claiming full-library coverage. A local directory listing is not
   evidence of complete cloud inventory. Preserve Takeout archives and sidecars.
3. Download available unmodified originals with resumable staging and atomic commit.
   Record source identity, resource role, byte size, hash and transfer receipt;
   preserve both Live Photo components, RAW companions and valuable edited versions.
   A Storage Saver Google upload cannot be turned back into camera-original quality.
4. Import durable originals into NAS, then mirror to Flickr using existing workers.
   Record each photo conversion and all video derivatives: destination owner/ID,
   codec/format, source checksum, part number, offset and duration. Link all parts
   to the full NAS original. Existing `photo_copies` holds one primary Flickr ID;
   the video manifest is required for the complete one-to-many mapping.
5. Independently reopen and hash NAS originals; decode/probe media and verify all
   required resources. Recheck Flickr owner, availability and playable video parts,
   including complete duration coverage and pending/failed states. Exercise restore
   and browsing from NAS. Database `available` flags alone are insufficient:
   `backend/backup_status.py` currently uses those flags for `cleanup_safe` and must
   not be reused as authority for cloud-library deletion.
6. Produce a concrete account-scoped cleanup candidate report containing exact
   source IDs/versions, local verification evidence, remote mirror receipts and
   exceptions. Revalidate before executing a reviewed batch; reject changed assets,
   missing files, uncertain identity, partial exports and stale evidence. Keep
   replay-safe per-item trash receipts. Never infer asset identity from a title,
   timestamp, filename, converted checksum or photo count.
7. Move verified candidates to provider trash using the supported provider-specific
   path. Preserve the provider recovery window. Permanent trash emptying and plan
   cancellation are separate actions. Review post-cleanup storage and new uploads
   before declaring migration complete or reducing the paid plan.

Flickr derivatives provide remote viewable copies, not always a second copy of
the original bytes (HEIC becomes JPEG; videos can become split 1080p derivatives).
Before cloud originals are removed, report this distinction and the status of any
additional original-quality backup. RAID is not a separate backup. Do not claim
two full-quality originals merely because NAS and Flickr both report available.

## Provider choices and verified constraints

### iCloud

Apple supports downloading/exporting unmodified originals through Photos/iCloud.
A native Photos export is the fallback path. For direct NAS automation, evaluate
and pin `icloudpd` as a third-party download-only adapter after testing stable asset
identity and every resource type. Its project documents separate Live Photo image
and video files and requires web access with Advanced Data Protection disabled.
Do not change account security settings automatically; prefer native export if
those requirements conflict with an account's configuration. Each person completes
their own login/2FA. Do not use downloader move, delete-after-download or auto-delete
modes: they bypass Kindred's independent NAS/Flickr verification.

Deleting from iCloud Photos propagates to synced devices. There is no promise of
"cloud-only deletion while leaving the synced Apple Photos library unchanged."
NAS exports must be independent of that synced library. Shared-library ownership
and deletion scope must be settled before a batch is prepared. Apple documents a
30-day Recently Deleted window; this preparation does not empty it.

Sources: [Apple original downloads](https://support.apple.com/en-euro/111762),
[Apple export/delete workflow](https://support.apple.com/en-asia/guide/photos/phtda347cde8/mac),
[icloudpd project and prerequisites](https://github.com/icloud-photos-downloader/icloud_photos_downloader).

### Google Photos

Use separate Google Takeout exports as the initial bulk source, including the one
already underway. The Google Photos Library API has focused on app-created content
since March 31, 2025; its published methods do not include photo deletion. Picker
is user selection, not unattended full-library reconciliation. Data Portability API
is an export option to evaluate for eligibility, consent and verification requirements,
not an assumed available integration and not a cloud-deletion API.

Google cleanup therefore needs a reviewed provider UI workflow unless a suitable
supported method is established. Takeout filenames alone cannot select the exact
remote item to delete. Deleting backed-up Google Photos can affect devices with
backup enabled; configure the intended device behavior before cleanup. Google
documents a 60-day trash window for backed-up items. Do not disable backup settings,
empty trash or cancel billing as a side effect of this preparation.

Sources: [Google API changes](https://developers.googleblog.com/en/google-photos-picker-api-launch-and-library-api-updates/),
[Library API methods](https://developers.google.com/photos/library/reference/rest),
[Google Takeout](https://support.google.com/photos/answer/3024190),
[Data Portability](https://developers.google.com/data-portability/user-guide/introduction),
[Google deletion behavior](https://support.google.com/photos/answer/6128858).

## Remaining integration

Provider account setup/2FA, downloading, source-to-Kindred receipts, trustworthy
complete-library inventories, live Flickr checks, migration database/API, web/iOS
review and cloud-trash execution remain queued in TaskJunky Cloud Library Migration.
The existing post-Takeout Flickr recovery automation does not authorize or schedule
iCloud/Google deletion. This CLI provides local preparation evidence only.
