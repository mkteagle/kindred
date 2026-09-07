from __future__ import annotations as _future_annotations

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
                title TEXT, original_filename TEXT, taken_at TEXT, created_at TEXT,
                media_kind TEXT GENERATED ALWAYS AS (
                    CASE WHEN media_type LIKE 'video/%' THEN 'video' ELSE 'photo' END) STORED,
                duration_seconds REAL);
            CREATE TABLE photo_copies (photo_id TEXT, provider TEXT, status TEXT,
                provider_key TEXT, remote_url TEXT);
            CREATE TABLE processed_photos (photo_id TEXT);
            INSERT INTO photos (id,legacy_photo_id,media_type,title,original_filename,
                taken_at,created_at,duration_seconds) VALUES
                ('a',NULL,'image/heic','A','a.heic','2020','2024',NULL),
                ('b',NULL,'image/jpeg','B','b.jpg','2021','2024',NULL),
                ('c',NULL,'video/mp4','C','c.mp4','2022','2024',12.5),
                ('d',NULL,'image/jpeg','D','d.jpg','2023','2024',NULL);
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

    def test_gallery_pages_by_cursor_and_sorts_including_heic(self):
        first = gallery(self.query, 'newest', 1, media='photo')
        self.assertEqual(first['photos'][0]['photo_id'], 'b')
        self.assertIsNotNone(first['next_cursor'])
        second = gallery(self.query, 'newest', 1, media='photo', cursor=first['next_cursor'])
        self.assertEqual(second['photos'][0]['photo_id'], 'a')
        self.assertIsNone(second['next_cursor'])
        self.assertEqual(gallery(self.query, 'oldest', 48, media='photo')['photos'][0]['photo_id'], 'a')

    def test_cursor_never_repeats_or_skips_a_row(self):
        seen, cursor = [], None
        while True:
            page = gallery(self.query, 'newest', 1, media='all', cursor=cursor)
            seen += [row['photo_id'] for row in page['photos']]
            cursor = page['next_cursor']
            if not cursor:
                break
        self.assertEqual(seen, ['c', 'b', 'a'])
        self.assertEqual(len(seen), len(set(seen)))

    def test_media_filter_selects_videos_only(self):
        videos = gallery(self.query, 'newest', 48, media='video')['photos']
        self.assertEqual([row['photo_id'] for row in videos], ['c'])
        self.assertEqual(videos[0]['media_kind'], 'video')
        self.assertEqual(videos[0]['duration_seconds'], 12.5)

    def test_all_media_returns_photos_and_videos_together(self):
        rows = gallery(self.query, 'newest', 48, media='all')['photos']
        self.assertEqual([row['photo_id'] for row in rows], ['c', 'b', 'a'])

    def test_sort_value_is_not_leaked_to_clients(self):
        for row in gallery(self.query, 'newest', 48, media='all')['photos']:
            self.assertNotIn('sort_value', row)

    def test_invalid_sort_media_and_cursor_are_rejected(self):
        with self.assertRaises(HTTPException):
            gallery(self.query, 'id; DROP TABLE photos', 48)
        with self.assertRaises(HTTPException):
            gallery(self.query, 'newest', 48, media='videos; DROP TABLE photos')
        with self.assertRaises(HTTPException):
            gallery(self.query, 'newest', 48, cursor='not-a-cursor')

    def test_gallery_parameterizes_every_value_for_psycopg(self):
        query = Mock(return_value=[])
        gallery(query, 'newest', 48, media='video')
        sql, params = query.call_args.args
        self.assertNotIn("'video'", sql)
        self.assertEqual(sql.count('%s'), len(params))
        self.assertEqual(params, ('video', 49))


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
            # main.py targets 3.11 and annotates FastAPIRequest; future
            # annotations keep the signature from being evaluated here.
            exec(compile(ast.Module(body=[function], type_ignores=[]), '<local-route>', 'exec',
                         flags=_future_annotations.compiler_flag), namespace)
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
