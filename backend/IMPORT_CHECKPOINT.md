# Incremental NAS import checkpoints

A 1.25-million-path export cannot rewrite the entire receipts dictionary after
every file. Importers now append only the changed path's completed/failure receipt
to `staged-import-progress.json.journal`, with a SHA-256 checksum, monotonic
sequence number and fsync. Adjacent saves of identical state do not append twice.
Album/year aliases retain separate source-path receipts referencing the same
Kindred photo ID; the journal does not invent duplicate catalog records.

`staged_import.load_progress(path)` loads the original JSON and replays newer
records. Snapshots retain the original `completed`/`failed` dictionaries and add
`_journal_sequence`. Every 10,000 changes and at pass completion, the merged JSON
is atomically replaced and its directory fsynced before clearing the journal.
A crash between those operations is safe: already-snapshotted journal records
are skipped. A torn final append is ignored and truncated on the next append;
checksummed complete-record corruption, missing sequences or corrupt JSON stop
recovery explicitly. The existing shared importer lock still covers load/save.

The live checkpoint is BOTH files. Read it through `load_progress`, and back up
both files together while holding `staged_import.import_lock(path)`. Raw JSON
readers see only the last snapshot. Before rolling back to a release without
journal support, stop the importer, acquire that lock, load the merged state,
and call `save_progress(path, progress)` without a relative path to compact it.
Never delete a journal or replace only its JSON snapshot to recover progress.
No journal migration or production changes run merely by installing this code.

This reduces checkpoint write amplification, but intentionally retains the existing
in-memory dictionary interface. Path scanning, hashing repeated source aliases,
and Flickr photo upload throughput remain separate costs.

The Git deployment rollback path performs this export automatically: it stops the
active library worker, runs the active image's compactor under the shared lock,
and only then restores older containers. If the active image lacks journal
support but finds a nonempty journal, rollback refuses to discard it. Operators
can also run `python /app/import_checkpoint.py /app/data/staged-import-progress.json`
after stopping the importer. A failed compaction leaves rollback blocked for repair.
