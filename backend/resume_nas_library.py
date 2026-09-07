#!/usr/bin/env python3
"""Recover a staged NAS import and resume missing Flickr mirrors safely."""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path
import sys
import time

import main
import staged_import


def managed_original(photo_id: str) -> Path | None:
    try:
        main.uuid.UUID(photo_id)
    except (ValueError, TypeError):
        return None
    root = Path(os.environ["PHOTO_STORAGE_ROOT"])
    matches = list(root.glob(f"{photo_id[:2]}/{photo_id}/original.*"))
    return matches[0] if len(matches) == 1 else None


def reconcile(relative: str, receipt: dict, source_root: Path) -> bool:
    photo_id = receipt.get("kindred_photo_id")
    if not photo_id:
        return False
    original = managed_original(photo_id)
    if original is None:
        return False
    # Existing, available copies have already been durably cataloged. Avoid
    # rereading and hashing the entire library on every worker restart.
    present = main.db_query(
        """SELECT 1 FROM photos p JOIN photo_copies n ON n.photo_id=p.id
           WHERE p.id=%s AND n.provider='nas' AND n.status='available'
             AND p.sha256 IS NOT NULL AND n.sha256=p.sha256
             AND n.provider_key=%s LIMIT 1""",
        (photo_id, original.relative_to(Path(os.environ["PHOTO_STORAGE_ROOT"])).as_posix()),
    )
    if present:
        return True
    source = source_root / relative
    metadata = staged_import.read_metadata(source) if source.exists() else {
        "title": source.stem, "description": "", "taken_at_unix": None,
        "latitude": None, "longitude": None,
    }
    checksum = main._file_sha256(str(original))
    taken_at = None
    if metadata["taken_at_unix"]:
        taken_at = main.datetime.fromtimestamp(metadata["taken_at_unix"], tz=main.timezone.utc)
    main.db_query(
        """
        INSERT INTO photos (
            id, sha256, original_filename, media_type, byte_size, title,
            description, taken_at, latitude, longitude
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            sha256 = EXCLUDED.sha256,
            original_filename = EXCLUDED.original_filename,
            media_type = EXCLUDED.media_type,
            byte_size = EXCLUDED.byte_size,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            taken_at = EXCLUDED.taken_at,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            updated_at = now()
        """,
        (
            photo_id, checksum, source.name, main._content_type_for_filename(source.name),
            original.stat().st_size, metadata["title"], metadata["description"],
            taken_at, metadata["latitude"], metadata["longitude"],
        ),
        fetch=False,
    )
    provider_key = original.relative_to(Path(os.environ["PHOTO_STORAGE_ROOT"])).as_posix()
    main.db_query(
        """
        INSERT INTO photo_copies (
            photo_id, provider, provider_key, storage_path, sha256, byte_size,
            status, last_synced_at
        ) VALUES (%s, 'nas', %s, %s, %s, %s, 'available', now())
        ON CONFLICT (photo_id, provider) DO UPDATE SET
            provider_key=EXCLUDED.provider_key, storage_path=EXCLUDED.storage_path,
            sha256=EXCLUDED.sha256, byte_size=EXCLUDED.byte_size,
            status='available', last_error=NULL, last_synced_at=now(), updated_at=now()
        """,
        (photo_id, provider_key, provider_key, checksum, original.stat().st_size),
        fetch=False,
    )
    return True


async def mirror(relative: str, receipt: dict, source_root: Path, privacy: str) -> bool:
    photo_id = receipt["kindred_photo_id"]
    if main._existing_flickr_copy(photo_id):
        return False
    creds = main.get_flickr_credentials()
    if not creds:
        raise RuntimeError("Flickr OAuth is not configured")
    source = source_root / relative
    if not source.exists():
        source = managed_original(photo_id)
    if source is None or not source.exists():
        raise FileNotFoundError(relative)
    metadata = staged_import.read_metadata(source_root / relative)
    job_id = main._queue_flickr_replication(photo_id)
    main._set_replication_status(job_id, "running")
    try:
        flickr_id = await main._upload_to_flickr(
            str(source), source.name, metadata["title"], metadata["description"],
            creds, privacy=privacy,
        )
        main._record_flickr_copy(photo_id, flickr_id, creds.get("user_id", ""))
        if metadata["taken_at_unix"]:
            await main._flickr_set_dates(flickr_id, metadata["taken_at_unix"], creds)
        if metadata["latitude"] is not None and metadata["longitude"] is not None:
            await main._flickr_set_location(
                flickr_id, metadata["latitude"], metadata["longitude"], creds
            )
        main._set_replication_status(job_id, "done")
        receipt["flickr_photo_id"] = flickr_id
        return True
    except Exception as exc:
        main._set_replication_status(job_id, "retry", f"{type(exc).__name__}: {exc}"[:1000])
        raise
    finally:
        Path(str(source) + ".jpg").unlink(missing_ok=True)


