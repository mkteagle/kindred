import importlib.util
from pathlib import Path
import tempfile
import unittest
import json
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('repair',Path(__file__).parents[1]/'repair_empty_media.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class EmptyFileSafetyTests(unittest.TestCase):
    def test_completed_repair_does_not_rewrite_inventory_on_reboot(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);report=root/'repair-report.json'
            report.write_text(json.dumps({'phase':'complete','remaining_empty':0}))
            with patch.object(m,'ROOT',root):m.run()
            self.assertFalse((root/'plan.sqlite3').exists())

    def test_empty_placeholder_can_be_removed(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'empty.jpg';p.touch();m.remove_empty(p,m.empty_identity(p));self.assertFalse(p.exists())
    def test_recovered_content_is_never_deleted(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'empty.jpg';p.touch();expected=m.empty_identity(p);p.write_bytes(b'recovered original')
            with self.assertRaises(ValueError):m.remove_empty(p,expected)
            self.assertEqual(p.read_bytes(),b'recovered original')
    def test_symlink_is_never_deleted_as_an_empty_photo(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/'alias.jpg',Path(d)/'original.jpg';b.touch();a.symlink_to(b)
            with self.assertRaises(ValueError):m.empty_identity(a)
            self.assertTrue(a.is_symlink())
    def test_reused_filename_in_different_year_is_not_a_recovery_match(self):
        self.assertEqual(m.confidence('1999/12 December/31/IMG_1552.JPG','Takeout/Photos from 2016/IMG_1552.JPG'),0)
        self.assertGreaterEqual(m.confidence('2018/01 January/1.8.2018/IMG_2378.JPG','Takeout/1.8.2018/IMG_2378.JPG'),6)
if __name__=='__main__':unittest.main()
