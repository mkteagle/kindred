from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, UnidentifiedImageError

import prepare_nas_previews
import preview_recovery


class PreviewRecoveryTests(unittest.TestCase):
    def test_oversized_image_gets_a_smaller_cached_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "large.jpg"
            Image.new("RGB", (1800, 1200), "blue").save(source)
            original = source.read_bytes()

            def shrink(file, destination):
                self.assertEqual(file.read(3), b"\xff\xd8\xff")
                Image.new("RGB", (480, 320), "blue").save(destination)
                return True

            with patch("prepare_nas_previews.preview_delivery.THUMBNAIL_ROOT", root / "previews"), \
                    patch("prepare_nas_previews.image_transforms.MAX_PIXELS", 1_000_000), \
                    patch("preview_recovery._shrink_image", side_effect=shrink) as recovery:
                preview, media_type = prepare_nas_previews.build_preview(source, "large", "image/jpeg")
            recovery.assert_called_once()
            self.assertEqual(media_type, "image/jpeg")
            self.assertEqual(source.read_bytes(), original)
            with Image.open(preview) as image:
                self.assertEqual(image.size, (480, 320))
            self.assertEqual(list(preview.parent.iterdir()), [preview])

    def test_quicktime_container_is_recognized_when_named_as_jpeg(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "movie.jpg"
            original = b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00"
            source.write_bytes(original)

            def render_frame(path, destination):
                self.assertEqual(path, source)
                Image.new("RGB", (480, 270), "red").save(destination)
                return True

            with patch("prepare_nas_previews.preview_delivery.THUMBNAIL_ROOT", root / "previews"), \
                    patch("preview_recovery.recover_video", side_effect=render_frame) as video:
                preview, media_type = prepare_nas_previews.build_preview(source, "movie", "image/jpeg")
            video.assert_called_once()
            self.assertEqual(media_type, "video/quicktime")
            self.assertTrue(preview.is_file())
            self.assertEqual(source.read_bytes(), original)

    def test_unrecognized_data_leaves_the_original_error_and_no_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "sidecar.jpg"
            source.write_bytes(b"\x00\x05\x16\x07AppleDouble metadata")
            with patch("prepare_nas_previews.preview_delivery.THUMBNAIL_ROOT", root / "previews"), \
                    patch("preview_recovery._run") as decoder:
                with self.assertRaises(UnidentifiedImageError):
                    prepare_nas_previews.build_preview(source, "sidecar", "image/jpeg")
            decoder.assert_not_called()
            self.assertEqual(list((root / "previews").iterdir()), [])
