from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException

from flickr_album_import import import_albums


class FlickrAlbumImportTests(IsolatedAsyncioTestCase):
    async def test_reads_every_page_and_keeps_the_primary_photo_id(self):
        flickr = AsyncMock(side_effect=[
            {"photosets": {"pages": "2", "photoset": [
                {"id": "a", "title": {"_content": "First"}, "primary": 12},
            ]}},
            {"photosets": {"pages": 2, "photoset": [{"id": "b", "title": "Second"}]}},
            {"photoset": {"pages": 2, "photo": [{"id": "11"}, {"id": "12"}]}},
            {"photoset": {"pages": 2, "photo": [{"id": "12"}, {"id": "13"}]}},
            {"photoset": {"pages": 1, "photo": []}},
        ])
        query = Mock(side_effect=[
            [{"matched": 2, "saved": 1, "primary_matched": True}],
            [{"matched": 0, "saved": 0, "primary_matched": False}],
        ])
        adopt = Mock(side_effect=[{"id": "kindred-a"}, {"id": "kindred-b"}])
        creds = {"user_id": "household", "verified": True}

        result = await import_albums(flickr, query, adopt, creds)

        self.assertEqual(result, {"albums": 2, "matched_items": 2, "unmatched_items": 1, "primary_covers": 1})
        self.assertEqual([call.args[0]["page"] for call in flickr.await_args_list], [1, 2, 1, 2, 1])
        self.assertTrue(all(call.args[0]["user_id"] == "household" for call in flickr.await_args_list))
        self.assertEqual([call.args for call in adopt.call_args_list], [("a", "First"), ("b", "Second")])
        self.assertEqual(query.call_args_list[0].args[1],
                         (["11", "12", "13"], "household", "kindred-a", "12", "kindred-a", "12"))

    async def test_does_not_write_an_album_after_an_incomplete_membership_read(self):
        flickr = AsyncMock(side_effect=[
            {"photosets": {"photoset": [{"id": "a"}]}},
            {"photoset": {"pages": 2, "photo": [{"id": "11"}]}},
            {},
        ])
        query, adopt = Mock(), Mock()
        with self.assertRaises(HTTPException) as error:
            await import_albums(flickr, query, adopt, {"user_id": "household", "verified": True})
        self.assertEqual(error.exception.status_code, 502)
        query.assert_not_called()
        adopt.assert_not_called()

    async def test_an_unverified_account_cannot_import(self):
        flickr, query, adopt = AsyncMock(), Mock(), Mock()
        with self.assertRaises(HTTPException) as error:
            await import_albums(flickr, query, adopt, {"user_id": "household", "verified": False})
        self.assertEqual(error.exception.status_code, 409)
        flickr.assert_not_awaited()
        query.assert_not_called()
        adopt.assert_not_called()
