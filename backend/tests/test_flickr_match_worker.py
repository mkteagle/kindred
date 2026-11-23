import hashlib
from pathlib import Path
import tempfile
import unittest

import httpx

from flickr_match_worker import download_digest, original_url, select_match
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
