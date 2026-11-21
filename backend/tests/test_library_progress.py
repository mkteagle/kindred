import json
from pathlib import Path
import tempfile
import unittest
from library_progress import progress


class ReconciliationTests(unittest.TestCase):
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
