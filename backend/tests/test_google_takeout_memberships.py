import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing
import hashlib

from google_takeout_memberships import evidence, is_favorite, retained_favorites, selected_favorites


class GoogleTakeoutMembershipTests(unittest.TestCase):
    def test_only_explicit_true_favorite_flags(self):
        self.assertTrue(is_favorite({"favorited": True}))
        self.assertTrue(is_favorite({"isFavorite": True}))
        self.assertFalse(is_favorite({"favorited": "true", "isFavorite": False}))
        self.assertFalse(is_favorite({"title": "Favorites"}))

    def test_reuses_receipts_when_the_source_file_has_been_removed(self):
        with tempfile.TemporaryDirectory() as directory, closing(sqlite3.connect(":memory:")) as ledger:
            root = Path(directory)
            archive, originals = root / "Google Photos", root / "Photos"
            trip, annual = archive / "Trip", archive / "Photos from 2024"
            trip.mkdir(parents=True)
            annual.mkdir()
            (trip / "metadata.json").write_text(json.dumps({"title": "Summer trip"}))
            (trip / "photo.jpg.supplemental-metadata.json").write_text(json.dumps({"favorited": True}))
            (annual / "metadata.json").write_text(json.dumps({"title": "Photos from 2024"}))
            (annual / "annual.jpg.json").write_text(json.dumps({"isFavorite": True}))
            ledger.execute("CREATE TABLE checked (path TEXT, canonical TEXT, sha256 TEXT, size INTEGER, status TEXT)")
            ledger.executemany("INSERT INTO checked VALUES (?, ?, ?, ?, ?)", [
                (str(trip / "photo.jpg"), str(originals / "img.jpg"), "a" * 64, 30, "removed_exact_duplicate"),
                (str(annual / "annual.jpg"), str(originals / "annual.jpg"), "b" * 64, 40, "verified_pending_unlink"),
                (str(trip / "skip.jpg"), str(originals / "skip.jpg"), "c" * 64, 50, "retained_error"),
            ])

            self.assertEqual(list(evidence(archive, ledger, originals)), [
                ("annual.jpg", "b" * 64, 40, "Photos from 2024", None, True),
                ("img.jpg", "a" * 64, 30, "Trip", "Summer trip", True),
            ])

    def test_favorite_with_retained_original_can_match_by_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory)
            (archive / "photo.jpg").write_bytes(b"original bytes")
            (archive / "photo.jpg.json").write_text(json.dumps({"title": "photo.jpg", "favorited": True}))
            (archive / "wrong.json").write_text(json.dumps({"title": "photo.jpg", "favorited": True}))
            (archive / "escape.json").write_text(json.dumps({"title": "../outside.jpg", "favorited": True}))
            digest = hashlib.sha256(b"original bytes").hexdigest()
            self.assertEqual(list(retained_favorites(archive)), [("", digest, 14, "", None, True)])

    def test_manual_favorites_export_matches_originals_without_speculative_sidecar_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selected = root / "Favorites for Kindred"
            selected.mkdir()
            (selected / "photo.jpg").write_bytes(b"photo")
            (selected / "metadata.json").write_text('{"title": "Favorites for Kindred"}')
            outside = root / "outside.jpg"
            outside.write_bytes(b"not selected")
            (selected / "outside.jpg").symlink_to(outside)
            digest = hashlib.sha256(b"photo").hexdigest()
            self.assertEqual(list(selected_favorites(selected)), [("", digest, 5, "", None, True)])
