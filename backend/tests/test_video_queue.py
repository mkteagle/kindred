import asyncio
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch
import uuid

import video_mirror
import video_queue


class VideoTests(unittest.TestCase):
    def test_plan_preserves_full_duration_under_limit(self):
        for duration in (0.1, 599.9, 600, 1080, 1080.5, 7800):
            parts = video_mirror.part_plan(duration)
            self.assertAlmostEqual(sum(length for _, length in parts), duration)
            self.assertTrue(all(0 < length < 600 for _, length in parts))
            for (start, length), (next_start, _) in zip(parts, parts[1:]):
                self.assertEqual(start + length, next_start)

    def test_restart_uploads_only_missing_parts(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, KINDRED_WORKER_DATA=directory):
            source = Path(directory) / 'original.mov'
            source.write_bytes(b'original untouched')
            info = {'duration': 700, 'size': 18, 'codec': 'h264'}
            part_info = {'duration': 540, 'size': 100, 'codec': 'h264'}
            def probe(path):
                return info if path == source else dict(part_info, duration=160 if '002' in path.name else 540)
            def convert(source, destination, start, duration):
                destination.write_bytes(b'derivative')
            main = Mock()
            main._upload_to_flickr = AsyncMock(side_effect=['first', RuntimeError('network')])
            with patch.object(video_mirror, 'probe', side_effect=probe), patch.object(video_mirror, 'convert', side_effect=convert), patch.object(video_mirror, 'remote_status', AsyncMock(return_value='ready')):
                with self.assertRaises(RuntimeError):
                    asyncio.run(video_mirror.mirror(main, 'test', source, 'title', '', {}, 'private'))
                manifest = json.loads((Path(directory) / 'video-mirrors/test/manifest.json').read_text())
                self.assertFalse(manifest['complete'])
                self.assertEqual(manifest['parts']['1']['flickr_id'], 'first')
                main._upload_to_flickr = AsyncMock(return_value='second')
                result = asyncio.run(video_mirror.mirror(main, 'test', source, 'title', '', {}, 'private'))
                self.assertEqual(result, 'first')
                main._upload_to_flickr.assert_awaited_once()
                self.assertEqual(source.read_bytes(), b'original untouched')

    def test_failed_queue_job_never_marks_mirror_available(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, KINDRED_WORKER_DATA=directory):
            photo_id = str(uuid.uuid4())
            video_queue.enqueue(photo_id, Path('/durable.mov'), {'title': 'T', 'description': ''}, 'private')
            path = video_queue.queue_root() / photo_id / 'job.json'
            main = Mock()
            main._existing_flickr_copy.return_value = None
            main.get_flickr_credentials.return_value = {'user_id': 'u'}
            with patch.object(video_mirror, 'mirror', AsyncMock(side_effect=RuntimeError('bad video'))):
                asyncio.run(video_queue.process(main, path))
            main._record_flickr_copy.assert_not_called()
            job = json.loads(path.read_text())
            self.assertEqual(job['status'], 'retry')
            self.assertIn('RuntimeError', job['error'])
            video_queue.enqueue(photo_id, Path('/other.mov'), {}, 'public')
            self.assertEqual(json.loads(path.read_text()), job)

    def test_real_conversion_retains_original_and_produces_h264(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'original.mov'
            target = Path(directory) / 'part.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                'color=c=blue:s=64x64:d=1', '-c:v', 'mpeg4', str(source)], check=True)
            before = source.read_bytes()
            video_mirror.convert(source, target, 0, 1)
            info = video_mirror.probe(target)
            self.assertEqual(info['codec'], 'h264')
            self.assertLess(info['size'], video_mirror.MAX_BYTES)
            self.assertEqual(source.read_bytes(), before)

    def test_enqueue_existing_job_does_not_acquire_worker_lock(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, KINDRED_WORKER_DATA=directory):
            photo_id = str(uuid.uuid4())
            video_queue.enqueue(photo_id, Path('/durable.mov'), {'title': 'T'}, 'private')
            with patch.object(video_queue.fcntl, 'flock', side_effect=AssertionError('would block')):
                video_queue.enqueue(photo_id, Path('/durable.mov'), {}, 'private')

    def test_processing_parts_wait_without_reupload_and_metadata_reaches_every_part(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'manifest.json'
            manifest = {'complete': False, 'parts': {
                '1': {'flickr_id': 'one', 'start': 0},
                '2': {'flickr_id': 'two', 'start': 540}}}
            main = Mock()
            main._flickr_set_dates = AsyncMock()
            main._flickr_set_location = AsyncMock()
            metadata = {'taken_at_unix': 1000, 'latitude': 1, 'longitude': 2}
            with patch.object(video_mirror, 'remote_status', AsyncMock(side_effect=['ready', 'processing'])):
                with self.assertRaises(video_mirror.VideoProcessing):
                    asyncio.run(video_mirror.verify_parts(main, path, manifest, {}, metadata))
            self.assertFalse(manifest['complete'])
            self.assertEqual(manifest['parts']['2']['flickr_id'], 'two')
            with patch.object(video_mirror, 'remote_status', AsyncMock(return_value='ready')):
                asyncio.run(video_mirror.verify_parts(main, path, manifest, {}, metadata))
            self.assertEqual(main._flickr_set_dates.await_count, 2)
            main._flickr_set_dates.assert_any_await('one', 1000, {})
            main._flickr_set_dates.assert_any_await('two', 1540, {})
            self.assertEqual(main._flickr_set_location.await_count, 2)
            main._upload_to_flickr.assert_not_called()

    def test_remote_failure_preserves_receipt_and_blocks_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'manifest.json'
            manifest = {'complete': False, 'parts': {'1': {'flickr_id': 'one', 'start': 0}}}
            with patch.object(video_mirror, 'remote_status', AsyncMock(return_value='failed')):
                with self.assertRaises(video_mirror.VideoRejected):
                    asyncio.run(video_mirror.verify_parts(Mock(), path, manifest, {}, {}))
            saved = json.loads(path.read_text())
            self.assertFalse(saved['complete'])
            self.assertEqual(saved['parts']['1']['flickr_id'], 'one')
            self.assertEqual(saved['parts']['1']['remote_status'], 'failed')

    def test_queue_distinguishes_remote_processing_from_rejected_video(self):
        for exception, expected in [(video_mirror.VideoProcessing('pending'), 'processing'),
                                    (video_mirror.VideoRejected('rejected'), 'failed')]:
            with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, KINDRED_WORKER_DATA=directory):
                photo_id = str(uuid.uuid4())
                video_queue.enqueue(photo_id, Path('/original.mov'), {'title': 'T', 'description': ''}, 'private')
                path = video_queue.queue_root() / photo_id / 'job.json'
                main = Mock()
                main._existing_flickr_copy.return_value = None
                main.get_flickr_credentials.return_value = {'user_id': 'owner'}
                with patch.object(video_mirror, 'mirror', AsyncMock(side_effect=exception)):
                    asyncio.run(video_queue.process(main, path))
                self.assertEqual(json.loads(path.read_text())['status'], expected)
                main._record_flickr_copy.assert_not_called()
