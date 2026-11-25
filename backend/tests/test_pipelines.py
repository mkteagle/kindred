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

    def test_preview_pass_finishes_with_terminal_failures(self):
        workers = self.workers()
        workers['discovery'].update(complete=True, version=52, reconciled=True, eligible_total=90)
        workers['previews'].update(waiting=True, counts_authoritative=True, stage='queue_empty',
                                   in_flight=0, checked_discovery_version=52)
        rows = self.rows(registered=100, previews_ready=98, previews_failed=2)
        preview = next(row for row in build(rows, workers=workers) if row['key'] == 'previews')
        self.assertTrue(preview['complete'])
        self.assertFalse(preview['running'])
        self.assertEqual(preview['phase'], 'complete_with_errors')
        self.assertEqual((preview['done'], preview['total'], preview['failed']), (98, 100, 2))
        self.assertEqual((preview['remaining'], preview['percent']), (0, 100))

        rows['registered'] = 101
        preview = next(row for row in build(rows, workers=workers) if row['key'] == 'previews')
        self.assertFalse(preview['complete'])
        self.assertEqual(preview['phase'], 'reconciliation_needed')
        self.assertEqual(preview['remaining'], 1)

        rows['previews_ready'] = 99
        workers['discovery']['version'] = 53
        preview = next(row for row in build(rows, workers=workers) if row['key'] == 'previews')
        self.assertFalse(preview['complete'])
        self.assertEqual(preview['phase'], 'checking_completion')

    def test_backup_priority_and_split_recognition_follow_the_running_phase(self):
        workers = {
            key: dict(running=True, stale=False)
            for key in ('recognition', 'r2', 'flickr_match', 'flickr_backup')
        }
        workers['recognition'].update(split_stages=True, faces_enabled=True, phase='categories')
        rows = self.rows(categorized=60, recognition_total=95)
        result = build(rows, workers=workers)
        self.assertEqual([row['key'] for row in result],
                         ['flickr_backup', 'flickr_match', 'r2', 'categorization', 'faces'])
        self.assertEqual([row['running'] for row in result], [True, True, True, True, False])
        self.assertEqual((result[-2]['done'], result[-2]['total']), (60, 95))
        workers['recognition']['phase'] = 'faces'
        result = build(rows, workers=workers)
        self.assertEqual([row['key'] for row in result][-2:], ['faces', 'categorization'])
        self.assertTrue(result[-2]['running'])
        self.assertEqual(result[-1]['phase'], 'queued')
        workers['recognition']['faces_enabled'] = False
        self.assertNotIn('faces', [row['key'] for row in build(rows, workers=workers)])

    def test_r2_publication_uses_its_own_inventory_and_sorts_first(self):
        workers = self.workers()
        workers['r2'] = dict(running=True, stale=False, phase='publishing', completed=24, thumbnail_total=80)
        workers['flickr_backup'] = dict(running=False, stale=False, phase='waiting_for_flickr_match')
        result = build(self.rows(registered=100), workers=workers)
        r2 = next(row for row in result if row['key'] == 'r2')
        self.assertEqual((r2['done'], r2['total'], r2['remaining'], r2['percent']), (24, 80, 56, 30))
        self.assertTrue(r2['running'])
        self.assertEqual(result[-1]['key'], 'flickr_backup')

    def test_a_caught_up_r2_publisher_waits_for_more_previews(self):
        workers = self.workers()
        workers['r2'] = dict(running=False, stale=False, phase='caught_up', completed=24, thumbnail_total=24)
        r2 = next(row for row in build(self.rows(), workers=workers) if row['key'] == 'r2')
        self.assertEqual(r2['phase'], 'waiting_for_previews')
        self.assertFalse(r2['complete'])
        workers['discovery']['complete'] = True
        workers['previews'].update(counts_authoritative=True, stage='queue_empty', in_flight=0)
        r2 = next(row for row in build(self.rows(), workers=workers) if row['key'] == 'r2')
        self.assertTrue(r2['complete'])

    def test_r2_does_not_show_100_percent_from_a_preview_estimate(self):
        workers = self.workers()
        workers['previews'].update(counts_authoritative=True, completed=20)
        workers['r2'] = dict(running=True, stale=False, phase='publishing', completed=24)
        r2 = next(row for row in build(self.rows(), workers=workers) if row['key'] == 'r2')
        self.assertTrue(r2['running'])
        self.assertEqual(r2['phase'], 'counting_thumbnails')
        self.assertIsNone(r2['percent'])

    def test_flickr_comparison_reports_checked_items_even_while_paused(self):
        worker = dict(running=True, stale=False, phase='waiting_for_capacity',
                      completed=4, remote_total=20, matched=3, unmatched=1)
        item, = build(self.rows(), workers={'flickr_match': worker})
        self.assertEqual((item['done'], item['total'], item['percent']), (4, 20, 20))
        self.assertFalse(item['running'])
        self.assertIn('NAS', item['detail'])

    def test_flickr_backup_shows_linked_files_and_keeps_retries_visible(self):
        worker = dict(running=False, stale=False, phase='caught_up', completed=8, matched=5, failed=3)
        item, = build(self.rows(), workers={'flickr_backup': worker})
        self.assertEqual(item['done'], 5)
        self.assertIsNone(item['total'])
        self.assertEqual(item['phase'], 'retrying')
        self.assertFalse(item['complete'])


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
