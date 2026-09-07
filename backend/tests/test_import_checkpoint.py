import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import import_checkpoint as checkpoint


class CheckpointTests(unittest.TestCase):
    def test_alias_receipts_and_mutated_nested_receipt_survive_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            path.write_text(json.dumps({'completed': {'year/a.jpg': {'kindred_photo_id': 'same'}}, 'failed': {}}))
            before = path.read_bytes()
            progress = checkpoint.load(path)
            progress['completed']['album/a.jpg'] = {'kindred_photo_id': 'same'}
            checkpoint.save(path, progress, 'album/a.jpg')
            progress['completed']['year/a.jpg']['flickr_photo_id'] = 'remote'
            checkpoint.save(path, progress, 'year/a.jpg')
            self.assertEqual(path.read_bytes(), before)  # No whole-file write.
            self.assertEqual(checkpoint.load(path), progress)
            self.assertEqual(len(checkpoint.load(path)['completed']), 2)

    def test_torn_final_append_is_discarded_before_next_append(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            progress = checkpoint.load(path)
            progress['completed']['a'] = {'id': 1}
            checkpoint.save(path, progress, 'a')
            with checkpoint.journal_path(path).open('ab') as stream:
                stream.write(b'{"payload": "interrupted')
            recovered = checkpoint.load(path)
            self.assertEqual(recovered, progress)
            recovered['failed']['b'] = 'retry'
            checkpoint.save(path, recovered, 'b')
            self.assertEqual(checkpoint.load(path), recovered)

    def test_complete_corrupt_record_and_corrupt_snapshot_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            checkpoint.journal_path(path).write_bytes(b'{"payload":"tampered","sha256":"wrong"}\n')
            with self.assertRaisesRegex(ValueError, 'Corrupt'):
                checkpoint.load(path)
            checkpoint.journal_path(path).unlink()
            path.write_text('{broken')
            with self.assertRaises(ValueError):
                checkpoint.load(path)

    def test_snapshot_written_before_journal_clear_can_replay_after_crash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            progress = checkpoint.load(path)
            progress['completed']['a'] = {'id': 1}
            checkpoint.save(path, progress, 'a')
            old_journal = checkpoint.journal_path(path).read_bytes()
            checkpoint.save(path, progress)
            checkpoint.journal_path(path).write_bytes(old_journal)
            recovered = checkpoint.load(path)
            self.assertEqual(recovered, progress)
            recovered['failed']['a'] = 'retry'
            checkpoint.save(path, recovered, 'a')
            self.assertEqual(checkpoint.load(path), recovered)

    def test_periodic_compaction_and_failure_deletion(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(checkpoint, 'COMPACT_EVERY', 2):
            path = Path(directory) / 'progress.json'
            progress = checkpoint.load(path)
            progress['failed']['a'] = 'error'
            checkpoint.save(path, progress, 'a')
            progress['failed'].pop('a')
            progress['completed']['a'] = {'id': 1}
            checkpoint.save(path, progress, 'a')
            self.assertTrue(path.exists())
            self.assertEqual(checkpoint.journal_path(path).read_bytes(), b'')
            self.assertEqual(checkpoint.load(path), progress)

    def test_journal_sequence_gap_stops_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            progress = checkpoint.load(path)
            for name in ('a', 'b', 'c'):
                progress['completed'][name] = {'id': name}
                checkpoint.save(path, progress, name)
            journal = checkpoint.journal_path(path)
            lines = journal.read_bytes().splitlines(keepends=True)
            journal.write_bytes(lines[0] + lines[2])
            with self.assertRaisesRegex(ValueError, 'nonconsecutive'):
                checkpoint.load(path)

    def test_redundant_save_of_current_receipt_does_not_append(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            progress = checkpoint.load(path)
            progress['completed']['a'] = {'id': 1}
            checkpoint.save(path, progress, 'a')
            before = checkpoint.journal_path(path).read_bytes()
            checkpoint.save(path, progress, 'a')
            self.assertEqual(checkpoint.journal_path(path).read_bytes(), before)
            progress['completed']['a']['flickr_photo_id'] = 'remote'
            checkpoint.save(path, progress, 'a')
            self.assertEqual(checkpoint.load(path), progress)

    def test_compact_cli_exports_latest_receipts_for_legacy_reader(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            progress = checkpoint.load(path)
            progress['completed']['a'] = {'id': 1}
            checkpoint.save(path, progress, 'a')
            checkpoint.compact(path)
            self.assertEqual(json.loads(path.read_text())['completed'], progress['completed'])
            self.assertEqual(checkpoint.journal_path(path).read_bytes(), b'')

    def test_stale_plain_snapshot_cannot_discard_journaled_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            checkpoint.save(path, {'completed': {'old': {'id': 1}}, 'failed': {}})
            stale = json.loads(path.read_text())
            progress = checkpoint.load(path)
            progress['completed']['new'] = {'id': 2}
            checkpoint.save(path, progress, 'new')
            snapshot_before = path.read_bytes()
            journal_before = checkpoint.journal_path(path).read_bytes()
            with self.assertRaisesRegex(ValueError, 'plain-dictionary'):
                checkpoint.save(path, stale)
            self.assertEqual(path.read_bytes(), snapshot_before)
            self.assertEqual(checkpoint.journal_path(path).read_bytes(), journal_before)
            self.assertEqual(checkpoint.load(path), progress)
            checkpoint.save(path, checkpoint.load(path))
            self.assertIn('new', json.loads(path.read_text())['completed'])
