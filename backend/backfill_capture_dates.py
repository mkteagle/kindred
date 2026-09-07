#!/usr/bin/env python3
"""Fill photos.taken_at and photos.latitude/longitude from the NAS originals.

The library was imported without ever reading a capture date out of the files,
so almost every row falls back to its upload time and the whole timeline is
ordered by when it was copied rather than when it was taken. The originals on
the NAS are the only source of truth for this, and this pass reads them.

Run it inside the API container, where the NAS and the database both are:

    docker compose exec api python backfill_capture_dates.py --dry-run
    docker compose exec api python backfill_capture_dates.py

Add the staged import tree to also consult the Google Takeout sidecars, which
are the only surviving date for originals whose EXIF the export stripped. The
sidecars are not copied into the managed layout, so they are found through the
importer's own checkpoint, which records which source file became which photo:

    docker compose exec api python backfill_capture_dates.py \
        --import-source /data/photos/imports/AllPhotos

Safe to re-run and safe to interrupt. Every write is `COALESCE(column, %s)`
under a `WHERE` that ignores already-filled rows, so a date that is already
recorded — by an import, by a person, by an earlier pass — is never
overwritten, with or without the checkpoint. The checkpoint exists to avoid
re-reading 11,000 files off the NAS after a restart, not for correctness.

A file that cannot be read is counted, logged and skipped. One corrupt JPEG in
the middle of the library must not end the run.

See capture_date.py for where the dates come from, how the timezone is decided,
and which dates are rejected as implausible.
"""

from __future__ import annotations

import argparse
from collections import Counter
import os
from pathlib import Path
import sys
import time

NIL_UUID = "00000000-0000-0000-0000-000000000000"
DEFAULT_PROGRESS = "/app/data/capture-date-backfill.json"
DEFAULT_IMPORT_PROGRESS = "/app/data/staged-import-progress.json"

# Rows worth opening a file for: on the NAS, and missing at least one of the
# three columns this pass can fill.
PENDING_SQL = """
SELECT p.id::text AS photo_id, p.original_filename, p.media_type,
       p.taken_at, p.latitude, p.longitude, n.provider_key
FROM photos p
JOIN photo_copies n
  ON n.photo_id = p.id AND n.provider = 'nas' AND n.status = 'available'
WHERE (p.taken_at IS NULL OR p.latitude IS NULL OR p.longitude IS NULL)
  AND p.id > %s::uuid
ORDER BY p.id
LIMIT %s
"""

# COALESCE and the WHERE both refuse to overwrite. Either alone would do; both
# together mean a concurrent importer filling the same row cannot lose a write.
UPDATE_SQL = """
UPDATE photos
SET taken_at = COALESCE(taken_at, %s),
    latitude = COALESCE(latitude, %s),
    longitude = COALESCE(longitude, %s),
    updated_at = now()
WHERE id = %s::uuid
  AND (taken_at IS NULL OR latitude IS NULL OR longitude IS NULL)
"""

SUMMARY_SQL = """
SELECT count(*) AS photos,
       count(*) FILTER (WHERE p.taken_at IS NOT NULL) AS dated,
       count(*) FILTER (WHERE p.latitude IS NOT NULL) AS located,
       count(*) FILTER (WHERE n.photo_id IS NULL) AS off_nas
FROM photos p
LEFT JOIN photo_copies n
  ON n.photo_id = p.id AND n.provider = 'nas' AND n.status = 'available'
"""


# ── Planning (pure) ──────────────────────────────────────────────────────────

def plan(row: dict, capture) -> dict | None:
    """The write this row needs, or None when the file added nothing.

    Only gaps are ever proposed. A row that already has a date contributes its
    coordinates and nothing else, so re-running after a partial pass costs one
    statement rather than a rewrite of the library.
    """
    taken_at = capture.taken_at if row.get("taken_at") is None else None
    location = None
    if row.get("latitude") is None or row.get("longitude") is None:
        if capture.latitude is not None and capture.longitude is not None:
            location = (capture.latitude, capture.longitude)
    if taken_at is None and location is None:
        return None
    return {
        "photo_id": row["photo_id"],
        "taken_at": taken_at,
        "taken_at_source": capture.taken_at_source if taken_at else None,
        "latitude": location[0] if location else None,
        "longitude": location[1] if location else None,
        "location_source": capture.location_source if location else None,
    }


