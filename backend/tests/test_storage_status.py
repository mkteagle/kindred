import tempfile
import unittest
from unittest.mock import patch
from storage_status import storage_status


class StorageStatusTests(unittest.TestCase):
    def test_unconfigured_and_missing_mount_do_not_report_host_capacity(self):
        self.assertFalse(storage_status('')['configured'])
        with patch('storage_status.shutil.disk_usage') as usage:
            self.assertFalse(storage_status('/does-not-exist-kindred')['available'])
            usage.assert_not_called()

    def test_capacity_comes_from_configured_mount_without_recursing(self):
        with tempfile.TemporaryDirectory() as directory:
            status = storage_status(directory, 'My NAS', 'Our family')
            self.assertTrue(status['available'])
            self.assertEqual(status['name'], 'My NAS')
            self.assertEqual(status['household_name'], 'Our family')
            self.assertEqual(status['total_bytes'], status['used_bytes'] + status['free_bytes'])
            self.assertNotIn(directory, str(status))
