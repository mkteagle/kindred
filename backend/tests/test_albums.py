from pathlib import Path
import os
import tempfile
import unittest
import uuid

from albums import album_slug, unique_album_slug
from storage.local import LocalStorageProvider


class AlbumSlugTests(unittest.TestCase):
    def test_slugifies_display_names(self):
        self.assertEqual(album_slug("Summer 2026 — Maine Trip!"), "summer-2026-maine-trip")
        self.assertEqual(album_slug("  Kids'   Birthdays  "), "kids-birthdays")

    def test_falls_back_when_a_name_has_no_usable_characters(self):
        self.assertEqual(album_slug("!!!"), "album")
        self.assertEqual(album_slug(""), "album")

    def test_long_names_do_not_end_on_a_separator(self):
        slug = album_slug("a" * 79 + " bcd")
        self.assertLessEqual(len(slug), 80)
        self.assertFalse(slug.endswith("-"))

    def test_suffixes_only_when_the_slug_is_taken(self):
        self.assertEqual(unique_album_slug("Maine", set()), "maine")
        self.assertEqual(unique_album_slug("Maine", {"maine"}), "maine-2")
        self.assertEqual(unique_album_slug("Maine", {"maine", "maine-2"}), "maine-3")


class AlbumSymlinkTests(unittest.TestCase):
    def setUp(self):
        self._directory = tempfile.TemporaryDirectory()
        root = Path(self._directory.name)
        self.source = root / "beach.jpg"
        self.source.write_bytes(b"beach-photo")
        self.provider = LocalStorageProvider(root / "library")
        self.stored = self.provider.store_file(str(uuid.uuid4()), self.source, self.source.name)

    def tearDown(self):
        self._directory.cleanup()

    def test_links_the_original_without_copying_it(self):
        link_path = self.provider.link_into_album("maine", self.stored.provider_key, "beach.jpg")

        self.assertEqual(link_path, "albums/maine/beach.jpg")
        link = self.provider.root / link_path
        self.assertTrue(link.is_symlink())
        self.assertEqual(link.read_bytes(), b"beach-photo")
        # Relative, so the album tree survives the storage root being moved.
        self.assertFalse(Path(os.readlink(link)).is_absolute())
        self.assertEqual(link.resolve(), self.stored.local_path)

    def test_relinking_the_same_photo_is_idempotent(self):
        first = self.provider.link_into_album("maine", self.stored.provider_key, "beach.jpg")
        second = self.provider.link_into_album("maine", self.stored.provider_key, "beach.jpg")

        self.assertEqual(first, second)
        self.assertEqual(len(list((self.provider.root / "albums/maine").iterdir())), 1)

    def test_a_second_photo_with_the_same_name_gets_its_own_link(self):
        other_source = Path(self._directory.name) / "other.jpg"
        other_source.write_bytes(b"a different beach")
        other = self.provider.store_file(str(uuid.uuid4()), other_source, "beach.jpg")

        first = self.provider.link_into_album("maine", self.stored.provider_key, "beach.jpg")
        second = self.provider.link_into_album("maine", other.provider_key, "beach.jpg")

        self.assertEqual(first, "albums/maine/beach.jpg")
        self.assertEqual(second, "albums/maine/beach (2).jpg")
        self.assertEqual((self.provider.root / second).read_bytes(), b"a different beach")

    def test_one_photo_can_belong_to_several_albums(self):
        self.provider.link_into_album("maine", self.stored.provider_key, "beach.jpg")
        self.provider.link_into_album("summer", self.stored.provider_key, "beach.jpg")

        self.assertEqual(
            (self.provider.root / "albums/maine/beach.jpg").resolve(),
            (self.provider.root / "albums/summer/beach.jpg").resolve(),
        )

    def test_missing_originals_do_not_create_a_dangling_link(self):
        self.assertIsNone(self.provider.link_into_album("maine", "ff/nope/original.jpg", "x.jpg"))
        self.assertFalse((self.provider.root / "albums" / "maine").exists())

    def test_rejects_album_slugs_that_would_escape_the_album_tree(self):
        for bad in ("../escape", "/abs", "Maine", "with space", ""):
            with self.assertRaises(ValueError):
                self.provider.album_dir(bad)

    def test_unlink_removes_the_link_but_keeps_the_original(self):
        link_path = self.provider.link_into_album("maine", self.stored.provider_key, "beach.jpg")

        self.provider.unlink_from_album(link_path)

        self.assertFalse((self.provider.root / link_path).exists())
        self.assertTrue(self.stored.local_path.exists())

    def test_unlink_refuses_paths_outside_the_album_tree(self):
        self.provider.unlink_from_album(self.stored.provider_key)
        self.provider.unlink_from_album("../../etc/passwd")

        self.assertTrue(self.stored.local_path.exists())


if __name__ == "__main__":
    unittest.main()
