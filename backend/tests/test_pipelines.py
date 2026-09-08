"""What a progress bar is allowed to claim.

The failure this exists to prevent is a bar that looks like progress when
nothing is happening -- the iCloud download sat stopped for twenty minutes
behind a container that reported "healthy". So an unknown total renders
indeterminate rather than guessing, and a stalled pipeline gets no ETA at all.
"""
from __future__ import annotations

import unittest

from pipelines import Progress, build, eta_seconds, format_eta


class ProgressTests(unittest.TestCase):
    def test_percent_of_a_known_total(self):
        self.assertEqual(Progress("k", "L", 25, 100, True).percent, 25.0)

    def test_an_unknown_total_has_no_percent(self):
        # The Takeout tree is still growing; inventing a denominator would draw
        # a bar that moves backwards when the real total arrives.
        self.assertIsNone(Progress("k", "L", 25, None, True).percent)

    def test_a_zero_total_has_no_percent_rather_than_dividing_by_zero(self):
        self.assertIsNone(Progress("k", "L", 0, 0, False).percent)

    def test_percent_is_capped_when_done_overruns_the_total(self):
        # Disk counts are cached, so done can briefly exceed a stale total.
        self.assertEqual(Progress("k", "L", 120, 100, True).percent, 100.0)

    def test_remaining_never_goes_negative(self):
        self.assertEqual(Progress("k", "L", 120, 100, True).remaining, 0)

    def test_remaining_is_unknown_without_a_total(self):
        self.assertIsNone(Progress("k", "L", 5, None, True).remaining)

    def test_the_payload_carries_the_derived_fields(self):
        payload = Progress("k", "L", 25, 100, True).as_dict()
        self.assertEqual(payload["percent"], 25.0)
        self.assertEqual(payload["remaining"], 75)
        self.assertEqual(payload["label"], "L")


class EtaTests(unittest.TestCase):
    def test_a_moving_pipeline_gets_an_estimate(self):
        self.assertEqual(eta_seconds(0, 60, 60.0), 60)

    def test_a_stalled_pipeline_gets_no_estimate(self):
        # Zero rate is "not moving", not "about to finish".
        self.assertIsNone(eta_seconds(10, 100, 0))
        self.assertIsNone(eta_seconds(10, 100, None))

    def test_an_unknown_total_gets_no_estimate(self):
        self.assertIsNone(eta_seconds(10, None, 50))

    def test_a_finished_pipeline_is_zero_not_unknown(self):
        self.assertEqual(eta_seconds(100, 100, 5), 0)

    def test_durations_read_like_english(self):
        self.assertEqual(format_eta(30), "under a minute")
        self.assertEqual(format_eta(600), "10 min")
        self.assertEqual(format_eta(7200), "2.0 hours")
        self.assertIn("days", format_eta(60 * 60 * 100))

    def test_an_unknown_duration_renders_as_nothing(self):
        self.assertEqual(format_eta(None), "")


class BuildTests(unittest.TestCase):
    def rows(self, **overrides):
        base = dict(photos=100, indexed=40, on_nas=100, on_flickr=90,
                    videos=10, videos_ready=3, imported=50)
        base.update(overrides)
        return base

    def test_every_pipeline_is_reported(self):
        keys = [p["key"] for p in build(self.rows())]
        self.assertEqual(keys, ["import", "icloud", "index", "flickr", "video"])

    def test_it_works_with_no_disk_measurement_at_all(self):
        # The first request after a restart has no cached scan yet.
        rows = build(self.rows())
        by_key = {p["key"]: p for p in rows}
        self.assertIsNone(by_key["import"]["percent"])
        self.assertIsNone(by_key["icloud"]["total"])
        # Database-derived pipelines still report properly.
        self.assertEqual(by_key["index"]["percent"], 40.0)

    def test_disk_measurements_are_stamped_with_their_age(self):
        rows = build(self.rows(), {"takeout_files": 1000, "measured_at": "2026-09-07T12:00:00Z"})
        by_key = {p["key"]: p for p in rows}
        self.assertEqual(by_key["import"]["measured_at"], "2026-09-07T12:00:00Z")
        # Database pipelines are live, so they carry no measurement time.
        self.assertIsNone(by_key["index"]["measured_at"])

    def test_running_flags_pass_through(self):
        rows = build(self.rows(index_running=True, flickr_running=False))
        by_key = {p["key"]: p for p in rows}
        self.assertTrue(by_key["index"]["running"])
        self.assertFalse(by_key["flickr"]["running"])


if __name__ == "__main__":
    unittest.main()
