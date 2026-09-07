import asyncio
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import AsyncMock, Mock, patch
import uuid

import video_mirror as mirror
import video_queue as queue
from storage import LocalStorageProvider
from migrate_video_originals import migrate_one


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        env = patch.dict(os.environ, PHOTO_STORAGE_ROOT=str(self.root), KINDRED_WORKER_DATA=str(self.root / 'data'))
        env.start()
        self.addCleanup(env.stop)
        self.source = self.root / 'original.mov'
        self.source.write_bytes(b'original')
        self.id = str(uuid.uuid4())
        self.metadata = dict(title='Movie', description='', taken_at_unix=1000, latitude=1, longitude=2)
        queue.enqueue(self.id, self.source, self.metadata, 'private')
        self.job_path = queue.queue_root() / self.id / 'job.json'

    def prepare(self):
        def probe(path):
            return dict(duration=1, size=10, codec='h264')
        def convert(source, destination, start, duration):
            destination.write_bytes(b'converted')
        with patch.object(mirror, 'probe', side_effect=probe), patch.object(mirror, 'convert', side_effect=convert):
            return mirror.prepare(self.id, self.source, sha256(b'original').hexdigest())

    def api(self):
        main = Mock()
        main._existing_flickr_copy.return_value = None
        main.get_flickr_credentials.return_value = {'user_id': 'owner'}
        main._upload_to_flickr = AsyncMock(return_value='101')
        main._flickr_set_dates = AsyncMock()
        main._flickr_set_location = AsyncMock()
        main._add_photo_to_album_everywhere = AsyncMock(return_value={'flickr_linked': True})
        main.db_query.return_value = []
        return main

    def upload_job(self):
        job = json.loads(self.job_path.read_text())
        job.update(phase='upload', status='ready')
        mirror.save(self.job_path, job)

    def test_original_checksum_mismatch_never_converts(self):
        with patch.object(mirror, 'convert') as convert:
            with self.assertRaisesRegex(ValueError, 'catalog'):
                mirror.prepare(self.id, self.source, 'different')
        convert.assert_not_called()

    def test_same_size_and_timestamp_content_change_is_detected(self):
        self.prepare()
        original_stat = self.source.stat()
        self.source.write_bytes(b'changed!')
        os.utime(self.source, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
        with self.assertRaisesRegex(ValueError, 'checksum changed'):
            mirror.prepare(self.id, self.source)

    def test_legacy_receipt_upgrade_preserves_ids_and_requires_verified_owner(self):
        manifest = self.prepare()
        manifest.pop('version')
        manifest.pop('sha256')
        manifest.update(complete=True)
        manifest['parts']['1']['flickr_id'] = '101'
        path = mirror.manifest_path(self.id)
        mirror.save(path, manifest)
        with patch.object(mirror, 'probe', return_value=dict(duration=1, size=8)):
            mirror.prepare(self.id, self.source)
        main = self.api()
        with self.assertRaises(mirror.ReconciliationRequired):
            asyncio.run(mirror.upload_prepared(main, self.id, 'Movie', '', {'user_id': 'owner'}, 'private'))
        queue.reconcile_part(self.id, verified_owner='owner')
        with patch.object(mirror, 'remote_status', AsyncMock(return_value='ready')):
            result = asyncio.run(mirror.upload_prepared(main, self.id, 'Movie', '', {'user_id': 'owner'}, 'private'))
        self.assertEqual(result, '101')
        main._upload_to_flickr.assert_not_called()
        self.assertEqual(json.loads(path.read_text())['parts']['1']['flickr_id'], '101')

    def test_preupgrade_cached_derivative_requires_reconciliation(self):
        manifest = self.prepare()
        manifest.pop('version')
        mirror.save(mirror.manifest_path(self.id), manifest)
        with patch.object(mirror, 'probe', return_value=dict(duration=1, size=8)):
            with self.assertRaises(mirror.ReconciliationRequired):
                mirror.prepare(self.id, self.source)
        self.assertEqual(json.loads(mirror.manifest_path(self.id).read_text())['parts']['1']['state'], 'uncertain')

    def test_upload_intent_after_crash_cannot_be_blindly_replayed(self):
        manifest = self.prepare()
        manifest['parts']['1']['state'] = 'uploading'
        mirror.save(mirror.manifest_path(self.id), manifest)
        self.upload_job()
        main = self.api()
        asyncio.run(queue.process(main, self.job_path, 'upload'))
        self.assertEqual(json.loads(self.job_path.read_text())['status'], 'needs_reconciliation')
        main._upload_to_flickr.assert_not_called()
        main._record_flickr_copy.assert_not_called()

    def test_account_change_does_not_mix_receipts(self):
        manifest = self.prepare()
        manifest['owner_id'] = 'original-owner'
        mirror.save(mirror.manifest_path(self.id), manifest)
        main = self.api()
        with self.assertRaisesRegex(ValueError, 'account changed'):
            asyncio.run(mirror.upload_prepared(main, self.id, '', '', {'user_id': 'new-owner'}, 'private'))
        main._upload_to_flickr.assert_not_called()

    def test_processing_receipts_retry_without_upload_then_albums_and_sql_complete(self):
        self.prepare()
        self.upload_job()
        main = self.api()
        with patch.object(mirror, 'validate_part'), patch.object(mirror, 'remote_status', AsyncMock(return_value='processing')):
            asyncio.run(queue.process(main, self.job_path, 'upload'))
        self.assertEqual(json.loads(self.job_path.read_text())['status'], 'processing')
        main._record_flickr_copy.assert_not_called()
        job = json.loads(self.job_path.read_text())
        job['next_attempt'] = 0
        mirror.save(self.job_path, job)
        main.db_query.side_effect = [[{'id': 'album'}], [{'original_filename': 'camera.mov'}], []]
        with patch.object(mirror, 'remote_status', AsyncMock(return_value='ready')):
            asyncio.run(queue.process(main, self.job_path, 'upload'))
        self.assertEqual(json.loads(self.job_path.read_text())['status'], 'done')
        main._upload_to_flickr.assert_awaited_once()
        main._flickr_set_dates.assert_awaited_once_with('101', 1000, {'user_id': 'owner'})
        main._flickr_set_location.assert_awaited_once_with('101', 1.0, 2.0, {'user_id': 'owner'})
        main._add_photo_to_album_everywhere.assert_awaited_once_with({'id': 'album'}, self.id, '101', 'camera.mov', {'user_id': 'owner'})
        main._record_flickr_copy.assert_called_once_with(self.id, '101', 'owner')

    def test_corrupt_cached_output_requeues_conversion_before_upload(self):
        self.prepare()
        self.upload_job()
        main = self.api()
        with patch.object(mirror, 'validate_part', side_effect=ValueError('oversized')):
            asyncio.run(queue.process(main, self.job_path, 'upload'))
        job = json.loads(self.job_path.read_text())
        self.assertEqual(job['phase'], 'convert')
        self.assertEqual(job['status'], 'retry')
        main._upload_to_flickr.assert_not_called()

    def test_migrated_queue_resolves_current_catalog_path(self):
        old = self.root / self.id[:2] / self.id / 'original.mov'
        old.parent.mkdir(parents=True)
        old.write_bytes(b'original')
        key = old.relative_to(self.root).as_posix()
        row = dict(photo_id=self.id, provider_key=key, sha256=sha256(b'original').hexdigest())
        provider = LocalStorageProvider(self.root)
        album = provider.link_into_album('family', key, 'camera.mov')
        new_key = migrate_one(self.root, row, Mock(), apply=True)
        main = self.api()
        main.db_query.return_value = [dict(row, provider_key=new_key)]
        source, checksum = queue.durable_source(main, dict(photo_id=self.id, source='/obsolete/path.mov'))
        self.assertEqual(source.read_bytes(), b'original')
        self.assertTrue(source.relative_to(self.root).as_posix().startswith('videos/'))
        self.assertEqual((self.root / album).read_bytes(), b'original')
        self.assertEqual(checksum, row['sha256'])

    def test_upload_dispatch_runs_while_another_video_is_converting(self):
        second_id = str(uuid.uuid4())
        queue.enqueue(second_id, self.source, self.metadata, 'private')
        second_path = queue.queue_root() / second_id / 'job.json'
        job = json.loads(second_path.read_text())
        job.update(phase='upload', status='ready')
        mirror.save(second_path, job)
        started, released = threading.Event(), threading.Event()
        def slow_prepare(*args):
            started.set()
            if not released.wait(3):
                raise RuntimeError('Upload did not make independent progress')
        main = self.api()
        async def run():
            conversion = asyncio.create_task(queue.process(main, self.job_path, 'convert'))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                await queue.process(main, second_path, 'upload')
                self.assertEqual(json.loads(second_path.read_text())['status'], 'done')
            finally:
                released.set()
                await conversion
        with patch.object(queue, 'durable_source', return_value=(self.source, 'checksum')), \
             patch.object(mirror, 'prepare', side_effect=slow_prepare), \
             patch.object(mirror, 'upload_prepared', AsyncMock(return_value='101')), \
             patch.object(queue, 'sync_albums', AsyncMock()):
            asyncio.run(run())
        self.assertEqual(json.loads(self.job_path.read_text())['phase'], 'upload')
