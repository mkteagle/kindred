import json
from pathlib import Path
import tempfile
import unittest

from staged_import import quarantine_duplicate, read_metadata, scan_media, sidecar_for, import_lock, save_progress, load_progress


class StagedImportTests(unittest.TestCase):
    def test_scans_only_supported_media_in_stable_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "nested").mkdir()
            (root / "z.MOV").write_bytes(b"video")
            (root / "nested" / "a.JPG").write_bytes(b"photo")
            (root / "nested" / "a.JPG.json").write_text("{}")
            (root / "notes.txt").write_text("ignore")
            self.assertEqual(
                [path.relative_to(root).as_posix() for path in scan_media(root)],
                ["z.MOV", "nested/a.JPG"],
            )

    def test_second_worker_is_rejected_and_lock_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            with import_lock(path):
                with self.assertRaisesRegex(RuntimeError, "Another NAS import"):
                    with import_lock(path):
                        self.fail("second worker acquired lock")
            with import_lock(path):
                pass

    def test_failed_checkpoint_replace_preserves_previous_state(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            old = {"completed": {"one": {}}, "failed": {}}
            save_progress(path, old)
            with patch("staged_import.os.replace", side_effect=OSError("disk error")):
                with self.assertRaises(OSError):
                    save_progress(path, {"completed": {}, "failed": {}})
            self.assertEqual(load_progress(path), old)
            self.assertEqual(list(path.parent.glob("*.tmp")), [])

    def test_reads_takeout_sidecar_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            photo = root / "IMG_1234.jpg"
            photo.write_bytes(b"photo")
            sidecar = root / "IMG_1234.jpg.json"
            sidecar.write_text(json.dumps({
                "title": "Family day",
                "description": "At the park",
                "photoTakenTime": {"timestamp": "1700000000"},
                "geoData": {"latitude": 40.1, "longitude": -111.7},
            }))
            self.assertEqual(sidecar_for(photo), sidecar)
            metadata = read_metadata(photo)
            self.assertEqual(metadata["title"], "Family day")
            self.assertEqual(metadata["taken_at_unix"], 1700000000)
            self.assertEqual(metadata["latitude"], 40.1)
            self.assertEqual(metadata["longitude"], -111.7)

    def test_quarantines_duplicate_and_sidecar_preserving_structure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "source"
            quarantine = Path(directory) / "quarantine"
            album = root / "Album"
            album.mkdir(parents=True)
            photo = album / "IMG_1234.jpg"
            photo.write_bytes(b"same bytes")
            sidecar = album / "IMG_1234.jpg.json"
            sidecar.write_text("{}")

            destination = quarantine_duplicate(photo, root, quarantine)

            self.assertEqual(destination, quarantine / "Album" / "IMG_1234.jpg")
            self.assertTrue(destination.is_file())
            self.assertTrue((quarantine / "Album" / "IMG_1234.jpg.json").is_file())
            self.assertFalse(photo.exists())
            self.assertFalse(sidecar.exists())


if __name__ == "__main__":
    unittest.main()
