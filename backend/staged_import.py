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
import re
from pathlib import Path
import shutil
import sys
import time

import capture_date
# One definition of where a Takeout sidecar lives, shared with every ingest
# path. Re-exported because callers and tests have always imported it here.
from capture_date import sidecar_for


SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".jfif", ".png", ".gif", ".heic", ".heif",
    ".webp", ".bmp", ".tif", ".tiff", ".psd", ".mp4", ".mov",
    ".m4v", ".m4p", ".avi", ".wmv", ".mpeg", ".mpg", ".3gp",
    ".m2ts", ".ogg", ".ogv", ".mkv",
}
VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".m4v", ".m4p", ".avi", ".wmv", ".mpeg",
    ".mpg", ".3gp", ".m2ts", ".ogg", ".ogv", ".mkv",
}


# This library was organised by hand into dated album folders long before it
# reached Google -- "2003.09.06 Lagoon", "2004 Austin Baptism", "12.2009-3.2010
# Love Notes". Four thousand of them, and the name is a person saying when
# something happened, which is enough to import in chronological order without
# opening a single file.
# Anchored patterns come first. A name beginning "12.2009-3.2010" is a range
# starting in December 2009, but an unanchored year-month search finds "2009-3"
# inside it and calls it March -- right year, wrong end of the range.
_ALBUM_DATES = (
    # 12.2009 -- month first, as in "12.2009-3.2010 Love Notes"
    re.compile(r"^(?P<month>0?[1-9]|1[0-2])[.\-_](?P<year>(?:19|20)\d{2})(?:\D|$)"),
    # 2004.03.20, 2004-03-20
    re.compile(r"(?P<year>(?:19|20)\d{2})[.\-_](?P<month>0?[1-9]|1[0-2])[.\-_](?P<day>0?[1-9]|[12]\d|3[01])(?:\D|$)"),
    # 2004.03
    re.compile(r"(?P<year>(?:19|20)\d{2})[.\-_](?P<month>0?[1-9]|1[0-2])(?:\D|$)"),
    # 2003, anywhere: "2003 - 2004 CEU Basketball Games"
    re.compile(r"(?P<year>(?:19|20)\d{2})(?:\D|$)"),
)


def album_sort_key(name: str) -> tuple:
    """Order album folders oldest first, undated ones last.

    Deliberately looser than capture_date.parse_folder_datetime, which refuses
    a bare year because dating every photo in "2004 Austin Baptism" to the 1st
    of January would be a false precision. For *ordering* a year is plenty --
    it puts 2004 before 2010, which is the whole question -- so a bare year is
    accepted here and nowhere else.

    Folders with no date sort after every dated one rather than among them, by
    name, so the order stays stable between runs.
    """
    text = name.strip()
    for pattern in _ALBUM_DATES:
        match = pattern.search(text)
        if not match:
            continue
        parts = match.groupdict()
        year = int(parts["year"])
        month = int(parts.get("month") or 1)
        day = int(parts.get("day") or 1)
        if not (1 <= month <= 12 and 1 <= day <= 31):
            continue
        return (0, year, month, day, text.lower())
    return (1, 0, 0, 0, text.lower())


def iter_media(root: Path) -> Iterator[Path]:
    """Stream supported originals oldest album first, without holding the tree in RAM.

    Order matters because this import takes days: whatever runs first is what
    the library contains in the meantime. Walking alphabetically meant "2003
    Lagoon" and "Weekend in Lehi" arrived in name order, so what showed up was
    arbitrary. Oldest first means the library fills in as a timeline.
    """
    root = Path(root)
    try:
        entries = sorted(root.iterdir(), key=lambda path: path.name)
    except OSError:
        return

    # Loose files at the top level first, then each album in date order.
    for path in entries:
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield path

    albums = [path for path in entries if path.is_dir()]
    albums.sort(key=lambda path: album_sort_key(path.name))
    for album in albums:
        for directory, dirnames, filenames in os.walk(album):
            dirnames.sort()
            for filename in sorted(filenames):
                path = Path(directory) / filename
                if path.suffix.lower() in SUPPORTED_EXTENSIONS:
                    yield path


def scan_media(root: Path) -> list[Path]:
    """Materialize a scan for small callers such as tests."""
    return list(iter_media(root))


