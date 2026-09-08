"""The import runs for days, so its order decides what the library holds meanwhile.

This library was curated by hand into four thousand dated album folders long
before it reached Google, so the folder name states when something happened --
enough to import chronologically without opening a file. Walking alphabetically
put "2003 Lagoon" next to "Weekend in Lehi", which is no order at all.
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from staged_import import album_sort_key, iter_media


class SortKeyTests(unittest.TestCase):
    def order(self, names):
        return sorted(names, key=album_sort_key)

    def test_years_come_in_order(self):
        self.assertEqual(
            self.order(["2010 Later", "2003 Earlier", "2007 Middle"]),
            ["2003 Earlier", "2007 Middle", "2010 Later"])

    def test_a_full_date_is_read(self):
        self.assertEqual(album_sort_key("2004.03.20 Allison Junior Prom")[:4], (0, 2004, 3, 20))

    def test_a_year_and_month_is_read(self):
        self.assertEqual(album_sort_key("2010.12 Christmas")[:4], (0, 2010, 12, 1))

    def test_a_bare_year_is_accepted_for_ordering(self):
        # capture_date refuses this, because dating every photo in it to 1
        # January would be false precision. Ordering only needs the year.
        self.assertEqual(album_sort_key("2003 CEU Pics")[:4], (0, 2003, 1, 1))

    def test_a_month_first_range_is_read_from_its_start(self):
        # "12.2009-3.2010" begins in December 2009. An unanchored search finds
        # "2009-3" inside it and would call it March -- the wrong end.
        self.assertEqual(album_sort_key("12.2009-3.2010 Love Notes")[:4], (0, 2009, 12, 1))

    def test_a_year_range_sorts_from_its_first_year(self):
        self.assertEqual(album_sort_key("2003 - 2004 CEU Basketball Games")[:4], (0, 2003, 1, 1))

    def test_undated_folders_sort_after_every_dated_one(self):
        ordered = self.order(["Weekend in Lehi", "2019 Trip", "Aardvark album"])
        self.assertEqual(ordered[0], "2019 Trip")
        self.assertEqual(ordered[1:], ["Aardvark album", "Weekend in Lehi"])

    def test_undated_folders_keep_a_stable_order_between_runs(self):
        names = ["Zebra", "aardvark", "Mango"]
        self.assertEqual(self.order(names), self.order(list(reversed(names))))

    def test_an_impossible_date_is_not_accepted(self):
        # "2004.13" is not a month; fall through rather than sort on nonsense.
        self.assertEqual(album_sort_key("2004.13 Whatever")[:2], (0, 2004))

    def test_a_number_that_is_not_a_year_is_ignored(self):
        self.assertEqual(album_sort_key("Camera 1234 dump")[0], 1)


class WalkOrderTests(unittest.TestCase):
    def test_media_arrives_oldest_album_first(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("2010 Later", "2003 Earlier", "Undated trip"):
                (root / name).mkdir()
                (root / name / "photo.jpg").write_bytes(b"x")
            albums = [path.parent.name for path in iter_media(root)]
            self.assertEqual(albums, ["2003 Earlier", "2010 Later", "Undated trip"])

    def test_loose_files_at_the_top_are_not_lost(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "loose.jpg").write_bytes(b"x")
            (root / "2003 Album").mkdir()
            (root / "2003 Album" / "inside.jpg").write_bytes(b"x")
            names = [path.name for path in iter_media(root)]
            self.assertEqual(names, ["loose.jpg", "inside.jpg"])

    def test_unsupported_files_are_skipped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "2003 Album").mkdir()
            (root / "2003 Album" / "photo.jpg").write_bytes(b"x")
            (root / "2003 Album" / "notes.txt").write_bytes(b"x")
            (root / "2003 Album" / "photo.jpg.supplemental-metadata.json").write_bytes(b"{}")
            self.assertEqual([p.name for p in iter_media(root)], ["photo.jpg"])

    def test_nested_folders_inside_an_album_are_still_walked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nested = root / "2003 Album" / "subfolder"
            nested.mkdir(parents=True)
            (nested / "deep.jpg").write_bytes(b"x")
            self.assertEqual([p.name for p in iter_media(root)], ["deep.jpg"])

    def test_a_missing_root_yields_nothing_rather_than_raising(self):
        self.assertEqual(list(iter_media(Path("/nonexistent-import-root"))), [])


if __name__ == "__main__":
    unittest.main()
