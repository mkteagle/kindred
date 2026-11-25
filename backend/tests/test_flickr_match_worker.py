import hashlib
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from contextlib import closing
from unittest.mock import AsyncMock, patch

import httpx

from flickr_match_worker import (
    OriginalDownloadPacer, OriginalRateLimited, download_digest, original_url, run_pass, select_match,
)
from storage.local import LocalStorageProvider


class FlickrOriginalMatchingTests(unittest.TestCase):
    def test_requires_byte_match_and_rejects_identical_catalog_duplicates(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)
            (path / 'a.jpg').write_bytes(b'original')
            (path / 'b.jpg').write_bytes(b'different'[:8])
            storage = LocalStorageProvider(path)
            rows = [dict(provider_key=key, sha256=None) for key in ('a.jpg', 'b.jpg')]
            digest = hashlib.sha256(b'original').hexdigest()
            self.assertEqual(select_match(storage, rows, 8, digest), ('matched', rows[0]))
            (path / 'b.jpg').write_bytes(b'original')
            self.assertEqual(select_match(storage, rows, 8, digest), ('ambiguous', None))

    def test_original_url_is_restricted_to_flickr_hosts(self):
        self.assertEqual(
            original_url('http://live.staticflickr.com/example_o.jpg'),
            'https://live.staticflickr.com/example_o.jpg',
        )
        self.assertIsNone(original_url('https://live.staticflickr.com.example.org/fake'))
        self.assertIsNone(original_url('https://other@www.flickr.com/photos/1'))
        self.assertIsNone(original_url('http://www.flickr.com:9000/photos/1'))


class OriginalStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_rate_limit_returns_control_without_retrying_the_download(self):
        request_count = 0

        def respond(_):
            nonlocal request_count
            request_count += 1
            return httpx.Response(429, headers={"Retry-After": "1200"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with self.assertRaises(OriginalRateLimited) as caught:
                await download_digest(client, 'https://live.staticflickr.com/1_o.jpg',
                                      lambda _: self.fail("429 should not query NAS candidates"), 50, 'image/')
        self.assertEqual(caught.exception.retry_after, "1200")
        self.assertEqual(request_count, 1)

    async def test_download_requests_are_bounded_in_rolling_batches(self):
        now = 0.0

        async def sleep(delay):
            nonlocal now
            now += delay

        with closing(sqlite3.connect(":memory:")) as checkpoint:
            checkpoint.execute("CREATE TABLE original_cooldown (owner TEXT PRIMARY KEY, retry_at, strikes)")
            pacer = OriginalDownloadPacer(checkpoint, "owner")
            with patch("flickr_match_worker.time.monotonic", side_effect=lambda: now), \
                    patch("flickr_match_worker.asyncio.sleep", new=AsyncMock(side_effect=sleep)):
                for _ in range(20):
                    await pacer.wait_between_requests()
                self.assertEqual(now, 38)
                self.assertEqual(pacer.batch_wait(), 82)
                await pacer.wait_between_requests()
                self.assertEqual(now, 120)

    async def test_cooldown_survives_restarts_and_honors_retry_after(self):
        with closing(sqlite3.connect(":memory:")) as checkpoint:
            checkpoint.execute("CREATE TABLE original_cooldown (owner TEXT PRIMARY KEY, retry_at, strikes)")
            with patch("flickr_match_worker.time.time", return_value=1000):
                pacer = OriginalDownloadPacer(checkpoint, "owner")
                pacer.rate_limited("1200")
                restarted = OriginalDownloadPacer(checkpoint, "owner")
                self.assertEqual(restarted.retry_at, 2200)
                restarted.received(False)
                self.assertEqual(restarted.retry_at, 2200)
                restarted.received(True)
                self.assertEqual(OriginalDownloadPacer(checkpoint, "owner").retry_at, 0)

    async def test_rejects_video_poster_and_non_flickr_redirect(self):
        requests = []

        def respond(request):
            requests.append(request.url.host)
            if request.url.path == '/redirect':
                return httpx.Response(302, headers={'location': 'https://other.example/video'})
            return httpx.Response(200, headers={'content-type': 'image/jpeg'}, stream=httpx.ByteStream(b'poster'))

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            for path in ('poster', 'redirect'):
                result = await download_digest(client, f'https://www.flickr.com/{path}', lambda _: [{}], 100, 'video/')
                self.assertEqual(result[0], 'original_unavailable')
        self.assertEqual(requests, ['www.flickr.com', 'www.flickr.com'])

    async def test_streams_supported_original_and_skips_impossible_sizes(self):
        original = b'original bytes'
        response = httpx.Response(200, headers={'content-type': 'image/jpeg',
                                                 'content-length': str(len(original))},
                                  stream=httpx.ByteStream(original))
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: response)) as client:
            result = await download_digest(client, 'https://live.staticflickr.com/1_o.jpg', lambda _: [{}], 50, 'image/')
        self.assertEqual(result, ('downloaded', len(original), hashlib.sha256(original).hexdigest(), [{}]))

        class ShouldNotRead(httpx.AsyncByteStream):
            async def __aiter__(self):
                raise AssertionError('Downloaded bytes with no NAS size candidate')
                yield b''

        response = httpx.Response(200, headers={'content-type': 'image/jpeg',
                                                'content-length': str(len(original))}, stream=ShouldNotRead())
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: response)) as client:
            result = await download_digest(client, 'https://live.staticflickr.com/1_o.jpg', lambda _: [], 50, 'image/')
        self.assertEqual(result[0], 'unmatched')

    async def test_existing_links_are_counted_during_an_active_download_cooldown(self):
        now = 1000
        reported = []

        async def sleep(delay):
            nonlocal now
            now += delay

        async def inventory(*_):
            yield 3, [{"id": str(index), "lastupdate": "v1"} for index in range(1, 4)]

        main = SimpleNamespace(
            FLICKR_USER_AGENT="fixture",
            get_flickr_credentials=lambda: {"user_id": "owner", "verified": True},
            flickr_api=AsyncMock(return_value={"user": {"id": "owner"}}),
            db_query=lambda *_: [{"provider_key":"1", "provider_owner_id":"owner", "status":"available"}],
            _flickr_pacer=SimpleNamespace(share=0),
        )
        state = {"phase": "reading_flickr"}
        with tempfile.TemporaryDirectory() as root, closing(sqlite3.connect(":memory:")) as checkpoint:
            checkpoint.execute("CREATE TABLE original_cooldown (owner TEXT PRIMARY KEY, retry_at, strikes)")
            checkpoint.execute("INSERT INTO original_cooldown VALUES ('owner', 1300, 1)")
            checkpoint.execute("""CREATE TABLE checked (owner, flickr_id, revision, result, checked_at,
                                   PRIMARY KEY(owner, flickr_id))""")
            checkpoint.execute("INSERT INTO checked VALUES ('owner', '2', 'v1', 'unmatched', 990)")
            args = SimpleNamespace(status=Path(root)/"status.json", limit=10, retry_days=7,
                                   albums_only=False, albums_first=True, watch=True,
                                   dry_run=False, max_bytes=100, item_delay=0)
            with patch.dict(sys.modules, {"main": main}), \
                    patch.dict(os.environ, {"PHOTO_STORAGE_ROOT": root, "PHOTO_LIBRARY_ROOT": root}), \
                    patch("flickr_match_worker.prioritized_pages", new=inventory), \
                    patch("flickr_match_worker.save_status", side_effect=lambda _, value: reported.append(value.copy())), \
                    patch("flickr_match_worker.throttle.read_pressure", return_value=None), \
                    patch("flickr_match_worker.time.time", side_effect=lambda: now), \
                    patch("flickr_match_worker.asyncio.sleep", new=AsyncMock(side_effect=sleep)), \
                    patch("flickr_match_worker.compare_item", new=AsyncMock(return_value="unmatched")) as compare:
                complete, counts = await run_pass(args, state, checkpoint, SimpleNamespace(wait_async=AsyncMock()))
        waiting = next(value for value in reported if value["phase"]=="waiting_for_flickr_downloads")
        self.assertEqual((waiting["completed"], waiting["matched"], waiting["remote_total"]), (2, 1, 3))
        compare.assert_awaited_once()
        self.assertEqual((complete, counts["unmatched"], state["completed"]), (True, 2, 3))
