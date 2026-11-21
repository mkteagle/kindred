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

    def workers(self):
        return {key: dict(running=True, stale=False, updated_at='2026-11-18T21:00:00Z')
                for key in ('discovery', 'previews', 'recognition')}

    def test_retired_imports_are_never_reported_even_with_stale_disk_counts(self):
        result = build(self.rows(), {'takeout_files': 1000, 'icloud_files': 300}, self.workers())
        self.assertEqual([p['key'] for p in result], ['discovery', 'previews', 'index'])

    def test_absent_workers_are_not_invented_from_catalog_counts(self):
        self.assertEqual(build(self.rows()), [])

    def test_stale_or_stopped_heartbeat_cannot_claim_running(self):
        workers = self.workers()
        workers['recognition']['stale'] = True
        workers['previews']['running'] = False
        result = {p['key']: p for p in build(self.rows(), workers=workers)}
        self.assertFalse(result['index']['running'])
        self.assertFalse(result['previews']['running'])
        self.assertTrue(result['discovery']['running'])

    def test_worker_can_be_running_before_any_count_changes(self):
        result = {p['key']: p for p in build(self.rows(), workers=self.workers())}
        self.assertTrue(result['index']['running'])
        self.assertEqual(result['index']['percent'], 40)

    def test_waiting_worker_does_not_claim_active_work(self):
        workers = self.workers()
        workers['previews']['waiting'] = True
        result = {p['key']: p for p in build(self.rows(), workers=workers)}
        self.assertFalse(result['previews']['running'])


if __name__ == "__main__":
    unittest.main()

class DiscoveryCompletionTests(unittest.TestCase):
    def test_remaining_work_never_rounds_up_to_100(self):
        progress = Progress('discovery', 'Discovery', 2557564, 2558010, False)
        self.assertEqual(progress.percent, 99.9)
        self.assertEqual(progress.remaining, 446)

    def test_finished_scan_with_unexplained_gap_needs_reconciliation(self):
        item=build({'registered':2557564},{'media_files':2558010},
                   {'discovery':{'complete':True,'phase':'complete','registered':2557564,'stale':True}})[0]
        self.assertFalse(item['complete'])
        self.assertEqual(item['phase'],'reconciliation_needed')
        self.assertEqual(item['remaining'],446)

    def test_verified_exclusions_use_eligible_total(self):
        item=build({'registered':2557564},{'media_files':2558010},
                   {'discovery':{'complete':True,'phase':'complete','registered':2557564,'reconciled':True,'eligible_total':2557564,'excluded':446,'stale':True}})[0]
        self.assertTrue(item['complete'])
        self.assertEqual(item['total'],2557564)
        self.assertEqual(item['excluded'],446)
        self.assertEqual(item['remaining'],0)
        self.assertEqual(item['percent'],100)
