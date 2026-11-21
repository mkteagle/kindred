import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('consolidate',Path(__file__).parents[1]/'nas_consolidate.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CleanupSafety(unittest.TestCase):
    def test_exact_copy_removed_only_after_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/'a',Path(d)/'b';a.write_bytes(b'original');b.write_bytes(b'original')
            receipts=[]
            def receipt(h,n):
                self.assertTrue(a.exists());self.assertTrue(b.exists());receipts.append((h,n))
            self.assertTrue(m.verified_remove(a,b,receipt,lambda **kw:None))
            self.assertFalse(a.exists());self.assertEqual(b.read_bytes(),b'original');self.assertEqual(len(receipts),1)
    def test_same_size_different_content_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/'a',Path(d)/'b';a.write_bytes(b'one');b.write_bytes(b'two')
            self.assertFalse(m.verified_remove(a,b,lambda *a:self.fail('receipt'),lambda **kw:None));self.assertTrue(a.exists())
    def test_failed_receipt_preserves_original(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/'a',Path(d)/'b';a.write_bytes(b'one');b.write_bytes(b'one')
            def fail(*args):raise OSError('disk full')
            with self.assertRaises(OSError):m.verified_remove(a,b,fail,lambda **kw:None)
            self.assertTrue(a.exists())
    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/'a',Path(d)/'b';b.write_bytes(b'one');a.symlink_to(b)
            with self.assertRaises(ValueError):m.verified_remove(a,b,lambda *a:None,lambda **kw:None)
class ResumeAndScope(unittest.TestCase):
    def test_full_pass_preserves_unique_sidecars_and_archives(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); library=root/'library';staging=root/'takeout'
            library.mkdir();staging.mkdir()
            (library/'keep.jpg').write_bytes(b'original')
            (staging/'copy.jpg').write_bytes(b'original')
            (staging/'unique.jpg').write_bytes(b'different')
            (staging/'copy.jpg.json').write_text('album context')
            (staging/'archive.zip').write_bytes(b'archive')
            discovery=root/'discovery.json';discovery.write_text(json.dumps({'phase':'complete','complete':True}))
            config=dict(state_dir=str(root/'state'),library=str(library),staging=[str(staging)],discovery_status=str(discovery),heartbeat=str(root/'heartbeat.json'))
            job=m.Job(config);job.run()
            self.assertFalse((staging/'copy.jpg').exists())
            self.assertTrue((library/'keep.jpg').exists())
            self.assertTrue((staging/'unique.jpg').exists())
            self.assertTrue((staging/'copy.jpg.json').exists())
            self.assertTrue((staging/'archive.zip').exists())
            self.assertEqual(job.status['totals']['removed_exact_duplicate']['files'],1)
            job.db.close()
            resumed=m.Job(config);resumed.run()
            self.assertEqual(resumed.status['totals']['removed_exact_duplicate']['files'],1)
            resumed.db.close()
    def test_non_utf8_path_round_trip(self):
        import os
        value=os.fsdecode(b'/photos/file\xff.jpg')
        self.assertEqual(m.decode_path(m.encode_path(value)),value)
if __name__=='__main__':unittest.main()

