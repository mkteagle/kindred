#!/usr/bin/env python3
"""Restart-safe import of a NAS-staged Google Photos library into Kindred.

Run inside the API container so source files never traverse the network:

    python staged_import.py /data/photos/imports/AllPhotos

Each supported original is copied into Kindred's managed, content-addressed NAS
layout, mirrored to Flickr when it is not already present, and analyzed locally.
The source tree is read-only from this script's point of view and is never
deleted or moved.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import tempfile
import asyncio
from collections.abc import Iterator
from itertools import islice
import json
import os
from pathlib import Path
import shutil
import sys
import time


SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".jfif", ".png", ".gif", ".heic", ".heif",
    ".webp", ".bmp", ".tif", ".tiff", ".psd", ".mp4", ".mov",
    ".m4v", ".m4p", ".avi", ".wmv", ".mpeg", ".mpg", ".3gp",
    ".m2ts", ".ogg", ".ogv",
}
VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".m4v", ".m4p", ".avi", ".wmv", ".mpeg",
    ".mpg", ".3gp", ".m2ts", ".ogg", ".ogv",
}


def iter_media(root: Path) -> Iterator[Path]:
    """Stream supported originals deterministically without holding the tree in RAM."""
    for directory, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for filename in sorted(filenames):
            path = Path(directory) / filename
            if path.suffix.lower() in SUPPORTED_EXTENSIONS:
                yield path


def scan_media(root: Path) -> list[Path]:
    """Materialize a scan for small callers such as tests."""
    return list(iter_media(root))


def sidecar_for(path: Path) -> Path | None:
    """Find either common Google Takeout JSON sidecar naming convention."""
    for candidate in (path.with_name(path.name + ".json"), path.with_suffix(".json")):
        if candidate.is_file():
            return candidate
    return None


def read_metadata(path: Path) -> dict:
    result = {
        "title": path.stem,
        "description": "",
        "taken_at_unix": None,
        "latitude": None,
        "longitude": None,
    }
    sidecar = sidecar_for(path)
    if sidecar is None:
        return result
    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        result["title"] = data.get("title") or result["title"]
        result["description"] = data.get("description") or ""
        timestamp = (data.get("photoTakenTime") or {}).get("timestamp")
        if timestamp:
            result["taken_at_unix"] = int(timestamp)
        geo = data.get("geoData") or data.get("geoDataExif") or {}
        latitude = geo.get("latitude")
        longitude = geo.get("longitude")
        if latitude or longitude:
            result["latitude"] = float(latitude)
            result["longitude"] = float(longitude)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        print(f"[import] unreadable sidecar {sidecar}: {exc}", flush=True)
    return result


def load_progress(path: Path) -> dict:
    if not path.exists():
        return {"completed": {}, "failed": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        data.setdefault("completed", {})
        data.setdefault("failed", {})
        return data
    except (OSError, ValueError, json.JSONDecodeError):
        return {"completed": {}, "failed": {}}


def save_progress(path: Path, progress: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=path.name + ".", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(progress, stream, indent=2, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


@contextmanager
def import_lock(progress_path: Path):
    """Hold one shared lock across both importer entry points, before reading state."""
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    with progress_path.with_suffix(progress_path.suffix + ".lock").open("a+") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another NAS import owns this checkpoint; refusing a second worker")
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def quarantine_duplicate(source: Path, source_root: Path, quarantine_root: Path) -> Path:
    """Move an exact duplicate and its Takeout sidecar into recoverable quarantine."""
    sidecar = sidecar_for(source)
    relative = source.relative_to(source_root)
    destination = quarantine_root / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(f"duplicate quarantine target already exists: {destination}")
    shutil.move(str(source), str(destination))

    if sidecar is not None:
        sidecar_relative = sidecar.relative_to(source_root)
        sidecar_destination = quarantine_root / sidecar_relative
        sidecar_destination.parent.mkdir(parents=True, exist_ok=True)
        if sidecar_destination.exists():
            raise FileExistsError(
                f"duplicate sidecar quarantine target already exists: {sidecar_destination}"
            )
        shutil.move(str(sidecar), str(sidecar_destination))
    return destination


async def import_one(
    source: Path, *, analyze: bool, mirror_flickr: bool, privacy: str
) -> dict:
    # Import lazily so scan/dry-run tests do not boot the API or ML stack.
    import main

    metadata = read_metadata(source)
    nas_copy = main._store_nas_original(
        str(source), source.name, main._content_type_for_filename(source.name),
        metadata["title"], metadata["description"], metadata["taken_at_unix"],
        metadata["latitude"], metadata["longitude"], None,
    )
    if not nas_copy:
        raise RuntimeError("PHOTO_STORAGE_ROOT is not configured")

    flickr_id = main._existing_flickr_copy(nas_copy["kindred_photo_id"])
    replication_job_id = None
    if not flickr_id and mirror_flickr:
        credentials = main.get_flickr_credentials()
        if not credentials:
            raise RuntimeError("Flickr OAuth is not configured")
        replication_job_id = main._queue_flickr_replication(nas_copy["kindred_photo_id"])
        main._set_replication_status(replication_job_id, "running")
        try:
            flickr_id = await main._upload_to_flickr(
                str(source), source.name, metadata["title"],
                metadata["description"], credentials, privacy=privacy,
            )
            main._record_flickr_copy(
                nas_copy["kindred_photo_id"], flickr_id, credentials.get("user_id", "")
            )
            if metadata["taken_at_unix"]:
                await main._flickr_set_dates(flickr_id, metadata["taken_at_unix"], credentials)
            if metadata["latitude"] is not None and metadata["longitude"] is not None:
                await main._flickr_set_location(
                    flickr_id, metadata["latitude"], metadata["longitude"], credentials
                )
            main._set_replication_status(replication_job_id, "done")
        except Exception as exc:
            main._set_replication_status(replication_job_id, "retry", str(exc)[:1000])
            raise
        finally:
            # HEIC conversion creates this temporary sibling. Never alter source originals.
            Path(str(source) + ".jpg").unlink(missing_ok=True)

    if analyze and flickr_id and source.suffix.lower() not in VIDEO_EXTENSIONS:
        await main._process_uploaded_photo(flickr_id)

    return {
        "kindred_photo_id": nas_copy["kindred_photo_id"],
        "flickr_photo_id": flickr_id,
        "deduplicated": bool(nas_copy["deduplicated"]),
    }


async def run(args: argparse.Namespace) -> int:
    with import_lock(Path(args.progress)):
        return await _run(args)


async def _run(args: argparse.Namespace) -> int:
    source_root = Path(args.source).resolve()
    storage_root = Path(os.environ.get("PHOTO_STORAGE_ROOT", "")).resolve()
    if not source_root.is_dir():
        print(f"Source directory does not exist: {source_root}", file=sys.stderr)
        return 2
    if not os.environ.get("PHOTO_STORAGE_ROOT"):
        print("PHOTO_STORAGE_ROOT is not configured", file=sys.stderr)
        return 2
    imports_root = storage_root.parent / "imports"
    try:
        source_root.relative_to(imports_root)
    except ValueError:
        print(f"Source must be inside {imports_root}", file=sys.stderr)
        return 2

    media = iter_media(source_root)
    if args.limit:
        media = islice(media, args.limit)
    if args.dry_run:
        count = 0
        total_bytes = 0
        for path in media:
            count += 1
            total_bytes += path.stat().st_size
        print(
            f"[import] dry run found {count:,} supported files "
            f"({total_bytes / 1024**3:.2f} GiB)", flush=True,
        )
        return 0

    progress_path = Path(args.progress)
    quarantine_root = (
        Path(args.quarantine_dir).resolve()
        if args.quarantine_dir
        else imports_root / ".duplicates" / source_root.name
    )
    if args.duplicate_action == "quarantine":
        try:
            quarantine_root.relative_to(imports_root)
        except ValueError:
            print(
                f"Duplicate quarantine must be inside {imports_root}",
                file=sys.stderr,
            )
            return 2
        try:
            quarantine_root.relative_to(source_root)
        except ValueError:
            pass
        else:
            print("Duplicate quarantine must not be inside the scanned source", file=sys.stderr)
            return 2

    progress = load_progress(progress_path)
    started = time.monotonic()
    for index, path in enumerate(media, start=1):
        relative = path.relative_to(source_root).as_posix()
        if relative in progress["completed"]:
            continue
        try:
            receipt = await import_one(
                path,
                analyze=not args.defer_analysis,
                mirror_flickr=not args.defer_flickr,
                privacy=args.privacy,
            )
            if receipt["deduplicated"] and args.duplicate_action == "quarantine":
                receipt["quarantined_to"] = str(
                    quarantine_duplicate(path, source_root, quarantine_root)
                )
            progress["completed"][relative] = receipt
            progress["failed"].pop(relative, None)
        except Exception as exc:
            progress["failed"][relative] = str(exc)[:1000]
            print(f"[import] failed {relative}: {exc}", flush=True)
        save_progress(progress_path, progress)
        elapsed = max(time.monotonic() - started, 0.001)
        print(
            f"[import] scanned={index:,} | completed={len(progress['completed']):,} "
            f"failed={len(progress['failed']):,} | {index / elapsed:.2f} files/s | {relative}",
            flush=True,
        )
    return 1 if progress["failed"] else 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("source")
    result.add_argument("--progress", default="/app/data/staged-import-progress.json")
    result.add_argument("--privacy", choices=("private", "family", "friends", "friends_family", "public"), default="family")
    result.add_argument("--defer-analysis", action="store_true")
    result.add_argument(
        "--defer-flickr", action="store_true",
        help="Import to NAS/Kindred now and mirror to Flickr on a later pass",
    )
    result.add_argument(
        "--duplicate-action", choices=("keep", "quarantine"), default="keep",
        help="Keep exact duplicate source files or move them to recoverable quarantine",
    )
    result.add_argument("--quarantine-dir")
    result.add_argument("--dry-run", action="store_true")
    result.add_argument("--limit", type=int)
    return result


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parser().parse_args())))
