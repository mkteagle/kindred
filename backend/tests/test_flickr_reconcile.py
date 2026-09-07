import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from flickr_reconcile import build_links, classify, local_status, run


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'original.heic').write_bytes(b'original')
        self.row = dict(photo_id='local', nas_key='original.heic', flickr_id='one',
                        original_filename='original.heic', byte_size=8,
                        sha256=hashlib.sha256(b'original').hexdigest())

    def check(self, remote, manifests=(), verify=False):
        catalog, links, issues = build_links([self.row], manifests, 'owner')
        return classify(remote, catalog, links, {}, self.root, verify)

    def test_heic_conversion_maps_to_original_without_matching_jpeg_hash(self):
        item = self.check(dict(id='one', media='photo', originalformat='jpg'), verify=True)
        self.assertEqual(item['action'], 'skip_verified_original')
        self.assertEqual(item['conversion'], 'heif_to_jpeg_inferred_from_linked_formats')

    def test_stat_only_does_not_claim_verified_skip(self):
        self.assertEqual(self.check(dict(id='one'))['action'], 'linked_requires_hash')

    def test_all_video_parts_link_to_same_original(self):
        manifest = dict(owner_id='owner', sha256=self.row['sha256'], parts={
            '1': dict(flickr_id='one', start=0, duration=540),
            '2': dict(flickr_id='two', start=540, duration=20)})
        for remote_id in ('one', 'two'):
            item = self.check(dict(id=remote_id, media='video'), [('local', manifest)], True)
            self.assertEqual(item['action'], 'skip_verified_original')
            self.assertEqual(item['conversion'], 'video_derivative')

    def test_unverified_video_owner_or_hash_blocks_skip(self):
        for owner, sha in [('wrong', self.row['sha256']), ('owner', 'wrong'), (None, None)]:
            manifest = dict(owner_id=owner, sha256=sha, parts={'1': dict(flickr_id='one')})
            self.assertEqual(self.check(dict(id='one'), [('local', manifest)], True)['action'],
                             'review_ambiguous_mapping')

    def test_missing_original_requires_recovery(self):
        (self.root / 'original.heic').unlink()
        self.assertEqual(self.check(dict(id='one'), verify=True)['action'], 'recover_missing_original')

    def test_absent_hashes_do_not_prove_video_identity(self):
        self.row['sha256'] = None
        manifest = dict(owner_id='owner', parts={'1': dict(flickr_id='one')})
        self.assertEqual(self.check(dict(id='one'), [('local', manifest)])['action'],
                         'review_ambiguous_mapping')

    def test_wrong_bytes_not_skipped(self):
        (self.root / 'original.heic').write_bytes(b'changed!')
        self.assertEqual(self.check(dict(id='one'), verify=True)['nas_status'], 'checksum_mismatch')

    def test_unmatched_video_requires_resolution(self):
        self.assertEqual(self.check(dict(id='unknown', media='video'))['action'], 'resolve_video_original')
        self.assertEqual(self.check(dict(id='unknown', media='photo'))['action'], 'download_candidate')

    def test_path_escape_and_missing_fingerprints(self):
        for key in ('../escape', '/etc/passwd'):
            self.assertEqual(local_status(self.root, {**self.row, 'nas_key': key}, True), 'unsafe_path')
        self.assertEqual(local_status(self.root, {**self.row, 'sha256': None}, True), 'checksum_unknown')

    def test_conflicting_catalog_and_video_identity(self):
        other = {**self.row, 'photo_id': 'other', 'flickr_id': None}
        manifest = dict(owner_id='owner', sha256=self.row['sha256'], parts={'1': dict(flickr_id='one')})
        catalog, links, _ = build_links([self.row, other], [('other', manifest)], 'owner')
        self.assertEqual(classify(dict(id='one'), catalog, links, {}, self.root, True)['action'], 'review_ambiguous_mapping')

    def inventory(self, pages):
        main = SimpleNamespace(get_flickr_credentials=lambda: {'user_id': 'owner'},
                               db_query=lambda query: [self.row], PHOTO_STORAGE_ROOT=self.root)
        queue = SimpleNamespace(queue_root=lambda: self.root / 'queue')
        args = SimpleNamespace(output=self.root / 'report.json', verify_sha256=False, max_pages=None)
        responses = [{'user': {'id': 'owner'}}, *[{'photos': page} for page in pages]]
        with patch.dict('sys.modules', {'main': main, 'video_queue': queue}), \
                patch('flickr_reconcile.api', side_effect=responses) as api, \
                patch('flickr_reconcile.time.time', return_value=123456), patch('builtins.print'):
            code = run(args)
        report = json.loads(args.output.read_text())
        self.assertEqual(args.output.stat().st_mode & 0o777, 0o600)
        for call in api.call_args_list[1:]:
            self.assertEqual(call.kwargs['max_upload_date'], 123455)
            self.assertEqual(call.kwargs['content_types'], '0,1,2,3')
            self.assertEqual(call.kwargs['safe_search'], 3)
        return code, report

    def test_inventory_uses_fixed_cutoff_and_completes(self):
        code, report = self.inventory([
            dict(total=2, pages=2, photo=[dict(id='one', owner='owner')]),
            dict(total=2, pages=2, photo=[dict(id='two', owner='owner', media='video')])])
        self.assertEqual(code, 0)
        self.assertTrue(report['complete'])
        self.assertEqual(report['summary'], {'linked_requires_hash': 1, 'resolve_video_original': 1})

    def test_inventory_rejects_shifting_totals_and_duplicates(self):
        code, report = self.inventory([
            dict(total=2, pages=2, photo=[dict(id='one', owner='owner')]),
            dict(total=3, pages=2, photo=[dict(id='one', owner='owner')])])
        self.assertEqual(code, 2)
        self.assertFalse(report['complete'])
        self.assertEqual(report['remote_items'], 1)

    def test_inventory_rejects_unexpected_owner(self):
        with self.assertRaisesRegex(RuntimeError, 'Unexpected owner'):
            self.inventory([dict(total=1, pages=1, photo=[dict(id='one', owner='someone-else')])])


if __name__ == '__main__':
    unittest.main()
