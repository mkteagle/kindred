import copy
from pathlib import Path
import tempfile
import unittest

from cloud_migration import audit, inventory, load_accounts


class CloudMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.export = self.root / 'export'
        self.nas = self.root / 'nas'
        self.export.mkdir()
        self.nas.mkdir()
        self.config = {'schema_version': 1, 'accounts': [
            {'account_key': 'person-icloud', 'person_key': 'person', 'provider': 'icloud',
             'export_root': str(self.export)}]}

    def snapshot(self):
        return inventory(self.config, 'person-icloud')

    def test_preserves_live_photo_raw_and_sidecar_resources(self):
        for name in ('image.HEIC', 'image.MOV', 'image.AAE', 'image.json', 'image.DNG'):
            (self.export / name).write_bytes(name.encode())
        snapshot = self.snapshot()
        self.assertEqual(len(snapshot['files']), 5)
        self.assertFalse(snapshot['cloud_inventory_complete'])
        self.assertTrue(all(f['provider_asset_id'] is None for f in snapshot['files']))

    def test_account_cannot_read_other_snapshot(self):
        with self.assertRaisesRegex(ValueError, 'account mismatch'):
            audit(self.snapshot(), 'wife-icloud', self.nas)

    def test_duplicate_account_and_overlapping_roots_rejected(self):
        for change in ({}, {'account_key': 'wife-icloud'},
                       {'account_key': 'wife-icloud', 'export_root': str(self.export / 'nested')}):
            config = copy.deepcopy(self.config)
            config['accounts'].append({**config['accounts'][0], **change})
            with self.assertRaises(ValueError):
                load_accounts(config)

    def test_separate_accounts_keep_same_filename_separate(self):
        other = self.root / 'wife'
        other.mkdir()
        (self.export / 'IMG.HEIC').write_bytes(b'one')
        (other / 'IMG.HEIC').write_bytes(b'two')
        self.config['accounts'].append({'account_key': 'wife-icloud', 'person_key': 'wife',
                                       'provider': 'icloud', 'export_root': str(other)})
        first = self.snapshot()
        second = inventory(self.config, 'wife-icloud')
        self.assertNotEqual(first['account_key'], second['account_key'])
        self.assertNotEqual(first['files'][0]['sha256'], second['files'][0]['sha256'])

    def test_symlink_in_export_is_not_silently_followed(self):
        (self.export / 'escape').symlink_to(self.nas, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.snapshot()

    def test_empty_inventory_never_establishes_backup(self):
        report = audit(self.snapshot(), 'person-icloud', self.nas)
        self.assertFalse(report['all_export_files_match_nas'])
        self.assertFalse(report['cloud_cleanup_allowed'])

    def test_nas_requires_explicit_mapping_and_matching_bytes(self):
        (self.export / 'original.heic').write_bytes(b'original')
        snapshot = self.snapshot()
        resource = snapshot['files'][0]
        self.assertEqual(audit(snapshot, 'person-icloud', self.nas)['files'][0]['nas_integrity'], 'unmapped')
        resource['nas_relative_path'] = 'original.heic'
        self.assertEqual(audit(snapshot, 'person-icloud', self.nas)['files'][0]['nas_integrity'], 'missing')
        (self.nas / 'original.heic').write_bytes(b'converted jpeg')
        self.assertEqual(audit(snapshot, 'person-icloud', self.nas)['files'][0]['nas_integrity'], 'mismatch')
        (self.nas / 'original.heic').write_bytes(b'original')
        report = audit(snapshot, 'person-icloud', self.nas)
        self.assertTrue(report['all_export_files_match_nas'])
        self.assertFalse(report['cloud_cleanup_allowed'])
        self.assertEqual((self.export / 'original.heic').read_bytes(), b'original')

    def test_missing_motion_component_blocks_complete_copy(self):
        for name in ('live.heic', 'live.mov'):
            (self.export / name).write_bytes(name.encode())
        snapshot = self.snapshot()
        for resource in snapshot['files']:
            resource['nas_relative_path'] = resource['source_relative_path']
        (self.nas / 'live.heic').write_bytes(b'live.heic')
        self.assertFalse(audit(snapshot, 'person-icloud', self.nas)['all_export_files_match_nas'])

    def test_nas_path_escape_and_symlink_escape_rejected(self):
        (self.export / 'original').write_bytes(b'original')
        snapshot = self.snapshot()
        (self.nas / 'escape').symlink_to(self.export / 'original')
        for path in ('../export/original', str(self.export / 'original'), 'escape'):
            snapshot['files'][0]['nas_relative_path'] = path
            report = audit(snapshot, 'person-icloud', self.nas)
            self.assertEqual(report['files'][0]['nas_integrity'], 'unreadable_or_unsafe')

    def test_duplicate_or_invalid_receipts_rejected(self):
        (self.export / 'original').write_bytes(b'original')
        snapshot = self.snapshot()
        snapshot['files'].append(copy.deepcopy(snapshot['files'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            audit(snapshot, 'person-icloud', self.nas)
        snapshot['files'].pop()
        snapshot['files'][0]['sha256'] = 'not a checksum'
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            audit(snapshot, 'person-icloud', self.nas)


if __name__ == '__main__':
    unittest.main()
