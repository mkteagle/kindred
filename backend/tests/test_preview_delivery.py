import tempfile
import unittest
from pathlib import Path
from preview_delivery import cached_thumbnail

PHOTO = 'bfedefa9-30da-49c4-b008-b7df8e8e7a1b'


class PreviewDeliveryTests(unittest.TestCase):
    def test_cached_preview_does_not_require_an_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected = root / f'{PHOTO}.jpg'
            expected.write_bytes(b'cached image')
            self.assertEqual(cached_thumbnail([PHOTO], root), expected)
            self.assertFalse((root / 'originals').exists())

    def test_poster_and_legacy_identity_are_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected = root / '555123-poster.jpg'
            expected.write_bytes(b'cached poster')
            self.assertEqual(cached_thumbnail([PHOTO, '555123'], root), expected)

    def test_path_traversal_and_symlinks_cannot_escape_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'previews'
            root.mkdir()
            secret = Path(directory) / 'private.jpg'
            secret.write_bytes(b'private')
            (root / f'{PHOTO}.jpg').symlink_to(secret)
            for identity in ['../private', '/private', PHOTO]:
                self.assertIsNone(cached_thumbnail([identity], root))
