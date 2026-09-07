"""Run API orchestration without loading the unrelated ML model dependencies."""
import ast
import asyncio
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import Mock, AsyncMock


def functions(names, namespace):
    tree = ast.parse((Path(__file__).parents[1] / 'main.py').read_text())
    selected = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            node.decorator_list = []
            node.returns = None
            for arg in node.args.args:
                arg.annotation = None
            node.args.defaults = [ast.Constant(None) for _ in node.args.defaults]
            selected.append(node)
    exec(compile(ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[])), '<upload-functions>', 'exec'), namespace)
    return namespace


class UploadPathsTests(unittest.TestCase):
    def namespace(self):
        return dict(Path=Path, os=os, VIDEO_EXTENSIONS={'.mov', '.mp4'},
                    PHOTO_STORAGE_ROOT='/archive', UPLOAD_MAX_SIZE=1024**3,
                    # _store_nas_original hands back the capture date and GPS it
                    # read out of the file, which the caller prefers over
                    # whatever the client claimed.
                    _store_nas_original=Mock(return_value=dict(kindred_photo_id='stable',
                        provider_key='videos/original.mov', sha256='checksum', deduplicated=False,
                        taken_at_unix=None, taken_at_source=None, latitude=None, longitude=None)),
                    _existing_flickr_copy=Mock(return_value=None), _queue_video=Mock(),
                    _upload_to_flickr=AsyncMock(), _queue_flickr_replication=Mock(),
                    _set_replication_status=Mock(), _record_flickr_copy=Mock(),
                    db_query=Mock(), _flickr_set_dates=AsyncMock(),
                    _flickr_set_location=AsyncMock(), _process_uploaded_photo=AsyncMock(),
                    _add_photo_to_album_everywhere=AsyncMock(return_value={}),
                    _album_row=Mock(return_value={'id': 'album'}))

    def test_resumable_video_finishes_nas_session_without_flickr(self):
        ns = functions({'_finalize_resumable_upload'}, self.namespace())
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'upload.part'
            source.write_bytes(b'video')
            row = dict(temp_path=str(source), original_filename='camera.MOV', content_type='video/quicktime',
                       title='Camera', description='', taken_at_unix=123, latitude=1, longitude=2,
                       client_upload_id='client', album_id='album', user_id='user')
            asyncio.run(ns['_finalize_resumable_upload']('session', row, {}))
            self.assertFalse(source.exists())
        ns['_queue_video'].assert_called_once()
        ns['_upload_to_flickr'].assert_not_called()
        ns['_flickr_set_dates'].assert_not_called()
        ns['_process_uploaded_photo'].assert_not_called()
        self.assertIn("status = 'completed'", ns['db_query'].call_args.args[0])
        self.assertEqual(ns['db_query'].call_args.args[1], ('stable', None, 'session'))
        self.assertIsNone(ns['_add_photo_to_album_everywhere'].call_args.args[2])

    def test_ordinary_video_returns_pending_receipt_and_keeps_nas_album(self):
        ns = self.namespace()
        ns.update(PRIVACY_FLAGS={'private': ()}, _validate_upload_file=Mock(),
                  get_flickr_credentials=Mock(return_value={'user_id': 'owner'}),
                  _resolve_album=Mock(return_value={'id': 'album'}),
                  _content_type_for_filename=Mock(return_value='video/quicktime'))
        ns = functions({'upload_photo', '_original_upload_limit'}, ns)
        photo = Mock(filename='camera.MOV')
        photo.read = AsyncMock(side_effect=[b'video', b''])
        result = asyncio.run(ns['upload_photo'](Mock(), Mock(), photo=photo, title='Movie',
            description='', taken_at_unix=None, latitude=None, longitude=None,
            client_upload_id=None, skip_processing=True, privacy='private', album_id='album', user={}))
        self.assertEqual(result['flickr_status'], 'pending')
        self.assertEqual(result['kindred_photo_id'], 'stable')
        ns['_upload_to_flickr'].assert_not_called()
        ns['_queue_video'].assert_called_once()
        self.assertFalse(Path(ns['_store_nas_original'].call_args.args[0]).exists())

    def test_capture_metadata_prefers_the_file_over_the_client(self):
        """The client is a fallback for the capture date, never the source."""
        try:
            from PIL import Image
        except ImportError:
            self.skipTest('Pillow is required to write an EXIF fixture')
        ns = functions({'_resolve_capture_metadata'}, dict(Path=Path, print=print))
        resolve = ns['_resolve_capture_metadata']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dated = root / 'IMG_0001.jpg'
            image = Image.new('RGB', (4, 4))
            exif = image.getexif()
            exif.get_ifd(0x8769)[0x9003] = '2019:04:12 14:30:00'
            exif.get_ifd(0x8825).update({1: 'N', 2: (40.0, 0.0, 0.0),
                                         3: 'W', 4: (73.0, 0.0, 0.0)})
            image.save(dated, exif=exif)

            # 1 January 2024, which the EXIF must beat.
            taken_at, latitude, longitude, source = resolve(
                str(dated), 'IMG_0001.jpg', 'image/jpeg', 1704067200, 10.0, 10.0)
            self.assertEqual(taken_at.strftime('%Y-%m-%d %H:%M'), '2019-04-12 14:30')
            self.assertEqual(source, 'exif:DateTimeOriginal')
            self.assertAlmostEqual(latitude, 40.0)
            self.assertAlmostEqual(longitude, -73.0)

            bare = root / 'DSC00019.jpg'
            Image.new('RGB', (4, 4)).save(bare)
            taken_at, _, _, source = resolve(
                str(bare), 'DSC00019.jpg', 'image/jpeg', 1704067200, None, None)
            self.assertEqual(taken_at.strftime('%Y-%m-%d'), '2024-01-01')
            self.assertEqual(source, 'client')

            # A client date no camera could have produced is dropped, and the
            # filename is the last thing left to ask.
            taken_at, _, _, source = resolve(
                str(bare), 'IMG_20190412_143000.jpg', 'image/jpeg', 0, None, None)
            self.assertEqual(source, 'filename')
            self.assertEqual(taken_at.strftime('%Y-%m-%d %H:%M'), '2019-04-12 14:30')

            taken_at, latitude, longitude, source = resolve(
                str(bare), 'DSC00019.jpg', 'image/jpeg', None, 0.0, 0.0)
            self.assertIsNone(taken_at)
            self.assertIsNone(source)
            self.assertIsNone(latitude)

    def test_capture_metadata_survives_a_file_it_cannot_read(self):
        ns = functions({'_resolve_capture_metadata'}, dict(Path=Path, print=print))
        taken_at, latitude, _, source = ns['_resolve_capture_metadata'](
            '/does/not/exist.jpg', 'holiday.jpg', 'image/jpeg', 1555079400, 40.1, -111.7)
        self.assertEqual(source, 'client')
        self.assertEqual(taken_at.strftime('%Y-%m-%d'), '2019-04-12')
        self.assertAlmostEqual(latitude, 40.1)

    def test_video_original_limit_is_independent_of_flickr_limit(self):
        ns = functions({'_original_upload_limit'}, self.namespace())
        self.assertGreater(ns['_original_upload_limit']('camera.MOV'), 8442861473)
        self.assertEqual(ns['_original_upload_limit']('image.jpg'), 1024**3)

    def test_batch_uses_durable_ordinary_path_without_reading_entire_file(self):
        ns = functions({'upload_photos_batch'}, dict(
            get_flickr_credentials=Mock(return_value={}),
            upload_photo=AsyncMock(return_value={'status': 'ok', 'flickr_status': 'pending'})))
        ns['get_flickr_credentials'].return_value = {'user_id': 'owner'}
        photo = Mock(filename='movie.mov')
        result = asyncio.run(ns['upload_photos_batch'](Mock(), Mock(), photos=[photo], title='', description='', user={}))
        self.assertEqual(result['uploaded'], 1)
        ns['upload_photo'].assert_awaited_once()
        photo.read.assert_not_called()

