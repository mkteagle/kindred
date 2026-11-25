import json
from pathlib import Path
import tempfile
import unittest
from library_progress import previews_finished, progress


class ReconciliationTests(unittest.TestCase):
    def test_preview_check_must_be_fresh_and_match_the_discovery_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            discovery = root / 'nas-discovery-status.json'
            discovery.write_text(json.dumps({'complete': True}))
            (root / 'nas-preview-status.json').write_text(json.dumps({
                'counts_authoritative': True, 'stage': 'queue_empty', 'in_flight': 0,
                'checked_discovery_version': discovery.stat().st_mtime_ns,
            }))
            (root / 'nas-recognition-status.json').write_text(json.dumps({
                'split_stages': True, 'faces_enabled': False,
            }))
            snapshot = progress(root)
            self.assertTrue(previews_finished(snapshot))
            self.assertTrue(snapshot['recognition']['split_stages'])
            self.assertFalse(snapshot['recognition']['faces_enabled'])
            snapshot['previews']['stale'] = True
            self.assertFalse(previews_finished(snapshot))
            snapshot['previews'].update(stale=False, in_flight=1)
            self.assertFalse(previews_finished(snapshot))
            snapshot['previews'].update(in_flight=0)
            snapshot['discovery']['version'] += 1
            self.assertFalse(previews_finished(snapshot))

    def test_cloud_workers_expose_progress_without_source_details(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            status = root / 'worker-status'
            status.mkdir()
            (status / 'flickr-match-status.json').write_text(json.dumps({
                'running': True, 'completed': 4, 'remote_total': 9, 'matched': 2,
                'owner_id': 'private account', 'source_path': '/private',
            }))
            (status / 'flickr-nas-backup-status.json').write_text('[]')
            snapshot = progress(root)
            self.assertEqual(snapshot['flickr_match']['remote_total'], 9)
            self.assertEqual(snapshot['flickr_match']['matched'], 2)
            self.assertNotIn('owner_id', snapshot['flickr_match'])
            self.assertNotIn('source_path', snapshot['flickr_match'])
            self.assertIsNone(snapshot['flickr_backup'])

    def test_only_matching_complete_audit_explains_exclusions(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/'nas-discovery-status.json').write_text(json.dumps({'registered':90,'complete':True}))
            (root/'nas-folder-inventory.json').write_text(json.dumps({'media_files':100}))
            audit={'catalog_total':90,'inventory_total':100,'exclusions':{'empty_file':10},'unexplained_candidate_gap':0}
            path=root/'nas-discovery-reconciliation.json';path.write_text(json.dumps(audit))
            self.assertEqual(progress(root)['discovery']['excluded'],10)
            audit['catalog_total']=89;path.write_text(json.dumps(audit))
            self.assertNotIn('reconciled',progress(root)['discovery'])
            audit['catalog_total']=90;audit['unexplained_candidate_gap']=1;path.write_text(json.dumps(audit))
            self.assertNotIn('reconciled',progress(root)['discovery'])

if __name__=='__main__':unittest.main()
