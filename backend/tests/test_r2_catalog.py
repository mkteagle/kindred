import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

from r2_catalog import initialize_feed, resync_catalog, sync_batch
from r2_thumbnails import attach_published_urls


class ThumbnailCatalogTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("botocore"), "botocore is required to sign R2 URLs")
    def test_confirmed_keys_are_signed_without_an_object_lookup(self):
        client = Mock()
        client.generate_presigned_url.return_value = "fixture-signed-url"
        photos = [{"thumbnail_object_key": "thumbnails/v1/123.jpg"}, {"thumbnail_object_key": None}]
        with patch("r2_thumbnails.storage", return_value=(client, "private")):
            attach_published_urls(photos)
        self.assertEqual(photos, [{"thumbnail_url": "fixture-signed-url"}, {}])
        client.head_object.assert_not_called()

    def test_checkpoint_backfill_and_new_keys_survive_a_failed_catalog_write(self):
        connection = Mock()
        with sqlite3.connect(":memory:") as db:
            db.execute("CREATE TABLE published (key TEXT PRIMARY KEY, version TEXT NOT NULL)")
            db.execute("INSERT INTO published VALUES ('existing', 'v1')")
            db.commit()
            initialize_feed(db)
            with db:
                db.execute("INSERT INTO published VALUES ('new', 'v1')")
            with patch("r2_catalog.record_keys", side_effect=OSError("offline")):
                with self.assertRaises(OSError):
                    sync_batch(db, connection, "private", 0)
            with patch("r2_catalog.record_keys") as record:
                cursor = sync_batch(db, connection, "private", 0)
                self.assertEqual(cursor, 2)
                record.assert_called_once_with(connection, "private", ["existing", "new"])
            initialize_feed(db)
            self.assertEqual(sync_batch(db, connection, "private", cursor), cursor)

    def test_full_resync_only_records_canonical_thumbnail_keys(self):
        client, database = Mock(), Mock()
        client.get_paginator.return_value.paginate.return_value = [
            {"Contents": [
                {"Key": "thumbnails/v1/123.jpg"},
                {"Key": "thumbnails/v1/invalid.jpg"},
                {"Key": "originals/123.jpg"},
            ]},
            {"Contents": [{"Key": "thumbnails/v1/456.jpg"}]},
        ]
        with patch("r2_catalog.record_keys") as record:
            self.assertEqual(resync_catalog(client, "private", database), 2)
        self.assertEqual([call.args[2] for call in record.call_args_list], [
            ["thumbnails/v1/123.jpg"], ["thumbnails/v1/456.jpg"],
        ])

    def test_read_only_sync_can_run_while_the_publisher_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.sqlite"
            with sqlite3.connect(path) as writer:
                writer.execute("PRAGMA journal_mode=WAL")
                writer.execute("CREATE TABLE published (key TEXT PRIMARY KEY, version TEXT NOT NULL)")
                initialize_feed(writer)
                writer.execute("INSERT INTO published VALUES ('first', 'v1')")
                with sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True) as reader:
                    with patch("r2_catalog.record_keys") as record:
                        self.assertEqual(sync_batch(reader, Mock(), "private", 0), 0)
                        record.assert_not_called()
                        writer.commit()
                        self.assertEqual(sync_batch(reader, Mock(), "private", 0), 1)
                        self.assertEqual(record.call_args.args[2], ["first"])
