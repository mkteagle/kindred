#!/usr/bin/env python3
"""Restart-safe, single-worker ML indexing of mirrored NAS originals."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import time
import tempfile
from contextlib import contextmanager

import main


def pending(limit: int | None, library_only: bool = False, stage: str = "all",
            before: tuple | None = None) -> list[dict]:
    suffix = " LIMIT %s" if limit else ""
    source_join = "JOIN nas_source_files source ON source.photo_id=p.id" if library_only else ""
    source_filter = "AND source.preview_ready_at IS NOT NULL" if library_only else ""
    if stage != "all" and not library_only:
        raise ValueError("Separate indexing stages require a NAS library")
    if stage == "categories":
        source_filter += " AND source.categorized_at IS NULL AND source.ml_error IS NULL"
    elif stage == "faces":
        source_filter += " AND (source.categorized_at IS NOT NULL OR source.ml_error IS NOT NULL) AND source.face_error IS NULL"
    elif library_only:
        source_filter += " AND source.ml_error IS NULL AND source.face_error IS NULL"
    capture_order = "COALESCE(p.taken_at, '0001-01-01'::timestamptz)"
    cursor_filter = f"AND ({capture_order}, p.id) < (%s::timestamptz, %s::uuid)" if before else ""
    params = (before or ()) + ((limit,) if limit else ())
    return main.db_query(
        f"""
        SELECT p.id::text AS kindred_photo_id,
               {capture_order} AS index_date,
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
          {cursor_filter}
          AND done_kindred.photo_id IS NULL AND done_flickr.photo_id IS NULL
        -- Newest first. There are more photos queued than this box can index
        -- in months, so the order decides which months of the library are
        -- searchable while the rest catches up. Oldest-first meant the years
        -- nobody is looking at got indexed first and recent photos -- the ones
        -- being uploaded, shared and searched for right now -- waited longest.
        -- Undated photos sort last rather than claiming today's date.
        ORDER BY {capture_order} DESC, p.id DESC
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


async def run(args: argparse.Namespace, rows=None, executor=None) -> int:
    provider = main.LocalStorageProvider(main.PHOTO_STORAGE_ROOT)
    library_only = getattr(args, "library_only", False)
    stage = getattr(args, "stage", "all")
    rows = pending(args.limit, library_only=library_only, stage=stage) if rows is None else rows
    workers = args.workers if executor is not None else 1
    print(f"[index] pending={len(rows):,}", flush=True)
    completed = failed = 0
    started = time.monotonic()
    loop = asyncio.get_running_loop()
    queue = iter(rows)
    on_progress = getattr(args, "on_progress", None)
    before_item = getattr(args, "before_item", None)

    async def consume():
        nonlocal completed, failed
        while before_item is None or before_item():
            row = next(queue, None)
            if row is None:
                break
            if executor is None:
                succeeded = await index_photo(row, provider, library_only, stage)
            else:
                succeeded = await loop.run_in_executor(executor, index_in_process, row, library_only, stage)
            completed += int(succeeded)
            failed += int(not succeeded)
            position = completed + failed
            if on_progress:
                on_progress(position, completed, failed)
            if position % 10 == 0:
                elapsed = max(time.monotonic() - started, 0.001)
                print(
                    f"[index] {stage} scanned={position:,}/{len(rows):,} completed={completed:,} "
                    f"failed={failed:,} rate={position/elapsed:.3f}/s",
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



async def index_photo(row, provider, library_only, stage):
    photo_id = row["kindred_photo_id"]
    try:
        source = provider.resolve_local_path(row["provider_key"])
        if source is None:
            raise FileNotFoundError("Source is unavailable")
        with indexable_original(source) as decoded:
            await main._process_uploaded_photo(
                photo_id, str(decoded), cluster_after=False, fetch_flickr_info=False, index_stage=stage,
            )
        receipt = (
            "SELECT 1 FROM nas_source_files WHERE photo_id=%s AND categorized_at IS NOT NULL"
            if stage == "categories" else
            "SELECT 1 FROM processed_photos WHERE photo_id=%s"
        )
        if main.db_query(receipt, (photo_id,)):
            return True
        error = f"{stage.title()} indexing did not complete"
    except Exception as exc:
        error = str(exc)[:500] or type(exc).__name__
    if library_only:
        error_column = "face_error" if stage == "faces" else "ml_error"
        main.db_query(f"UPDATE nas_source_files SET {error_column}=%s WHERE photo_id=%s", (error, photo_id), fetch=False)
    print(f"[index] failed {photo_id}: {error}", flush=True)
    return False


def index_in_process(row, library_only, stage):
    provider = main.LocalStorageProvider(main.PHOTO_STORAGE_ROOT)
    return asyncio.run(index_photo(row, provider, library_only, stage))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--defer-clustering", action="store_true")
    parser.add_argument("--library-only", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parse_args())))
