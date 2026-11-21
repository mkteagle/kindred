import io
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock

from PIL import Image

from publish_r2_thumbnails import pending_files, publish_one
from r2_thumbnails import key_for


class ThumbnailPublicationTests(unittest.TestCase):
    def test_keys_are_canonical_and_only_accept_catalog_identities(self):
        self.assertEqual(key_for("123"), "thumbnails/v1/123.jpg")
        self.assertEqual(key_for("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"),
                         "thumbnails/v1/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg")
        for invalid in ("../123", "photo.jpg", "١٢٣", None):
            self.assertIsNone(key_for(invalid))

    def test_poster_takes_precedence_and_checkpoint_detects_changes(self):
        with tempfile.TemporaryDirectory() as directory, sqlite3.connect(":memory:") as checkpoint:
            root = Path(directory)
            checkpoint.execute("CREATE TABLE published (key TEXT PRIMARY KEY, version TEXT NOT NULL)")
            (root / "123.jpg").write_bytes(b"thumbnail")
            poster = root / "123-poster.jpg"
            poster.write_bytes(b"poster")
            (root / "456.jpg").symlink_to(poster)
            [(path, key, version)] = list(pending_files(root, checkpoint))
            self.assertEqual(path, poster)
            checkpoint.execute("INSERT INTO published VALUES (?, ?)", (key, version))
            self.assertEqual(list(pending_files(root, checkpoint)), [])
            poster.write_bytes(b"updated poster")
            self.assertEqual([item[0] for item in pending_files(root, checkpoint)], [poster])

    def test_jpeg_with_embedded_metadata_is_sanitized_before_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "123.jpg"
            image = Image.new("RGB", (30, 20))
            exif = Image.Exif()
            exif[270] = "Private metadata"
            image.save(path, exif=exif)
            client = Mock()
            publish_one(client, "private", (path, key_for("123"), "version"))
            args = client.put_object.call_args.kwargs
            self.assertEqual(args["ContentType"], "image/jpeg")
            with Image.open(io.BytesIO(args["Body"])) as uploaded:
                self.assertFalse(uploaded.getexif())
