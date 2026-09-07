from pathlib import Path
import tempfile
import unittest
import uuid

from storage.local import LocalStorageProvider


class LocalStorageProviderTests(unittest.TestCase):
    def test_stores_hashes_and_resolves_original_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "camera.HEIC"
            source.write_bytes(b"kindred-photo")
            provider = LocalStorageProvider(root / "library")
            photo_id = str(uuid.uuid4())

            stored = provider.store_file(photo_id, source, source.name)

            self.assertEqual(stored.provider, "nas")
            self.assertEqual(stored.byte_size, 13)
            self.assertEqual(len(stored.sha256), 64)
            self.assertEqual(provider.resolve_local_path(stored.provider_key), stored.local_path)
            self.assertEqual(stored.local_path.read_bytes(), b"kindred-photo")

    def test_rejects_paths_outside_storage_root(self):
        with tempfile.TemporaryDirectory() as directory:
            provider = LocalStorageProvider(Path(directory) / "library")
            self.assertIsNone(provider.resolve_local_path("../../etc/passwd"))
            self.assertIsNone(provider.resolve_local_path("/etc/passwd"))

    def test_delete_only_removes_the_requested_local_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "photo.jpg"
            source.write_bytes(b"photo")
            provider = LocalStorageProvider(root / "library")
            stored = provider.store_file(str(uuid.uuid4()), source, source.name)

            provider.delete(stored.provider_key)

            self.assertIsNone(provider.resolve_local_path(stored.provider_key))
            self.assertTrue(source.exists())


if __name__ == "__main__":
    unittest.main()
