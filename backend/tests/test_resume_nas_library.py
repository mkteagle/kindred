import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


class ReconcileTests(unittest.TestCase):
    def load_module(self, main):
        spec = importlib.util.spec_from_file_location('resume_test_module', Path(__file__).parents[1] / 'resume_nas_library.py')
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'main': main}):
            spec.loader.exec_module(module)
        return module

    def test_available_catalog_copy_does_not_rehash_original(self):
        main = Mock()
        main.db_query.return_value = [{'exists': 1}]
        module = self.load_module(main)
        with patch.dict('os.environ', {'PHOTO_STORAGE_ROOT': '/photos'}), \
             patch.object(module, 'managed_original', return_value=Path('/photos/ab/id/original.jpg')):
            self.assertTrue(module.reconcile('one.jpg', {'kindred_photo_id': 'id'}, Path('/source')))
        main._file_sha256.assert_not_called()
        self.assertEqual(main.db_query.call_count, 1)

    def test_missing_catalog_copy_is_recovered(self):
        main = Mock()
        main.db_query.return_value = []
        main._file_sha256.return_value = 'checksum'
        module = self.load_module(main)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            original = root / 'original.jpg'
            original.write_bytes(b'original')
            with patch.dict('os.environ', {'PHOTO_STORAGE_ROOT': str(root)}), \
                 patch.object(module, 'managed_original', return_value=original):
                self.assertTrue(module.reconcile('missing.jpg', {'kindred_photo_id': 'id'}, root))
        main._file_sha256.assert_called_once()
        self.assertEqual(main.db_query.call_count, 3)

    def test_verified_mirror_is_not_uploaded_or_checkpoint_rewritten(self):
        import argparse
        import asyncio
        from unittest.mock import AsyncMock
        main = Mock()
        main.db_query.return_value = [{'photo_id': 'photo-id', 'provider_key': 'flickr-id'}]
        module = self.load_module(main)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / 'one.jpg'
            source.write_bytes(b'original')
            progress = {'completed': {'one.jpg': {
                'kindred_photo_id': 'photo-id', 'flickr_photo_id': 'flickr-id'}}, 'failed': {}}
            args = argparse.Namespace(source=directory, progress=str(root / 'progress.json'),
                                      defer_analysis=True, privacy='family')
            with patch.dict('os.environ', {'PHOTO_STORAGE_ROOT': str(root)}), \
                 patch.object(module, 'reconcile', return_value=True) as reconcile, \
                 patch.object(module.staged_import, 'load_progress', return_value=progress), \
                 patch.object(module.staged_import, 'iter_media', return_value=iter([source])), \
                 patch.object(module.staged_import, 'save_progress') as save, \
                 patch.object(module, 'mirror', new_callable=AsyncMock) as mirror:
                self.assertEqual(asyncio.run(module._run(args)), 0)
            reconcile.assert_called_once()
            mirror.assert_not_awaited()
            save.assert_not_called()
