#!/usr/bin/env python3
"""Store Google's face tags for photos imported before they were being kept.

Tags are captured at import now, which covers essentially the whole library --
only twenty thousand of a million and a quarter photos were already in when
that started. This is for those twenty thousand.

The match is exact rather than guessed. The import checkpoint records the
source path of every file it has imported alongside the Kindred photo id it
became, so each sidecar can be tied to its photo without matching on filenames,
which repeat freely across four thousand albums.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path[:0] = ["/app", "/app/data"]

import main            # noqa: E402
import staged_import   # noqa: E402


def receipts_from(progress_path: Path) -> dict:
    """relative source path -> receipt, as the importer left it."""
    from import_checkpoint import load
    progress = load(progress_path)
    return progress.get("completed") or {}


def run(root: Path, progress_path: Path, dry_run: bool) -> int:
    receipts = receipts_from(progress_path)
    print(f"[tags] {len(receipts):,} imported files in the checkpoint", flush=True)

    considered = tagged = names_written = missing = 0
    for relative, receipt in receipts.items():
        photo_id = (receipt or {}).get("kindred_photo_id")
        if not photo_id:
            continue
        considered += 1
        source = root / relative
        sidecar = staged_import.sidecar_for(source)
        if sidecar is None:
            missing += 1
            continue
        try:
            data = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            missing += 1
            continue
        names = staged_import.people_names(data)
        if not names:
            continue
        tagged += 1
        if not dry_run:
            names_written += main.record_people_tags(photo_id, names)
        else:
            names_written += len(names)
        if tagged % 500 == 0:
            print(f"[tags] {tagged:,} photos tagged, {names_written:,} names", flush=True)

    print(f"[tags] done: considered={considered:,} tagged={tagged:,} "
          f"names={names_written:,} no_sidecar={missing:,}"
          f"{' (dry run, nothing written)' if dry_run else ''}", flush=True)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="The import tree the checkpoint refers to")
    parser.add_argument("--progress", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(run(args.root, args.progress, args.dry_run))
