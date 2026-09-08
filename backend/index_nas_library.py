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
import throttle


def pending(limit: int | None) -> list[dict]:
    suffix = " LIMIT %s" if limit else ""
    # The sentinel keeps the ordering expression non-null so undated photos sort
    # to the end instead of ahead of everything, the way they used to in the
    # gallery when created_at stood in for a capture date.
    params = ("0001-01-01", limit) if limit else ("0001-01-01",)
    return main.db_query(
        """
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
        WHERE p.media_type LIKE 'image/%%'
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


async def run(args: argparse.Namespace) -> int:
    provider = main.LocalStorageProvider(main.PHOTO_STORAGE_ROOT)
    rows = pending(args.limit)
    print(f"[index] pending={len(rows):,}", flush=True)
    completed = failed = 0
    started = time.monotonic()
    delay = 0.0
    paused = 0.0
    for position, row in enumerate(rows, 1):
        # Pace against what the box is actually feeling. A fixed quota would
        # throttle this run just as hard on an idle NAS as on a thrashing one,
        # and there are a million and a half photos to get through.
        pressure = throttle.read_pressure()
        delay = throttle.next_delay(delay, pressure)
        if delay:
            paused += delay
            await asyncio.sleep(delay)
        source = provider.resolve_local_path(row["provider_key"])
        if source is None:
            failed += 1
            print(f"[index] missing NAS original {row['kindred_photo_id']}", flush=True)
            continue
        try:
            with indexable_original(source) as decoded:
                await main._process_uploaded_photo(
                    row["kindred_photo_id"], str(decoded), cluster_after=False,
                    fetch_flickr_info=False,
                )
        except Exception as exc:
            failed += 1
            print(f"[index] failed {row['kindred_photo_id']}: {exc}", flush=True)
            continue
        verified = main.db_query(
            "SELECT 1 FROM processed_photos WHERE photo_id=%s LIMIT 1",
            (row["kindred_photo_id"],),
        )
        if verified:
            completed += 1
        else:
            failed += 1
            print(f"[index] failed {row['kindred_photo_id']}", flush=True)
        if position % 10 == 0:
            elapsed = max(time.monotonic() - started, 0.001)
            print(
                f"[index] scanned={position:,}/{len(rows):,} completed={completed:,} "
                f"failed={failed:,} rate={position/elapsed:.3f}/s "
                f"paused={paused:.0f}s {throttle.describe(delay, pressure)}",
                flush=True,
            )

    if not args.defer_clustering:
        for category in ("people", "pets", "vehicles"):
            main.run_clustering(category, distance_threshold=0.80)
    print(f"[index] done completed={completed:,} failed={failed:,}", flush=True)
    return 1 if failed else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--defer-clustering", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parse_args())))
