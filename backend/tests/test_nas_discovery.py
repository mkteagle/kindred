import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from discover_nas_library import source_file, register_batch, save_status
from library_progress import progress
from storage.local import LocalStorageProvider


class DiscoveryTests(unittest.TestCase):
    def test_pointer_identity_is_stable_without_reading_or_copying_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / '20200102_120000.jpg'
            source.write_bytes(b'original')
            with patch.object(Path, 'open', side_effect=AssertionError('Original bytes must not be read')):
                first = source_file(root, source)
                second = source_file(root, source)
            self.assertEqual(first, second)
            self.assertEqual(first.size, 8)
            self.assertNotEqual(first.photo_id, source_file(root, source, 'other-source').photo_id)
            self.assertEqual(list(root.iterdir()), [source])

    def test_source_symlinks_and_unsupported_files_are_not_registered(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.txt'
            source.write_text('private')
            alias = root / 'alias.jpg'
            alias.symlink_to(source)
            self.assertIsNone(source_file(root, source))
            self.assertIsNone(source_file(root, alias))

    def test_in_place_original_is_read_only_and_cannot_escape_mount(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            library = root / 'photos'
            library.mkdir()
            original = library / 'photo.jpg'
            original.write_bytes(b'original')
            outside = root / 'private.jpg'
            outside.write_bytes(b'private')
            (library / 'escape.jpg').symlink_to(outside)
            provider = LocalStorageProvider(root / 'managed', library)
            self.assertEqual(provider.resolve_local_path('library/photo.jpg'), original.resolve())
            self.assertIsNone(provider.resolve_local_path('library/escape.jpg'))
            self.assertIsNone(provider.resolve_local_path('library/../private.jpg'))
            with self.assertRaises(PermissionError):
                provider.delete('library/photo.jpg')
            self.assertIsNone(provider.link_into_album('trip', 'library/photo.jpg', 'photo.jpg'))
            self.assertEqual(original.read_bytes(), b'original')

    def test_status_does_not_expose_paths_or_report_dead_workers_as_running(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'nas-discovery-status.json'
            save_status(path, dict(running=True, registered=50, source='/private/folder', error='private'))
            self.assertTrue(progress(directory)['discovery']['running'])
            os.utime(path, (time.time()-1000, time.time()-1000))
            status = progress(directory)['discovery']
            self.assertFalse(status['running'])
            self.assertTrue(status['stale'])
            self.assertNotIn('source', status)
            self.assertNotIn('error', status)


if __name__ == '__main__':
    unittest.main()


class DiscoveryResumeTests(unittest.TestCase):
    def setUp(self):
        env=patch.dict(os.environ,DATABASE_URL="postgresql://fixture")
        env.start();self.addCleanup(env.stop)

    def test_existing_catalog_folders_are_skipped_and_completed_pass_does_not_restart(self):
        import argparse
        from unittest.mock import MagicMock
        import discover_nas_library as discovery
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'media';root.mkdir()
            (root/'2024').mkdir();(root/'2025').mkdir()
            for i in range(10):(root/'2024'/f'{i}.jpg').write_bytes(b'original')
            (root/'2025'/'new.jpg').write_bytes(b'original')
            args=argparse.Namespace(source=str(root),source_key='test',status=str(Path(directory)/'status.json'),batch_size=10000,limit=None,rescan=False)
            connection=MagicMock()
            connection.cursor.return_value.__enter__.return_value.fetchall.return_value=[('2024',10)]
            original=discovery.source_file
            def inspect_file(base,path,key):
                self.assertNotEqual(path.parent.name,'2024','Completed folders must not reread originals')
                return original(base,path,key)
            with patch.object(discovery.psycopg2,'connect',return_value=connection), \
                 patch.object(discovery,'register_batch',side_effect=lambda c,rows,key:len(rows)), \
                 patch.object(discovery,'source_file',side_effect=inspect_file), \
                 patch.object(discovery.throttle,'read_pressure',side_effect=AssertionError('Discovery must not consult shared pressure thresholds')):
                discovery.run(args)
            status=json.loads(Path(args.status).read_text())
            self.assertEqual(status['registered'],11)
            self.assertTrue(status['complete'])
            (root/'2025'/'added-later.jpg').write_bytes(b'later')
            connection.cursor.return_value.__enter__.return_value.fetchall.return_value=[('2024',10),('2025',1)]
            with patch.object(discovery.psycopg2,'connect',return_value=connection), \
                 patch.object(discovery,'source_file',side_effect=AssertionError('Completed snapshot must not restart')):
                discovery.run(args)
            self.assertEqual(json.loads(Path(args.status).read_text())['registered'],11)

    def test_limited_run_never_checkpoints_an_incomplete_folder(self):
        import argparse
        from unittest.mock import MagicMock
        import discover_nas_library as discovery
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'media';root.mkdir()
            for i in range(40):(root/f'{i}.jpg').write_bytes(b'original')
            args=argparse.Namespace(source=str(root),source_key='test',status=str(Path(directory)/'status.json'),batch_size=10000,limit=32,rescan=False)
            connection=MagicMock();connection.cursor.return_value.__enter__.return_value.fetchall.return_value=[]
            with patch.object(discovery.psycopg2,'connect',return_value=connection), \
                 patch.object(discovery,'register_batch',side_effect=lambda c,rows,key:len(rows)), \
                 patch.object(discovery.throttle,'read_pressure',side_effect=AssertionError('Discovery must not consult shared pressure thresholds')):
                discovery.run(args)
            self.assertEqual(json.loads(Path(args.status).read_text())['registered'],32)
            self.assertFalse(Path(args.status).with_suffix('.checkpoint.json').exists())
