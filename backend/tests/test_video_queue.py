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
            with patch.object(video_mirror, 'probe', side_effect=probe), patch.object(video_mirror, 'convert', side_effect=convert):
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