class LegacyUploaderTests(unittest.TestCase):
    def test_video_request_streams_original_and_keeps_nas_receipt(self):
        import uuid
        from datetime import datetime
        tree = ast.parse((Path(__file__).parents[2] / 'tools' / 'bulk-upload.py').read_text())
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'queue_video_on_nas')
        ns = dict(uuid=uuid, CONTENT_TYPES={'.mov': 'video/quicktime'}, datetime=datetime)
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<bulk-video>', 'exec'), ns)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'movie.mov'
            source.write_bytes(b'v' * (1024 * 1024 + 10))
            meta = Mock(title='Movie', description='', date_taken=None, latitude=None, longitude=None)
            session = Mock()
            def post(url, **kwargs):
                self.assertEqual(len(kwargs['data']), int(kwargs['headers']['Content-Length']))
                chunks = list(kwargs['data'])
                self.assertEqual(len(chunks), 4)
                self.assertEqual(b''.join(chunks[1:3]), source.read_bytes())
                self.assertEqual(sum(map(len, chunks)), int(kwargs['headers']['Content-Length']))
                return Mock(json=lambda: dict(nas_status='available', kindred_photo_id='stable', flickr_status='pending'))
            session.post.side_effect = post
            receipt = ns['queue_video_on_nas'](source, meta, 'http://nas', 'key', session)
            self.assertEqual(receipt['flickr_status'], 'pending')

class VideoAlbumTests(unittest.TestCase):
    def test_later_album_addition_includes_all_completed_parts(self):
        import json
        import uuid
        from unittest.mock import patch
        import video_queue
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, PHOTO_STORAGE_ROOT=directory, KINDRED_WORKER_DATA=directory):
            photo_id = str(uuid.uuid4())
            manifest_path = video_queue.queue_root() / photo_id / 'manifest.json'
            manifest_path.parent.mkdir(parents=True)
            manifest_path.write_text(json.dumps(dict(complete=True, parts={'1': {'flickr_id': '101'}, '2': {'flickr_id': '102'}})))
            ns = functions({'_add_photo_to_album_everywhere'}, dict(
                PHOTO_STORAGE_ROOT=directory, json=json, db_query=Mock(),
                _link_photo_into_album_on_nas=Mock(return_value='albums/family/movie.mov'),
                _ensure_flickr_photoset=AsyncMock(return_value=('set', False)),
                _add_photo_to_album=AsyncMock()))
            result = asyncio.run(ns['_add_photo_to_album_everywhere'](
                {'id': 'album', 'slug': 'family'}, photo_id, '101', 'movie.mov', {}))
            self.assertTrue(result['flickr_linked'])
            self.assertEqual([c.args[0] for c in ns['_add_photo_to_album'].call_args_list], ['101', '102'])
