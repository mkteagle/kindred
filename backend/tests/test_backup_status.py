import unittest
import uuid

from backup_status import build_backup_status_items


class BackupStatusTests(unittest.TestCase):
    def test_cleanup_requires_both_available_copies(self):
        kindred_id = uuid.uuid4()
        items = build_backup_status_items(
            ["flickr-1"],
            [{
                "flickr_photo_id": "flickr-1",
                "kindred_photo_id": kindred_id,
                "flickr_status": "available",
                "nas_status": "available",
            }],
        )

        self.assertTrue(items[0]["cleanup_safe"])
        self.assertEqual(items[0]["kindred_photo_id"], str(kindred_id))

    def test_missing_nas_copy_fails_closed(self):
        items = build_backup_status_items(
            ["flickr-1"],
            [{
                "flickr_photo_id": "flickr-1",
                "kindred_photo_id": uuid.uuid4(),
                "flickr_status": "available",
                "nas_status": None,
            }],
        )

        self.assertFalse(items[0]["cleanup_safe"])
        self.assertEqual(items[0]["nas_status"], "missing")

    def test_unknown_photo_is_reported_missing_in_request_order(self):
        items = build_backup_status_items(["unknown", "known"], [{
            "flickr_photo_id": "known",
            "kindred_photo_id": uuid.uuid4(),
            "flickr_status": "available",
            "nas_status": "failed",
        }])

        self.assertEqual([item["flickr_photo_id"] for item in items], ["unknown", "known"])
        self.assertEqual(items[0]["flickr_status"], "missing")
        self.assertFalse(items[0]["cleanup_safe"])
        self.assertFalse(items[1]["cleanup_safe"])


if __name__ == "__main__":
    unittest.main()
