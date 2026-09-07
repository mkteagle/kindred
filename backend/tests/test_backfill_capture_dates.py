"""The backfill's planning and its SQL, run against a real SQLite catalog.

The two things that must not go wrong are that a date already recorded is never
overwritten, and that one unreadable file does not end the run. Both are
exercised here against real statements and real files rather than mocks.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import uuid

from backfill_capture_dates import (
    PENDING_SQL, UPDATE_SQL, describe, examine, plan, sidecar_index,
    update_parameters,
)
from capture_date import Capture
from collections import Counter
from storage.local import LocalStorageProvider

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:  # pragma: no cover - the container always has Pillow
    HAS_PILLOW = False


def utc(*parts):
    return datetime(*parts, tzinfo=timezone.utc)


def sqlite_sql(sql: str) -> str:
    """SQLite runs the same relational statement; only the casts differ."""
    return (sql.replace("p.id::text", "p.id")
               .replace("%s::uuid", "?")
               .replace("count(*) FILTER", "count(*) FILTER")
               .replace("now()", "'2026-09-07'")
               .replace("%s", "?"))


class PlanTests(unittest.TestCase):
    def row(self, **overrides):
        base = dict(photo_id="p1", taken_at=None, latitude=None, longitude=None)
        base.update(overrides)
        return base

    def test_proposes_a_date_and_a_location_for_an_empty_row(self):
        write = plan(self.row(), Capture(taken_at=utc(2019, 4, 12),
                                         taken_at_source="exif:DateTimeOriginal",
                                         latitude=40.1, longitude=-111.7,
                                         location_source="exif"))
        self.assertEqual(write["taken_at"], utc(2019, 4, 12))
        self.assertAlmostEqual(write["latitude"], 40.1)

    def test_never_proposes_a_date_for_a_row_that_already_has_one(self):
        write = plan(self.row(taken_at=utc(2001, 1, 1)),
                     Capture(taken_at=utc(2019, 4, 12), taken_at_source="filename",
                             latitude=40.1, longitude=-111.7, location_source="exif"))
        self.assertIsNone(write["taken_at"])
        self.assertAlmostEqual(write["latitude"], 40.1)

    def test_a_row_with_nothing_missing_needs_no_write_at_all(self):
        self.assertIsNone(plan(
            self.row(taken_at=utc(2001, 1, 1), latitude=1.0, longitude=2.0),
            Capture(taken_at=utc(2019, 4, 12), latitude=40.1, longitude=-111.7)))

    def test_a_file_with_nothing_to_say_needs_no_write(self):
        self.assertIsNone(plan(self.row(), Capture()))

    def test_half_a_coordinate_pair_is_never_written(self):
        self.assertIsNone(plan(self.row(), Capture(latitude=40.1)))


class UpdateStatementTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE photos (id TEXT PRIMARY KEY, original_filename TEXT,
                media_type TEXT, taken_at TEXT, latitude REAL, longitude REAL,
                updated_at TEXT);
            CREATE TABLE photo_copies (photo_id TEXT, provider TEXT, status TEXT,
                provider_key TEXT);
            INSERT INTO photos VALUES
                ('a','a.jpg','image/jpeg',NULL,NULL,NULL,'2024'),
                ('b','b.jpg','image/jpeg','2001-01-01T00:00:00+00:00',NULL,NULL,'2024'),
                ('c','c.jpg','image/jpeg','2002-01-01T00:00:00+00:00',1.0,2.0,'2024');
            INSERT INTO photo_copies VALUES
                ('a','nas','available','aa/a/original.jpg'),
                ('b','nas','available','bb/b/original.jpg'),
                ('c','nas','available','cc/c/original.jpg');
        """)
        self.addCleanup(self.db.close)

    def apply(self, write):
        self.db.execute(sqlite_sql(UPDATE_SQL), update_parameters(write))

    def taken_at(self, photo_id):
        return self.db.execute("SELECT taken_at FROM photos WHERE id=?",
                               (photo_id,)).fetchone()["taken_at"]

    def test_fills_a_null_date(self):
        self.apply(dict(photo_id="a", taken_at="2019-04-12T14:30:00+00:00",
                        latitude=None, longitude=None))
        self.assertEqual(self.taken_at("a"), "2019-04-12T14:30:00+00:00")

    def test_a_date_already_set_is_never_overwritten(self):
        # The guard has to hold even when a caller proposes a date anyway —
        # the statement itself is what makes a re-run safe.
        self.apply(dict(photo_id="b", taken_at="2019-04-12T14:30:00+00:00",
                        latitude=40.1, longitude=-111.7))
        self.assertEqual(self.taken_at("b"), "2001-01-01T00:00:00+00:00")
        row = self.db.execute("SELECT * FROM photos WHERE id='b'").fetchone()
        self.assertAlmostEqual(row["latitude"], 40.1)

    def test_a_complete_row_is_left_entirely_alone(self):
        self.apply(dict(photo_id="c", taken_at="2019-04-12T14:30:00+00:00",
                        latitude=40.1, longitude=-111.7))
        row = self.db.execute("SELECT * FROM photos WHERE id='c'").fetchone()
        self.assertEqual(row["taken_at"], "2002-01-01T00:00:00+00:00")
        self.assertAlmostEqual(row["latitude"], 1.0)
        self.assertEqual(row["updated_at"], "2024")

    def test_running_the_same_write_twice_changes_nothing_the_second_time(self):
        write = dict(photo_id="a", taken_at="2019-04-12T14:30:00+00:00",
                     latitude=None, longitude=None)
        self.apply(write)
        self.apply(dict(write, taken_at="1999-01-01T00:00:00+00:00"))
        self.assertEqual(self.taken_at("a"), "2019-04-12T14:30:00+00:00")

    def test_pending_selects_only_incomplete_rows_with_a_nas_original(self):
        rows = self.db.execute(sqlite_sql(PENDING_SQL), ("", 10)).fetchall()
        self.assertEqual([row["photo_id"] for row in rows], ["a", "b"])

    def test_pending_pages_forward_by_id(self):
        rows = self.db.execute(sqlite_sql(PENDING_SQL), ("a", 10)).fetchall()
        self.assertEqual([row["photo_id"] for row in rows], ["b"])

    def test_a_row_with_no_nas_original_is_not_offered(self):
        self.db.execute("INSERT INTO photos VALUES "
                        "('d','d.jpg','image/jpeg',NULL,NULL,NULL,'2024')")
        rows = self.db.execute(sqlite_sql(PENDING_SQL), ("", 10)).fetchall()
        self.assertNotIn("d", [row["photo_id"] for row in rows])


