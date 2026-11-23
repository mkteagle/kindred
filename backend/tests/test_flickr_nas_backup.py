import json
from pathlib import Path
import tempfile
import unittest

from flickr_nas_backup import comparison_complete, supported
from flickr_upload_response import duplicate_photo_id


class FlickrBackupTests(unittest.TestCase):
    def test_bulk_backup_requires_a_full_account_comparison(self):
        with tempfile.TemporaryDirectory() as root:
            status = Path(root) / 'status.json'
            self.assertFalse(comparison_complete(status))
            state = dict(scope='account', complete=True, remote_total=7, completed=6)
            status.write_text(json.dumps(state))
            self.assertFalse(comparison_complete(status))
            state.update(completed=7, scope='album')
            status.write_text(json.dumps(state))
            self.assertFalse(comparison_complete(status))
            state['scope'] = 'account'
            status.write_text(json.dumps(state))
            self.assertTrue(comparison_complete(status))

    def test_source_format_and_byte_size_respect_flickr_limits(self):
        args = dict(original_filename='image.heic', provider_key='library/source', media_kind='photo', byte_size=10)
        self.assertTrue(supported(args))
        self.assertFalse(supported(dict(args, original_filename='image.dng')))
        self.assertFalse(supported(dict(args, byte_size=200_000_001)))
        self.assertTrue(supported(dict(args, original_filename='video.mov', media_kind='video', byte_size=1_000_000_000)))

    def test_duplicate_receipt_only_reuses_a_valid_provider_id(self):
        self.assertEqual(duplicate_photo_id('<rsp stat="fail"><err code="9" duplicate_photo_id="123"/></rsp>'), '123')
        self.assertEqual(duplicate_photo_id('<rsp><err code="9"/><duplicate_photo_id>123</duplicate_photo_id></rsp>'), '123')
        self.assertIsNone(duplicate_photo_id('<rsp><err code="8" duplicate_photo_id="123"/></rsp>'))
        self.assertIsNone(duplicate_photo_id('<rsp><err code="9" duplicate_photo_id="https://example.net"/></rsp>'))
        self.assertIsNone(duplicate_photo_id('temporarily unavailable'))
