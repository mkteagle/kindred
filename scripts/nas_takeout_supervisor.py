#!/usr/bin/env python3
"""Keep the restart-safe Google Takeout browser queue running on the NAS."""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


DOWNLOAD_DIR = Path("/volume1/docker/Create folderFirefoxTakeout")
QUEUE_DIR = Path("/volume1/docker/FirefoxTakeout/queue")
QUEUE_SCRIPT = QUEUE_DIR / "nas_takeout_queue.py"
STATE_PATH = QUEUE_DIR / "takeout-supervisor-state.json"
LOG_PATH = QUEUE_DIR / "takeout-supervisor.log"
PID_PATH = QUEUE_DIR / "takeout-queue.pid"
TOTAL_PARTS = 140


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    with LOG_PATH.open("a") as stream:
        stream.write(f"{now()} {message}\n")


def write_state(**values: object) -> None:
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps({"updated_at": now(), **values}, indent=2) + "\n")
    temporary.replace(STATE_PATH)


def completed_parts() -> set[int]:
    completed: set[int] = set()
    for path in DOWNLOAD_DIR.glob("*.zip"):
        match = re.search(r"-(\d{3})\.zip$", path.name)
        if match and path.stat().st_size > 0:
            completed.add(int(match.group(1)))
    return completed


def quarantine_completed_duplicates() -> list[str]:
    duplicate_dir = QUEUE_DIR / "duplicate-downloads"
    moved: list[str] = []
    for duplicate in DOWNLOAD_DIR.glob("*.zip"):
        match = re.search(r"\((\d+)\)\.zip$", duplicate.name)
        if not match:
            continue
        if duplicate.stat().st_size <= 0:
            continue
        canonical = duplicate.with_name(re.sub(r"\(\d+\)(?=\.zip$)", "", duplicate.name))
        if (
            not canonical.exists()
            or canonical.stat().st_size <= 0
            or canonical.stat().st_size != duplicate.stat().st_size
        ):
            continue
        duplicate_dir.mkdir(exist_ok=True)
        destination = duplicate_dir / duplicate.name
        if not destination.exists():
            try:
                duplicate.replace(destination)
                moved.append(duplicate.name)
            except PermissionError:
                # Firefox writes downloads as root inside its container. Keep
                # supervising if the NAS SSH user cannot quarantine the file;
                # the duplicate remains recoverable for privileged cleanup.
                log(f"could not quarantine root-owned duplicate: {duplicate.name}")
    return moved


def queue_pid() -> int | None:
    try:
        pid = int(PID_PATH.read_text().strip())
        os.kill(pid, 0)
        stat_fields = Path(f"/proc/{pid}/stat").read_text().split()
        if len(stat_fields) > 2 and stat_fields[2] == "Z":
            return None
        return pid
    except (FileNotFoundError, ProcessLookupError, PermissionError, ValueError):
        return None


def start_queue(start_index: int) -> int:
    output = (QUEUE_DIR / "takeout-queue-run.out").open("ab")
    process = subprocess.Popen(
        [
            "python3",
            str(QUEUE_SCRIPT),
            "--archive-html",
            str(QUEUE_DIR / "archive.html"),
            "--download-dir",
            str(DOWNLOAD_DIR),
            "--queue-dir",
            str(QUEUE_DIR),
            "--vncdo",
            str(QUEUE_DIR / "vncdo"),
            "--vnc-password-file",
            str(QUEUE_DIR / ".vnc-password"),
            "--start-index",
            str(start_index),
            "--max-concurrent",
            "1",
            "--auto-submit-login-after",
            "15",
        ],
        stdin=subprocess.DEVNULL,
        stdout=output,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    PID_PATH.write_text(f"{process.pid}\n")
    return process.pid


def main() -> None:
    log("supervisor started")
    while True:
        for duplicate in quarantine_completed_duplicates():
            log(f"moved verified duplicate to quarantine: {duplicate}")
        completed = completed_parts()
        missing = [part for part in range(1, TOTAL_PARTS + 1) if part not in completed]
        partials = sorted(DOWNLOAD_DIR.glob("*.part"))
        pid = queue_pid()

        if not missing:
            write_state(status="complete", completed_files=TOTAL_PARTS, total_parts=TOTAL_PARTS)
            log("verified all 140 Takeout parts complete")
            return

        if pid is None and not partials:
            first_missing = missing[0]
            pid = start_queue(first_missing - 1)
            log(f"restarted queue at part {first_missing}; pid={pid}")

        write_state(
            status="downloading" if partials or pid else "waiting",
            completed_files=len(completed),
            next_missing_part=missing[0],
            active_files=[{"name": p.name, "bytes": p.stat().st_size} for p in partials],
            queue_pid=pid,
            total_parts=TOTAL_PARTS,
        )
        time.sleep(30)


if __name__ == "__main__":
    main()