async def run(args: argparse.Namespace) -> int:
    with staged_import.import_lock(Path(args.progress)):
        return await _run(args)


async def _run(args: argparse.Namespace) -> int:
    source_root = Path(args.source).resolve()
    if not source_root.is_dir():
        print(f"Source directory does not exist: {source_root}", file=sys.stderr)
        return 2
    if not os.environ.get("PHOTO_STORAGE_ROOT"):
        print("PHOTO_STORAGE_ROOT is not configured", file=sys.stderr)
        return 2
    progress_path = Path(args.progress)
    progress = staged_import.load_progress(progress_path)
    receipts = progress["completed"]

    recovered = 0
    for number, (relative, receipt) in enumerate(receipts.items(), 1):
        if reconcile(relative, receipt, source_root):
            recovered += 1
        if number % 100 == 0:
            print(f"[resume] checkpoint verified={number:,}/{len(receipts):,}", flush=True)
    main.invalidate_cache("timeline")
    print(f"[resume] reconciled {recovered:,} completed files into the active catalog", flush=True)

    mirrored = 0
    analyzed = 0
    failures = 0
    started = time.monotonic()
    for index, source in enumerate(staged_import.iter_media(source_root), start=1):
        relative = source.relative_to(source_root).as_posix()
        try:
            if relative not in receipts:
                # Catalog the durable NAS original first. A Flickr outage or an
                # unsupported remote format must never make a safely stored file
                # look unimported on the next restart.
                receipt = await staged_import.import_one(
                    source, analyze=False, mirror_flickr=False, privacy=args.privacy
                )
                receipts[relative] = receipt
                staged_import.save_progress(progress_path, progress)
            else:
                receipt = receipts[relative]
                reconcile(relative, receipt, source_root)
            if await mirror(relative, receipt, source_root, args.privacy):
                mirrored += 1
            flickr_id = receipt.get("flickr_photo_id") or main._existing_flickr_copy(
                receipt["kindred_photo_id"]
            )
            receipt["flickr_photo_id"] = flickr_id
            if (
                not args.defer_analysis
                and flickr_id
                and source.suffix.lower() not in staged_import.VIDEO_EXTENSIONS
            ):
                already_processed = main.db_query(
                    "SELECT 1 FROM processed_photos WHERE photo_id = %s LIMIT 1",
                    (flickr_id,),
                )
                if not already_processed:
                    original = managed_original(receipt["kindred_photo_id"])
                    await main._process_uploaded_photo(
                        flickr_id, str(original) if original else None
                    )
                    processed = main.db_query(
                        "SELECT 1 FROM processed_photos WHERE photo_id = %s LIMIT 1",
                        (flickr_id,),
                    )
                    if processed:
                        analyzed += 1
            progress["failed"].pop(relative, None)
        except Exception as exc:
            failures += 1
            progress["failed"][relative] = f"{type(exc).__name__}: {exc}"[:1000]
            print(f"[resume] failed {relative}: {type(exc).__name__}: {exc}", flush=True)
        staged_import.save_progress(progress_path, progress)
        if index % 10 == 0:
            elapsed = max(time.monotonic() - started, 0.001)
            print(
                f"[resume] scanned={index:,} catalog={len(receipts):,} "
                f"mirrored={mirrored:,} analyzed={analyzed:,} "
                f"failures={failures:,} rate={index/elapsed:.2f}/s",
                flush=True,
            )
    print(
        f"[resume] done catalog={len(receipts):,} mirrored={mirrored:,} "
        f"analyzed={analyzed:,} failures={failures:,}",
        flush=True,
    )
    return 1 if failures else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--progress", default="/app/data/staged-import-progress.json")
    parser.add_argument(
        "--privacy", choices=("private", "family", "friends", "friends_family", "public"),
        default="family",
    )
    parser.add_argument(
        "--defer-analysis", action="store_true",
        help="Reconcile and mirror now, then run NAS-local ML in a later pass",
    )
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parse_args())))
