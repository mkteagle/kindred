from __future__ import annotations
import ast
import asyncio
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace
import httpx
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.testclient import TestClient
from PIL import Image
import image_transforms as images
from storage.local import LocalStorageProvider

class TransformTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'original.jpg'
        Image.new('RGB', (4000, 3000), 'red').save(self.source)
        self.cache = images.TransformCache(str(self.root / 'cache.sqlite3'))
        self.patch = patch.object(images, 'CACHE', self.cache)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_width_quality_format_limits(self):
        for kwargs in [dict(width=99999), dict(width=-1), dict(width=401), dict(quality=1), dict(format='svg'), dict(size='oops')]:
            with self.assertRaises(ValueError): images.parameters(**kwargs)
        self.assertEqual(images.parameters(320, accept='image/webp'), (320, 80, 'webp'))
        self.assertEqual(images.parameters(320, accept='image/webp;q=0'), (320, 80, 'jpeg'))

    def test_resize_preserves_source_and_reuses_cache(self):
        before = self.source.read_bytes()
        key, data = images.local_transform(self.source, 480, 80, 'webp')
        with Image.open(BytesIO(data)) as result:
            self.assertEqual(result.size, (480, 360))
            self.assertEqual(result.format, 'WEBP')
        with patch.object(images, 'encode', side_effect=AssertionError('cache miss')):
            self.assertEqual(images.local_transform(self.source, 480, 80, 'webp'), (key, data))
        self.assertEqual(self.source.read_bytes(), before)
        self.assertLess(len(data), len(before))

    def test_replacement_changes_key(self):
        first, _ = images.local_transform(self.source, 320, 80, 'jpeg')
        Image.new('RGB', (2000, 1000), 'blue').save(self.source)
        second, data = images.local_transform(self.source, 320, 80, 'jpeg')
        self.assertNotEqual(first, second)
        self.assertEqual(Image.open(BytesIO(data)).size, (320, 160))

    def test_keys_vary_by_all_transform_parameters(self):
        self.assertEqual(len({images.cache_key(*args) for args in [
            ('a', 320, 80, 'jpeg'), ('b', 320, 80, 'jpeg'), ('a', 480, 80, 'jpeg'),
            ('a', 320, 90, 'jpeg'), ('a', 320, 80, 'webp')]}), 5)

    def test_cache_evicts_and_expires(self):
        cache = images.TransformCache(str(self.root / 'small.sqlite3'), budget=12, ttl=10)
        cache.put('a', b'12345678'); cache.put('b', b'12345678')
        self.assertIsNone(cache.get('a'))
        self.assertEqual(cache.get('b'), b'12345678')
        with patch('image_transforms.time.time', return_value=10**12): self.assertIsNone(cache.get('b'))

    def test_duplicate_misses_decode_once(self):
        with patch.object(images, 'encode', wraps=images.encode) as encode:
            with ThreadPoolExecutor(max_workers=5) as pool:
                results = list(pool.map(lambda _: images.local_transform(self.source, 320, 80, 'jpeg'), range(5)))
            self.assertEqual(encode.call_count, 1)
            self.assertTrue(all(result == results[0] for result in results))

    def test_orientation_and_tall_image_bound(self):
        oriented = self.root / 'oriented.jpg'
        exif = Image.Exif(); exif[274] = 6
        Image.new('RGB', (600, 300)).save(oriented, exif=exif)
        self.assertEqual(Image.open(BytesIO(images.encode(oriented, 160, 80, 'jpeg'))).size, (160, 320))
        tall = self.root / 'tall.png'; Image.new('RGB', (100, 4000)).save(tall)
        self.assertEqual(Image.open(BytesIO(images.encode(tall, 320, 80, 'jpeg'))).height, 2560)

    def test_decode_limit(self):
        with patch.object(images, 'MAX_PIXELS', 100):
            with self.assertRaises(ValueError): images.encode(self.source, 320, 80, 'jpeg')

    def client(self, overrides=None):
        # Test actual endpoints without importing the unrelated ML pipeline.
        tree = ast.parse((Path(__file__).parents[1] / 'main.py').read_text())
        functions = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in ('get_local_photo', 'proxy_photo_image')]
        for function in functions: function.decorator_list = []
        def user(request: Request):
            if request.headers.get('x-session-token') != 'valid': raise HTTPException(401)
            return {'role': 'member'}
        namespace = dict(Depends=Depends, get_current_user=user, HTTPException=HTTPException,
            FastAPIRequest=Request, Path=Path, PHOTO_STORAGE_ROOT=str(self.root), LocalStorageProvider=LocalStorageProvider,
            db_query=lambda *args: [{'provider_key': 'original.jpg', 'original_filename': 'original.jpg', 'media_type': 'image/jpeg'}],
            FileResponse=FileResponse, Response=Response, asyncio=asyncio,
            _catalog_photo=lambda _: {'id': 'photo', 'nas_key': 'original.jpg'})
        namespace.update(overrides or {})
        exec(compile(ast.Module(body=functions, type_ignores=[]), '<image-routes>', 'exec'), namespace)
        app = FastAPI(); app.get('/photos/{photo_id}/image')(namespace['proxy_photo_image'])
        return TestClient(app)

    def test_http_auth_negotiation_revalidation_and_original(self):
        with self.client() as client:
            url = '/photos/photo/image?w=320&q=80&format=auto'
            headers = {'x-session-token': 'valid', 'accept': 'image/webp'}
            first = client.get(url, headers=headers)
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.headers['content-type'], 'image/webp')
            self.assertEqual(Image.open(BytesIO(first.content)).size, (320, 240))
            self.assertIn('private', first.headers['cache-control']); self.assertIn('Accept', first.headers['vary'])
            self.assertEqual(client.get(url, headers={**headers, 'if-none-match': first.headers['etag']}).status_code, 304)
            self.assertEqual(client.get(url).status_code, 401)
            self.assertEqual(client.get('/photos/photo/image?size=o', headers=headers).content, self.source.read_bytes())
            self.assertEqual(client.get('/photos/photo/image?w=90000', headers=headers).status_code, 400)

    def test_unknown_photo_is_not_an_open_flickr_proxy(self):
        with self.client({'_catalog_photo': lambda _: None, 'db_query': lambda *a: []}) as client:
            self.assertEqual(client.get('/photos/unknown/image?w=320', headers={'x-session-token': 'valid'}).status_code, 404)

    def test_flickr_preview_never_selects_original_and_is_cached(self):
        fetched = []
        def respond(request):
            fetched.append(str(request.url))
            return httpx.Response(200, content=self.source.read_bytes(), headers={'content-type': 'image/jpeg'})
        transport = httpx.MockTransport(respond)
        sizes = {'stat': 'ok', 'sizes': {'size': [
            {'label': 'Small', 'width': 240, 'source': 'https://live.staticflickr.com/1/small.jpg'},
            {'label': 'Original', 'width': 4000, 'source': 'https://live.staticflickr.com/1/original.jpg'}]}}
        overrides = {'_catalog_photo': lambda _: {'flickr_id': 'known'}, 'FLICKR_API_KEY': 'fixture',
            'get_flickr_credentials': lambda: {}, 'flickr_api': AsyncMock(return_value=sizes),
            'httpx': SimpleNamespace(AsyncClient=lambda **kwargs: httpx.AsyncClient(transport=transport, **kwargs))}
        overrides['get_flickr_credentials'] = lambda: {'token': 'fixture'}
        with self.client(overrides) as client:
            headers = {'x-session-token': 'valid'}
            for _ in range(2):
                result = client.get('/photos/known/image?w=640&format=webp', headers=headers)
                self.assertEqual(result.status_code, 200)
                self.assertLessEqual(Image.open(BytesIO(result.content)).width, 640)
            self.assertEqual(fetched, ['https://live.staticflickr.com/1/small.jpg'])
            sizes['sizes']['size'] = sizes['sizes']['size'][1:]
            self.assertEqual(client.get('/photos/known/image?w=640', headers=headers).status_code, 404)
            self.assertEqual(len(fetched), 1)

    def test_flickr_rejects_external_source(self):
        overrides = {'_catalog_photo': lambda _: {'flickr_id': 'known'}, 'FLICKR_API_KEY': 'fixture',
            'get_flickr_credentials': lambda: {'token': 'fixture'},
            'flickr_api': AsyncMock(return_value={'stat': 'ok', 'sizes': {'size': [
                {'label': 'Small', 'width': 320, 'source': 'https://example.com/image.jpg'}]}})}
        with self.client(overrides) as client:
            self.assertEqual(client.get('/photos/known/image?w=320', headers={'x-session-token': 'valid'}).status_code, 502)

if __name__ == '__main__': unittest.main()
