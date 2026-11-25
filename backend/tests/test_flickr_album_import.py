from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException

from flickr_album_import import import_albums, show_in_album_list


class FlickrAlbumImportTests(IsolatedAsyncioTestCase):
    async def test_reads_every_page_and_keeps_the_primary_photo_id(self):
        flickr = AsyncMock(side_effect=[
            {"photosets": {"pages": "2", "photoset": [
                {"id": "a", "title": {"_content": "First"}, "primary": 12, "photos": 3},
            ]}},
            {"photosets": {"pages": 2, "photoset": [{"id": "b", "title": "Second", "photos": 1}]}},
            {"photoset": {"pages": 2, "photo": [{"id": "11"}, {"id": "12"}]}},
            {"photoset": {"pages": 2, "photo": [{"id": "12"}, {"id": "13"}]}},
        ])
        query = Mock(side_effect=[
            [],
            [{"total": 2}],
            [{"matched": 2, "saved": 1, "primary_matched": True}],
        ])
        adopt = Mock(return_value={"id": "kindred-a"})
        creds = {"user_id": "household", "verified": True}

        result = await import_albums(flickr, query, adopt, creds)

        self.assertEqual(result, {"albums": 1, "matched_items": 2, "unmatched_items": 1,
                                  "primary_covers": 1, "skipped_small_albums": 1})
        self.assertEqual([call.args[0]["page"] for call in flickr.await_args_list], [1, 2, 1, 2])
        self.assertTrue(all(call.args[0]["user_id"] == "household" for call in flickr.await_args_list))
        adopt.assert_called_once_with("a", "First")
        self.assertEqual(query.call_args_list[-1].args[1],
                         (["11", "12", "13"], "household", "kindred-a", "12", "kindred-a", "12"))

    async def test_remote_album_with_only_one_local_match_does_not_create_a_row(self):
        flickr = AsyncMock(side_effect=[
            {"photosets": {"photoset": [{"id": "a", "photos": 1, "videos": 1}]}},
            {"photoset": {"photo": [{"id": "11"}, {"id": "12"}]}},
        ])
        query = Mock(side_effect=[[], [{"total": 1}]])
        adopt = Mock()
        result = await import_albums(flickr, query, adopt, {"user_id": "household", "verified": True})
        self.assertEqual((result["albums"], result["skipped_small_albums"]), (0, 1))
        adopt.assert_not_called()

    async def test_existing_user_album_keeps_manual_single_item_sync(self):
        flickr = AsyncMock(side_effect=[
            {"photosets": {"photoset": [{"id": "a", "photos": 1}]}},
            {"photoset": {"photo": [{"id": "11"}]}},
        ])
        query = Mock(side_effect=[
            [{"id": "user-album", "flickr_photoset_id": "a"}],
            [{"matched": 1, "saved": 1, "primary_matched": False}],
        ])
        adopt = Mock()
        result = await import_albums(flickr, query, adopt, {"user_id": "household", "verified": True})
        self.assertEqual((result["albums"], result["skipped_small_albums"]), (1, 0))
        adopt.assert_not_called()

    def test_album_list_keeps_single_items_only_for_user_owned_or_local_albums(self):
        imported = {"created_by": None, "flickr_photoset_id": "remote", "photo_count": 1}
        self.assertFalse(show_in_album_list(imported))
        self.assertTrue(show_in_album_list({**imported, "photo_count": 2}))
        self.assertTrue(show_in_album_list({**imported, "created_by": "user"}))
        self.assertTrue(show_in_album_list({**imported, "flickr_photoset_id": None}))

    async def test_does_not_write_an_album_after_an_incomplete_membership_read(self):
        flickr = AsyncMock(side_effect=[
            {"photosets": {"photoset": [{"id": "a", "photos": 2}]}},
            {"photoset": {"pages": 2, "photo": [{"id": "11"}]}},
            {},
        ])
        query, adopt = Mock(return_value=[]), Mock()
        with self.assertRaises(HTTPException) as error:
            await import_albums(flickr, query, adopt, {"user_id": "household", "verified": True})
        self.assertEqual(error.exception.status_code, 502)
        query.assert_called_once()
        self.assertIn("SELECT", query.call_args.args[0])
        adopt.assert_not_called()

    async def test_an_unverified_account_cannot_import(self):
        flickr, query, adopt = AsyncMock(), Mock(), Mock()
        with self.assertRaises(HTTPException) as error:
            await import_albums(flickr, query, adopt, {"user_id": "household", "verified": False})
        self.assertEqual(error.exception.status_code, 409)
        flickr.assert_not_awaited()
        query.assert_not_called()
        adopt.assert_not_called()