class SidecarIndexTests(unittest.TestCase):
    def test_maps_photo_ids_to_the_sidecars_beside_their_import_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "Album").mkdir()
            (root / "Album" / "IMG_1234.jpg").write_bytes(b"photo")
            (root / "Album" / "IMG_1234.jpg.json").write_text("{}")
            (root / "Album" / "IMG_5678.jpg").write_bytes(b"photo")
            index = sidecar_index({"completed": {
                "Album/IMG_1234.jpg": {"kindred_photo_id": "p1"},
                "Album/IMG_5678.jpg": {"kindred_photo_id": "p2"},
                "Album/gone.jpg": {"kindred_photo_id": "p3"},
                "Album/no_receipt.jpg": {},
            }}, root)
            self.assertEqual(set(index), {"p1"})
            self.assertEqual(index["p1"].name, "IMG_1234.jpg.json")

    def test_an_empty_checkpoint_yields_an_empty_index(self):
        self.assertEqual(sidecar_index({}, Path("/nowhere")), {})


@unittest.skipUnless(HAS_PILLOW, "Pillow is required to write EXIF fixtures")
class ExamineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        self.provider = LocalStorageProvider(self.root / "library")

    def store(self, name, image=None):
        """Put a file into the managed NAS layout the way an import would."""
        source = self.root / name
        if image is None:
            image = Image.new("RGB", (4, 4))
        if isinstance(image, bytes):
            source.write_bytes(image)
        else:
            image.save(source)
        return self.provider.store_file(str(uuid.uuid4()), source, name)

    def row(self, stored, name):
        return dict(photo_id="p1", original_filename=name, media_type="image/jpeg",
                    taken_at=None, latitude=None, longitude=None,
                    provider_key=stored.provider_key)

    def test_resolves_the_original_through_the_provider_key(self):
        image = Image.new("RGB", (4, 4))
        exif = image.getexif()
        exif.get_ifd(0x8769)[0x9003] = "2019:04:12 14:30:00"
        image.save(self.root / "IMG_0001.jpg", exif=exif)
        stored = self.provider.store_file(str(uuid.uuid4()),
                                          self.root / "IMG_0001.jpg", "IMG_0001.jpg")
        capture, note = examine(self.provider, self.row(stored, "IMG_0001.jpg"), None, True)
        self.assertIsNone(note)
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 14, 30))

    def test_a_sidecar_supplied_from_the_import_tree_is_consulted(self):
        stored = self.store("IMG_0002.jpg")
        sidecar = self.root / "IMG_0002.jpg.json"
        sidecar.write_text(json.dumps({"photoTakenTime": {"timestamp": "1555079400"}}))
        capture, _ = examine(self.provider, self.row(stored, "IMG_0002.jpg"), sidecar, True)
        self.assertEqual(capture.taken_at_source, "sidecar:photoTakenTime")

    def test_the_stored_original_name_never_hides_the_catalogued_one(self):
        # Managed originals are all called "original.jpg"; the date lives in
        # the name the file was imported under, which the catalog kept.
        stored = self.store("IMG_20190412_143000.jpg")
        capture, _ = examine(
            self.provider, self.row(stored, "IMG_20190412_143000.jpg"), None, True)
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 14, 30))

    def test_filename_dates_can_be_switched_off(self):
        stored = self.store("IMG_20190412_143000.jpg")
        capture, _ = examine(
            self.provider, self.row(stored, "IMG_20190412_143000.jpg"), None, False)
        self.assertIsNone(capture.taken_at)

    def test_a_missing_original_is_reported_rather_than_raised(self):
        row = dict(photo_id="p1", original_filename="a.jpg", media_type="image/jpeg",
                   taken_at=None, latitude=None, longitude=None,
                   provider_key="zz/deleted/original.jpg")
        capture, note = examine(self.provider, row, None, True)
        self.assertIsNone(capture)
        self.assertIn("NAS original missing", note)

    def test_a_corrupt_original_is_reported_rather_than_raised(self):
        stored = self.store("DSC00019.jpg", image=b"not an image")
        capture, note = examine(self.provider, self.row(stored, "DSC00019.jpg"), None, True)
        self.assertIsNone(note)
        self.assertIsNotNone(capture.error)
        self.assertIsNone(capture.taken_at)


class SummaryTests(unittest.TestCase):
    def test_reports_every_outcome_including_the_ones_that_found_nothing(self):
        report = describe(
            Counter(examined=10, dated=7, located=3, no_date=2, unreadable=1, missing=0),
            Counter({"exif:DateTimeOriginal": 5, "filename": 2}))
        self.assertIn("examined", report)
        self.assertIn("unreadable", report)
        self.assertIn("exif:DateTimeOriginal", report)


if __name__ == "__main__":
    unittest.main()
