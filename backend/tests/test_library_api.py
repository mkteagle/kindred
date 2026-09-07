import ast
import asyncio
from pathlib import Path
import sqlite3
import tempfile
import os
import uuid
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
from fastapi.responses import FileResponse
from library_api import counts, gallery


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE photos (id TEXT, legacy_photo_id TEXT, media_type TEXT,
                title TEXT, original_filename TEXT, taken_at TEXT, created_at TEXT);
            CREATE TABLE photo_copies (photo_id TEXT, provider TEXT, status TEXT,
                provider_key TEXT, remote_url TEXT);
            CREATE TABLE processed_photos (photo_id TEXT);
            INSERT INTO photos VALUES
                ('a',NULL,'image/heic','A','a.heic','2020','2024'),
                ('b',NULL,'image/jpeg','B','b.jpg','2021','2024'),
                ('c',NULL,'video/mp4','C','c.mp4','2022','2024'),
                ('d',NULL,'image/jpeg','D','d.jpg','2023','2024');
            INSERT INTO photo_copies VALUES
                ('a','nas','available','a/original.heic',NULL),
                ('b','nas','available','b/original.jpg',NULL),
                ('b','flickr','available','123','https://flickr.test/123'),
                ('c','nas','available','c/original.mp4',NULL);
            INSERT INTO processed_photos VALUES ('a'),('123'),('b');
        ''')

    def tearDown(self):
        self.db.close()

    def query(self, sql, params=()):
        # SQLite supports the relational query and FILTER; adapt parameter/cast syntax.
        sql = sql.replace('p.id::text', 'CAST(p.id AS TEXT)').replace('%s', '?')
        return [dict(row) for row in self.db.execute(sql, params)]

    def test_counts_do_not_double_count_mirrors_or_require_flickr_for_indexing(self):
        self.assertEqual(counts(self.query), dict(total_files=3, photos=2, videos=1,
            on_nas=3, on_flickr=1, indexed_photos=2, pending_index=0))

    def test_gallery_pages_and_sorts_all_photos_including_heic(self):
        first = gallery(self.query, 'newest', 0, 1)
        self.assertEqual(first['photos'][0]['photo_id'], 'b')
        self.assertEqual(first['next_offset'], 1)
        second = gallery(self.query, 'newest', 1, 1)
        self.assertEqual(second['photos'][0]['photo_id'], 'a')
        self.assertIsNone(second['next_offset'])
        self.assertEqual(gallery(self.query, 'oldest', 0, 48)['photos'][0]['photo_id'], 'a')

    def test_invalid_sort_is_rejected(self):
        with self.assertRaises(HTTPException):
            gallery(self.query, 'id; DROP TABLE photos', 0, 48)

    def test_gallery_parameterizes_like_pattern_for_psycopg(self):
        query = Mock(return_value=[])
        gallery(query, 'newest', 0, 48)
        sql, params = query.call_args.args
        self.assertNotIn("LIKE 'image/%'", sql)
        self.assertEqual(sql.count('%s'), len(params))
        self.assertEqual(params, ('image/%', 49, 0))


class ImageIdentityTests(unittest.TestCase):
    def test_heic_preview_is_jpeg_and_preserves_original(self):
        from PIL import Image
        from pillow_heif import from_pillow
        tree = ast.parse((Path(__file__).parents[1] / 'main.py').read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                        and n.name == 'get_local_photo')
        function.decorator_list = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / 'original.heic'
            from_pillow(Image.new('RGB', (2400, 1200), 'red')).save(original)
            before = original.read_bytes()
            def local_path(value):
                return root / 'cache' if value == '/app/data/thumbnails' else Path(value)
            provider = Mock()
            provider.resolve_local_path.return_value = original
            namespace = dict(Depends=lambda f: None, get_current_user=lambda: None,
                PHOTO_STORAGE_ROOT=directory, HTTPException=HTTPException, FileResponse=FileResponse,
                Path=local_path, uuid=uuid, os=os, LocalStorageProvider=lambda _: provider,
                db_query=lambda *args: [{'provider_key': 'original.heic', 'original_filename': 'photo.heic', 'media_type': 'image/heic'}])
            exec(compile(ast.Module(body=[function], type_ignores=[]), '<local-route>', 'exec'), namespace)
            response = namespace['get_local_photo']('stable-uuid', 'preview', {'role': 'member'})
            self.assertEqual(response.media_type, 'image/jpeg')
            with Image.open(response.path) as preview:
                self.assertEqual(preview.size, (2048, 1024))
            self.assertEqual(original.read_bytes(), before)

    def test_nas_uuid_uses_local_preview_without_flickr_credentials(self):
        tree = ast.parse((Path(__file__).parents[1] / 'main.py').read_text())
        function = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef)
                        and n.name == 'proxy_photo_image')
        function.decorator_list = []
        local = Mock(return_value='local JPEG response')
        namespace = dict(Depends=lambda f: None, get_current_user=lambda: None,
            HTTPException=HTTPException, asyncio=asyncio, get_local_photo=local,
            _catalog_photo=lambda _: {'id': 'stable-uuid', 'nas_key': 'original.heic'})
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<image-route>', 'exec'), namespace)
        response = asyncio.run(namespace['proxy_photo_image']('stable-uuid', 'h', {'role': 'member'}))
        self.assertEqual(response, 'local JPEG response')
        local.assert_called_once_with('stable-uuid', 'preview', {'role': 'member'})


if __name__ == '__main__':
    unittest.main()
