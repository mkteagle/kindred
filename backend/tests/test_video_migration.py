from hashlib import sha256
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import uuid

from migrate_video_originals import migrate_one
from storage.local import LocalStorageProvider, managed_originals


class MigrationTests(unittest.TestCase):
    def fixture(self, root):
        photo_id = str(uuid.uuid4())
        key = f'{photo_id[:2]}/{photo_id}/original.mov'
        old = root / key
        old.parent.mkdir(parents=True)
        old.write_bytes(b'intact original movie')
        row = dict(photo_id=photo_id, provider_key=key, sha256=sha256(old.read_bytes()).hexdigest())
        return old, row

    def test_new_videos_are_stored_separately(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'video.MOV'
            source.write_bytes(b'video')
            stored = LocalStorageProvider(root / 'library').store_file(str(uuid.uuid4()), source, source.name)
            self.assertTrue(stored.provider_key.startswith('videos/'))
            self.assertEqual(stored.local_path.read_bytes(), b'video')

    def test_migration_preserves_album_links_and_checkpoint_alias(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, row = self.fixture(root)
            inode = old.stat().st_ino
            provider = LocalStorageProvider(root)
            album = root / provider.link_into_album('family', row['provider_key'], 'movie.mov')
            update = Mock()
            key = migrate_one(root, row, update, apply=True)
            new = root / key
            self.assertTrue(old.is_symlink())
            self.assertEqual(new.stat().st_ino, inode)
            self.assertEqual(album.read_bytes(), b'intact original movie')
            self.assertEqual(provider.resolve_local_path(row['provider_key']), new.resolve())
            self.assertEqual(list(managed_originals(root)), [new])
            self.assertEqual(provider.link_into_album('family', key, 'movie.mov'), album.relative_to(root).as_posix())
            update.assert_called_once_with(row['photo_id'], row['provider_key'], key)

    def test_resume_after_sql_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, row = self.fixture(root)
            with self.assertRaises(RuntimeError):
                migrate_one(root, row, Mock(side_effect=RuntimeError('database offline')), apply=True)
            self.assertEqual(old.read_bytes(), b'intact original movie')
            update = Mock()
            migrate_one(root, row, update, apply=True)
            update.assert_called_once()

    def test_dry_run_and_checksum_failure_do_not_move_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, row = self.fixture(root)
            update = Mock()
            migrate_one(root, row, update)
            self.assertFalse((root / 'videos').exists())
            row['sha256'] = 'wrong'
            with self.assertRaises(ValueError):
                migrate_one(root, row, update, apply=True)
            self.assertFalse(old.is_symlink())
            update.assert_not_called()

    def test_resume_between_hardlink_and_alias(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, row = self.fixture(root)
            new = root / 'videos' / row['provider_key']
            new.parent.mkdir(parents=True)
            os.link(old, new)
            migrate_one(root, row, Mock(), apply=True)
            self.assertTrue(old.is_symlink())
            self.assertEqual(old.read_bytes(), new.read_bytes())
