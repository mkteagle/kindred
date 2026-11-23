"""Coordinate NAS indexing workers through their shared status directory."""

import asyncio
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import time


DATA_DIR = Path("/app/data")
DISCOVERY_STATUS = "nas-discovery-status.json"
PREVIEW_STATUS = "nas-preview-status.json"


@contextmanager
def preview_queue_access(root, *, discovery=False):
    # A rescan invalidates existing previews. Let the in-flight preview writes
    # commit before discovery changes their source rows.
    with (root / "nas-preview-queue.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX if discovery else fcntl.LOCK_SH)
        yield


def read_status(path, max_age=None):
    try:
        with path.open() as stream:
            file_info = os.fstat(stream.fileno())
            if max_age is not None and time.time() - file_info.st_mtime > max_age:
                return {}
            value = json.load(stream)
        return {**value, "version": file_info.st_mtime_ns} if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


class IndexingPriority:
    def __init__(self, root=DATA_DIR, *, required=False):
        self.discovery = Path(root) / DISCOVERY_STATUS
        self.previews = Path(root) / PREVIEW_STATUS
        self.required = required or os.environ.get("KINDRED_NAS_INDEXING_PRIORITY") == "1"
        self._refresh_at = 0
        self._phase = None

    def blocking_phase(self):
        now = time.monotonic()
        if now >= self._refresh_at:
            self._phase = self._read_phase()
            self._refresh_at = now + 1
        return self._phase

    def _read_phase(self):
        # Standalone workers also support libraries that never used in-place discovery.
        self.required = self.required or self.discovery.exists() or self.previews.exists()
        if not self.required:
            return None
        discovery = read_status(self.discovery)
        if not discovery.get("complete"):
            return "waiting_for_discovery"
        previews = read_status(self.previews, max_age=30)
        if (not previews.get("running") or not previews.get("counts_authoritative")
                or previews.get("stage") != "queue_empty" or previews.get("in_flight") != 0
                or previews.get("checked_discovery_version") != discovery["version"]):
            return "waiting_for_previews"
        return None

    def wait(self, stopped):
        while not stopped.is_set() and self.blocking_phase():
            stopped.wait(2)
        return not stopped.is_set()

    async def wait_async(self, report):
        last_report = None
        while phase := self.blocking_phase():
            # Keep the waiting heartbeat live even when an entire discovery
            # pass or preview backlog takes hours.
            now = time.monotonic()
            if last_report is None or phase != last_report[0] or now - last_report[1] >= 10:
                report(phase)
                last_report = phase, now
            await asyncio.sleep(2)
        return last_report is not None
