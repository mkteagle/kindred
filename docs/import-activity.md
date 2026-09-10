# Library activity

Administrators can open **Activity log** in the web sidebar or `/activity`.
The page searches filenames, filters added/indexed records, shows timestamps in
browser-local time (hover for the original timestamp), and pages through history.
The latest page refreshes every ten seconds; older pages remain stable.

The authenticated `/import-activity` endpoint accepts `kind` (`all`, `imported`,
`indexed`), literal `search` (up to 200 characters), `limit` (1–100), and an opaque
`cursor`. Non-admin accounts receive 403. Each page includes `events` and
`next_cursor`; ordering is timestamp descending with a deterministic event ID.

History comes from existing PostgreSQL records. `photos.created_at` means the
catalog record was added, not capture time or necessarily original upload time:
older migrated records retain their migration timestamp. `processed_photos.processed_at`
means analysis completed, not that faces were found. Both canonical NAS IDs and
legacy/Flickr IDs resolve to filenames. Completed history survives worker restarts.
Failed attempts, waiting files, cloud download progress, and raw worker logs are
not part of this feed; see Pipelines for overall progress. The feed does not walk
NAS directories or change importer/checkpoint state.

Deploy the backend through `deploy/ugreen/deploy.py` and the web through its
existing Vercel Git integration. Migration 011 adds the history ordering index.

Verification:
- `PYTHONPATH=backend python -m unittest discover -s backend/tests -p test_import_activity.py -v`
- Set `ACTIVITY_TEST_DATABASE_URL` to a PostgreSQL test database for relational
  integration coverage. These tests use temporary tables and roll back changes.
- `cd apps/web && pnpm build`
