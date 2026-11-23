#!/usr/bin/env python3
"""Restart-safe ML indexing of NAS originals."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import time
import tempfile
from contextlib import contextmanager

import main


def pending(limit: int | None, library_only: bool = False) -> list[dict]:
    suffix = " LIMIT %s" if limit else ""
    source_join = "JOIN nas_source_files source ON source.photo_id=p.id" if library_only else ""
    source_filter = "AND source.preview_ready_at IS NOT NULL AND source.ml_error IS NULL" if library_only else ""
    # The sentinel keeps the ordering expression non-null so undated photos sort
    # to the end instead of ahead of everything, the way they used to in the
    # gallery when created_at stood in for a capture date.
    params = ("0001-01-01", limit) if limit else ("0001-01-01",)
    return main.db_query(
        f"""
        SELECT p.id::text AS kindred_photo_id,
               nas.provider_key,
               flickr.provider_key AS flickr_photo_id
        FROM photos p
        JOIN photo_copies nas
          ON nas.photo_id=p.id AND nas.provider='nas' AND nas.status='available'
        LEFT JOIN photo_copies flickr
          ON flickr.photo_id=p.id AND flickr.provider='flickr' AND flickr.status='available'
        LEFT JOIN processed_photos done_kindred ON done_kindred.photo_id=p.id::text
        LEFT JOIN processed_photos done_flickr ON done_flickr.photo_id=flickr.provider_key
        {source_join}
        WHERE p.media_type LIKE 'image/%%'
          {source_filter}
          AND done_kindred.photo_id IS NULL AND done_flickr.photo_id IS NULL
        -- Newest first. There are more photos queued than this box can index
        -- in months, so the order decides which months of the library are
        -- searchable while the rest catches up. Oldest-first meant the years
        -- nobody is looking at got indexed first and recent photos -- the ones
        -- being uploaded, shared and searched for right now -- waited longest.
        -- Undated photos sort last rather than claiming today's date.
        ORDER BY COALESCE(p.taken_at, %s) DESC, p.id DESC
        """ + suffix,
        params,
    )


@contextmanager
def indexable_original(source: Path):
    """Decode HEIF through Pillow because OpenCV cannot read NAS HEIC originals."""
    if source.suffix.lower() not in (".heic", ".heif"):
        yield source
        return
    from PIL import Image, ImageOps
    from pillow_heif import register_heif_opener
    register_heif_opener()
    with tempfile.TemporaryDirectory(prefix="kindred-index-") as directory:
        output = Path(directory) / "decoded.jpg"
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original).convert("RGB")
            image.save(output, format="JPEG", quality=94, subsampling=0)
        yield output


async def index_photo(row, provider, library_only):
    photo_id = row["kindred_photo_id"]
    try:
        source = provider.resolve_local_path(row["provider_key"])
        if source is None:
            raise FileNotFoundError("Source is unavailable")
        with indexable_original(source) as decoded:
            await main._process_uploaded_photo(
                photo_id, str(decoded), cluster_after=False, fetch_flickr_info=False,
            )
    except Exception as exc:
        error = str(exc)[:500] or type(exc).__name__
    else:
        if main.db_query("SELECT 1 FROM processed_photos WHERE photo_id=%s LIMIT 1", (photo_id,)):
            return True
        error = "Recognition did not complete"
    if library_only:
        main.db_query("UPDATE nas_source_files SET ml_error=%s WHERE photo_id=%s", (error, photo_id), fetch=False)
    print(f"[index] failed {photo_id}: {error}", flush=True)
    return False


def index_in_process(row, library_only):
    provider = main.LocalStorageProvider(main.PHOTO_STORAGE_ROOT)
    return asyncio.run(index_photo(row, provider, library_only))


async def run(args: argparse.Namespace, rows=None, executor=None) -> int:
    provider = main.LocalStorageProvider(main.PHOTO_STORAGE_ROOT)
    library_only = getattr(args, "library_only", False)
    workers = args.workers if executor is not None else 1
    rows = pending(args.limit, library_only=library_only) if rows is None else rows
    print(f"[index] pending={len(rows):,} workers={workers}", flush=True)
    queue = iter(rows)
    completed = failed = 0
    started = time.monotonic()
    before_item = getattr(args, "before_item", None)
    on_progress = getattr(args, "on_progress", None)

    async def consume():
        nonlocal completed, failed
        while before_item is None or before_item():
            row = next(queue, None)
            if row is None:
                break
            succeeded = (
                await index_photo(row, provider, library_only) if executor is None
                else await asyncio.get_running_loop().run_in_executor(executor, index_in_process, row, library_only)
            )
            completed += int(succeeded)
            failed += int(not succeeded)
            scanned = completed + failed
            if on_progress:
                on_progress(scanned, completed, failed)
            if scanned % 10 == 0:
                elapsed = max(time.monotonic() - started, 0.001)
                print(
                    f"[index] scanned={scanned:,}/{len(rows):,} completed={completed:,} "
                    f"failed={failed:,} rate={scanned/elapsed:.3f}/s",
                    flush=True,
                )

    if on_progress:
        on_progress(0, 0, 0)
    await asyncio.gather(*(consume() for _ in range(workers)))
    if not args.defer_clustering:
        for category in ("people", "pets", "vehicles"):
            main.run_clustering(category, distance_threshold=0.80)
    print(f"[index] done completed={completed:,} failed={failed:,}", flush=True)
    return 1 if failed else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--defer-clustering", action="store_true")
    parser.add_argument("--library-only", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parse_args())))
