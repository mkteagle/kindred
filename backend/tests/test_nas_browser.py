import tempfile
import unittest
from pathlib import Path
from fastapi import HTTPException
from PIL import Image
from nas_browser import browse, preview, resolve_media_path


class NasBrowserTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'media'
        self.root.mkdir()

    def test_directory_pages_are_bounded_and_do_not_repeat(self):
        (self.root / 'Trip').mkdir()
        for name in ['a.jpg', 'b.mov', 'c.heic', '.hidden.jpg', 'private.txt']:
            (self.root / name).write_bytes(b'x')
        first = browse(self.root, limit=2)
        second = browse(self.root, cursor=first['next_cursor'], limit=2)
        self.assertEqual([i['name'] for i in first['entries']], ['Trip', 'a.jpg'])
        self.assertEqual([i['name'] for i in second['entries']], ['b.mov', 'c.heic'])
        self.assertIsNone(second['next_cursor'])

    def test_traversal_absolute_paths_hidden_paths_and_symlink_escapes_are_rejected(self):
        outside = self.root.parent / 'outside'
        outside.mkdir()
        (self.root / 'escape').symlink_to(outside)
        for value in ['../outside', '/etc', '..', '.hidden', 'escape']:
            with self.assertRaises(HTTPException):
                resolve_media_path(self.root, value)
        self.assertEqual(browse(self.root)['entries'], [])

    def test_invalid_cursor_and_missing_folder_fail_cleanly(self):
        with self.assertRaises(HTTPException): browse(self.root, cursor='not-a-cursor')
        with self.assertRaises(HTTPException): browse(self.root, relative='gone')

    def test_preview_is_durable_and_refreshes_when_source_changes(self):
        source = self.root / 'photo.jpg'
        cache = self.root.parent / 'cache'
        Image.new('RGB', (1600, 1200), 'red').save(source)
        first = preview(self.root, 'photo.jpg', cache)
        with Image.open(first) as image:
            self.assertEqual(image.size, (480, 360))
        self.assertEqual(preview(self.root, 'photo.jpg', cache), first)
        Image.new('RGB', (1200, 1600), 'blue').save(source)
        second = preview(self.root, 'photo.jpg', cache)
        self.assertNotEqual(first, second)
        with Image.open(second) as image:
            self.assertEqual(image.size, (480, 640))

    def test_http_listing_is_owner_only_and_stays_inside_mount(self):
        import ast
        import os
        from unittest.mock import patch
        from fastapi import FastAPI, Depends, Query, Request
        from fastapi.testclient import TestClient
        from fastapi.responses import FileResponse
        source = ast.parse((Path(__file__).parents[1] / 'main.py').read_text())
        functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in ('browse_storage', 'preview_storage_file')]
        for node in functions:
            node.decorator_list = []
        def owner(request: Request):
            role = request.headers.get('x-role')
            if not role:
                raise HTTPException(401)
            if role != 'admin':
                raise HTTPException(403)
            return {'role': role}
        namespace = dict(Depends=Depends, require_admin=owner, Query=Query, FileResponse=FileResponse,
                         PHOTO_STORAGE_ROOT=str(self.root), os=os)
        exec(compile(ast.Module(body=functions, type_ignores=[]), '<nas-routes>', 'exec'), namespace)
        app = FastAPI()
        app.get('/storage/browse')(namespace['browse_storage'])
        app.get('/storage/browse/preview')(namespace['preview_storage_file'])
        with patch.dict(os.environ, KINDRED_BROWSE_ROOT=str(self.root)), TestClient(app) as client:
            self.assertEqual(client.get('/storage/browse').status_code, 401)
            self.assertEqual(client.get('/storage/browse', headers={'x-role': 'member'}).status_code, 403)
            self.assertEqual(client.get('/storage/browse', headers={'x-role': 'admin'}).status_code, 200)
            self.assertEqual(client.get('/storage/browse?path=/etc', headers={'x-role': 'admin'}).status_code, 400)
            self.assertEqual(client.get('/storage/browse/preview?path=a.jpg', headers={'x-role': 'member'}).status_code, 403)