def update_parameters(write: dict) -> tuple:
    return (write["taken_at"], write["latitude"], write["longitude"], write["photo_id"])


def sidecar_index(import_progress: dict, source_root: Path) -> dict:
    """photo_id → the Takeout sidecar beside the file it was imported from.

    The importer's receipts are the only link between a managed original and
    the source tree; the managed layout keeps the media file alone.
    """
    from capture_date import sidecar_for

    index = {}
    for relative, receipt in (import_progress.get("completed") or {}).items():
        photo_id = (receipt or {}).get("kindred_photo_id")
        if not photo_id:
            continue
        sidecar = sidecar_for(source_root / relative)
        if sidecar is not None:
            index[str(photo_id)] = sidecar
    return index


def describe(tally: Counter, sources: Counter) -> str:
    lines = [
        f"  examined            {tally['examined']:>8,}",
        f"  dated               {tally['dated']:>8,}",
        f"  located (GPS)       {tally['located']:>8,}",
        f"  no date in the file {tally['no_date']:>8,}",
        f"  unreadable          {tally['unreadable']:>8,}",
        f"  original missing    {tally['missing']:>8,}",
    ]
    if sources:
        lines.append("  dates came from:")
        for source, count in sources.most_common():
            lines.append(f"    {source:<30} {count:>8,}")
    return "\n".join(lines)


# ── The pass (IO) ────────────────────────────────────────────────────────────

def examine(provider, row: dict, sidecar, allow_filename: bool):
    """Read one original. Returns `(capture, note)`; note is set when skipped."""
    import capture_date

    original = provider.resolve_local_path(row["provider_key"])
    if original is None:
        return None, f"NAS original missing: {row['provider_key']}"
    capture = capture_date.extract(
        original,
        original_filename=row.get("original_filename") or original.name,
        media_type=row.get("media_type"),
        sidecar=sidecar,
        allow_filename=allow_filename,
    )
    return capture, None


def run(args: argparse.Namespace) -> int:
    import main
    import staged_import

    if not os.environ.get("PHOTO_STORAGE_ROOT"):
        print("PHOTO_STORAGE_ROOT is not configured", file=sys.stderr)
        return 2

    progress_path = Path(args.progress)
    # The importer's lock, keyed by checkpoint path: one backfill at a time,
    # without blocking an import that uses its own checkpoint.
    with staged_import.import_lock(progress_path):
        return _run(args, main, staged_import, progress_path)


