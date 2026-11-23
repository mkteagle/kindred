import asyncio
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from worker_priority import DISCOVERY_STATUS, PREVIEW_STATUS, IndexingPriority


class WorkerPriorityTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.discovery = self.root / DISCOVERY_STATUS
        self.previews = self.root / PREVIEW_STATUS

    def report_discovery(self, complete):
        self.discovery.write_text(json.dumps({"complete": complete}))
        return self.discovery.stat().st_mtime_ns

    def report_previews(self, version, **changes):
        state = dict(running=True, counts_authoritative=True, stage="queue_empty",
                     in_flight=0, checked_discovery_version=version)
        self.previews.write_text(json.dumps(state | changes))

    def test_new_discovery_and_thumbnail_work_interrupt_a_running_worker(self):
        priority = IndexingPriority(self.root, required=True)
        with patch("worker_priority.time.monotonic", side_effect=range(20)):
            self.assertEqual(priority.blocking_phase(), "waiting_for_discovery")
            first = self.report_discovery(True)
            self.report_previews(first)
            self.assertIsNone(priority.blocking_phase())

            self.report_discovery(False)
            self.assertEqual(priority.blocking_phase(), "waiting_for_discovery")
            second = self.report_discovery(True)
            self.assertEqual(priority.blocking_phase(), "waiting_for_previews")
            self.report_previews(second, stage="rendering", in_flight=4)
            self.assertEqual(priority.blocking_phase(), "waiting_for_previews")
            self.report_previews(second)
            self.assertIsNone(priority.blocking_phase())

    def test_a_stale_or_unavailable_previewer_cannot_release_the_queue(self):
        version = self.report_discovery(True)
        self.report_previews(version)
        old = time.time() - 60
        os.utime(self.previews, (old, old))
        self.assertEqual(IndexingPriority(self.root, required=True).blocking_phase(), "waiting_for_previews")
        self.previews.unlink()
        self.assertEqual(IndexingPriority(self.root, required=True).blocking_phase(), "waiting_for_previews")

    def test_standalone_workers_can_run_without_nas_discovery(self):
        with patch.dict(os.environ, {"KINDRED_NAS_INDEXING_PRIORITY": "0"}):
            self.assertIsNone(IndexingPriority(self.root).blocking_phase())

    def test_wait_reports_discovery_then_thumbnails_and_resumes(self):
        priority = IndexingPriority(self.root, required=True)
        reports = []

        async def tick(_):
            if len(reports) == 1:
                self.version = self.report_discovery(True)
            else:
                self.report_previews(self.version)

        with patch("worker_priority.time.monotonic", side_effect=range(30)), patch("worker_priority.asyncio.sleep", tick):
            self.assertTrue(asyncio.run(priority.wait_async(reports.append)))
        self.assertEqual(reports, ["waiting_for_discovery", "waiting_for_previews"])