def people_names(sidecar_data: dict) -> list[str]:
    """The names Google put on a photo, cleaned and de-duplicated.

    The field is a list of objects -- [{"name": "Madison Teagle"}] -- and a
    malformed entry should cost that name, not the whole photo's metadata.
    Order is not meaningful, so the result is sorted to keep imports
    reproducible.
    """
    people = sidecar_data.get("people")
    if not isinstance(people, list):
        return []
    names = set()
    for entry in people:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if isinstance(name, str) and name.strip():
            names.add(name.strip())
    return sorted(names)


def read_metadata(path: Path) -> dict:
    """Title, description and the sidecar's own view of when and where.

    The date and coordinates here are only a starting point: they travel into
    `_store_nas_original`, which reads the file itself and overrules them.
    """
    result = {
        "title": path.stem,
        "description": "",
        "taken_at_unix": None,
        "latitude": None,
        "longitude": None,
        # Google's face tags: names only, no boxes. Kept as evidence for the
        # cluster matcher rather than applied to anything directly.
        "people": [],
    }
    sidecar = sidecar_for(path)
    if sidecar is None:
        return result
    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        result["title"] = data.get("title") or result["title"]
        result["description"] = data.get("description") or ""
        result["people"] = people_names(data)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        print(f"[import] unreadable sidecar {sidecar}: {exc}", flush=True)
        return result
    # Shared with every other ingest path, so an implausible epoch or a
    # half-written geo block is rejected here exactly as it is there.
    capture = capture_date.read_sidecar(sidecar)
    if capture.taken_at:
        result["taken_at_unix"] = int(capture.taken_at.timestamp())
    result["latitude"] = capture.latitude
    result["longitude"] = capture.longitude
    return result


def load_progress(path: Path) -> dict:
    from import_checkpoint import load
    return load(path)


def save_progress(path: Path, progress: dict, relative: str | None = None) -> None:
    from import_checkpoint import save
    save(path, progress, relative)


def compact_progress(path: Path, progress: dict) -> None:
    from import_checkpoint import Progress
    if isinstance(progress, Progress) and progress.sequence != progress.snapshot_sequence:
        save_progress(path, progress)


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
    # _store_nas_original read the original's EXIF or container metadata, so
    # its answer outranks the sidecar's for the Flickr mirror too.
    metadata = dict(metadata, taken_at_unix=nas_copy["taken_at_unix"],
                    latitude=nas_copy["latitude"], longitude=nas_copy["longitude"])

    # Google's names for whoever is in the frame. Stored as evidence; the
    # matcher decides later whether any of it should become a cluster label.
    if metadata.get("people"):
        main.record_people_tags(nas_copy["kindred_photo_id"], metadata["people"])

    flickr_id = main._existing_flickr_copy(nas_copy["kindred_photo_id"])
    replication_job_id = None
    if not flickr_id and mirror_flickr and source.suffix.lower() in VIDEO_EXTENSIONS:
        main._queue_video(nas_copy, metadata['title'], metadata['description'], privacy,
                          metadata['taken_at_unix'], metadata['latitude'], metadata['longitude'])
        return {'kindred_photo_id': nas_copy['kindred_photo_id'], 'flickr_photo_id': None,
                'flickr_status': 'queued', 'deduplicated': bool(nas_copy['deduplicated'])}

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
            # Flickr parses EXIF DateTimeOriginal from the file it was just
            # given, so telling it the date again is a REST call spent on
            # something it already knows -- and REST is the scarce resource
            # here: 3,600 queries an hour per key, shared across every photo.
            # The call still goes out for dates we recovered from a sidecar, a
            # folder name or a filename, because those are exactly the photos
            # whose EXIF Flickr cannot read a date from.
            source = (nas_copy.get("taken_at_source") or "")
            if metadata["taken_at_unix"] and not source.startswith("exif:"):
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
        save_progress(progress_path, progress, relative)
        elapsed = max(time.monotonic() - started, 0.001)
        print(
            f"[import] scanned={index:,} | completed={len(progress['completed']):,} "
            f"failed={len(progress['failed']):,} | {index / elapsed:.2f} files/s | {relative}",
            flush=True,
        )
    compact_progress(progress_path, progress)
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