def _run(args, main, staged_import, progress_path: Path) -> int:
    provider = main.LocalStorageProvider(main.PHOTO_STORAGE_ROOT)

    sidecars = {}
    if args.import_source:
        source_root = Path(args.import_source)
        if not source_root.is_dir():
            print(f"Import source does not exist: {source_root}", file=sys.stderr)
            return 2
        sidecars = sidecar_index(
            staged_import.load_progress(Path(args.import_progress)), source_root)
        print(f"[backfill] {len(sidecars):,} Takeout sidecars available", flush=True)

    before = dict(main.db_query(SUMMARY_SQL)[0])
    print(
        f"[backfill] {before['photos']:,} photos: {before['dated']:,} dated, "
        f"{before['located']:,} located, {before['off_nas']:,} with no NAS original",
        flush=True,
    )

    # Read in both modes so a dry run reports the work that is actually left;
    # nothing is written back unless the pass is real.
    progress = staged_import.load_progress(progress_path)
    done = progress["completed"]

    tally = Counter()
    sources = Counter()
    location_sources = Counter()
    examples = []
    after = NIL_UUID
    started = time.monotonic()
    connection = None if args.dry_run else main.get_db()
    try:
        while True:
            rows = main.db_query(PENDING_SQL, (after, args.batch_size))
            if not rows:
                break
            after = rows[-1]["photo_id"]
            for row in rows:
                photo_id = row["photo_id"]
                if photo_id in done and not args.recheck:
                    continue
                if args.limit and tally["examined"] >= args.limit:
                    break
                tally["examined"] += 1

                try:
                    capture, note = examine(
                        provider, row, sidecars.get(photo_id), not args.no_filename_dates)
                except Exception as exc:  # pragma: no cover - defence in depth
                    capture, note = None, f"{type(exc).__name__}: {exc}"

                # A file this pass could not read stays in `failed` and is
                # retried by the next run, in case the NAS was simply unmounted.
                if capture is None or capture.error:
                    tally["missing" if capture is None else "unreadable"] += 1
                    reason = note if capture is None else capture.error
                    progress["failed"][photo_id] = reason[:1000]
                    print(f"[backfill] unresolved {photo_id}: {reason}", flush=True)
                    if capture is None:
                        if not args.dry_run:
                            staged_import.save_progress(progress_path, progress, photo_id)
                        continue

                write = plan(row, capture)
                if write is None:
                    tally["no_date"] += 1
                else:
                    if write["taken_at"]:
                        tally["dated"] += 1
                        sources[write["taken_at_source"]] += 1
                        if len(examples) < 10:
                            examples.append(
                                f"    {row['original_filename']} → "
                                f"{write['taken_at']:%Y-%m-%d %H:%M} "
                                f"({write['taken_at_source']})")
                    if write["latitude"] is not None:
                        tally["located"] += 1
                        location_sources[write["location_source"]] += 1
                    if not args.dry_run:
                        with connection.cursor() as cursor:
                            cursor.execute(UPDATE_SQL, update_parameters(write))
                        connection.commit()

                if not args.dry_run:
                    if not capture.error:
                        progress["failed"].pop(photo_id, None)
                        progress["completed"][photo_id] = {
                            "taken_at": (write["taken_at"].isoformat()
                                         if write and write["taken_at"] else None),
                            "source": write["taken_at_source"] if write else None,
                        }
                    staged_import.save_progress(progress_path, progress, photo_id)

                if tally["examined"] % 100 == 0:
                    elapsed = max(time.monotonic() - started, 0.001)
                    print(
                        f"[backfill] examined={tally['examined']:,} dated={tally['dated']:,} "
                        f"located={tally['located']:,} unreadable={tally['unreadable']:,} "
                        f"{tally['examined'] / elapsed:.1f} files/s",
                        flush=True,
                    )
            if args.limit and tally["examined"] >= args.limit:
                break
    finally:
        if connection is not None:
            connection.close()

    if not args.dry_run:
        staged_import.compact_progress(progress_path, progress)
        main.invalidate_cache("timeline")

    print(("\n[backfill] dry run — nothing was written.\n" if args.dry_run
           else "\n[backfill] done.\n") + describe(tally, sources), flush=True)
    if location_sources:
        print("  coordinates came from:", flush=True)
        for source, count in location_sources.most_common():
            print(f"    {source:<30} {count:>8,}", flush=True)
    if examples:
        print("  for example:\n" + "\n".join(examples), flush=True)

    if not args.dry_run:
        after_counts = dict(main.db_query(SUMMARY_SQL)[0])
        print(
            f"  photos.taken_at is now set on {after_counts['dated']:,} of "
            f"{after_counts['photos']:,} rows "
            f"(was {before['dated']:,}); latitude on {after_counts['located']:,}",
            flush=True,
        )
    unresolved = tally["unreadable"] + tally["missing"]
    return 1 if unresolved else 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    result.add_argument("--dry-run", action="store_true",
                        help="Report what would be written and exit without writing.")
    result.add_argument("--progress", default=DEFAULT_PROGRESS,
                        help="Checkpoint file; also the single-worker lock.")
    result.add_argument("--import-source",
                        help="Staged Takeout tree, to also read its JSON sidecars.")
    result.add_argument("--import-progress", default=DEFAULT_IMPORT_PROGRESS,
                        help="Importer checkpoint mapping source files to photo ids.")
    result.add_argument("--batch-size", type=int, default=500,
                        help="Rows read per database round trip.")
    result.add_argument("--limit", type=int, help="Stop after this many files.")
    result.add_argument("--recheck", action="store_true",
                        help="Re-read files a previous pass already examined.")
    result.add_argument("--no-filename-dates", action="store_true",
                        help="Do not fall back to dates encoded in filenames.")
    return result


if __name__ == "__main__":
    raise SystemExit(run(parser().parse_args()))
