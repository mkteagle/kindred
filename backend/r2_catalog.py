"""Publish confirmed R2 object keys to the library catalog."""
from contextlib import closing
import json
import logging
import os
from pathlib import Path
import sqlite3
from threading import Event

from r2_thumbnails import THUMBNAIL_PREFIX, key_for, storage

log = logging.getLogger(__name__)
BATCH_SIZE = 1024


def initialize_feed(db):
    with db:
        db.execute("BEGIN IMMEDIATE")
        initialized = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_publications'").fetchone()
        db.execute("""
            CREATE TABLE IF NOT EXISTS catalog_publications (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE
            )
        """)
        if not initialized:
            db.execute("INSERT INTO catalog_publications (key) SELECT key FROM published")
        db.execute("DROP TRIGGER IF EXISTS enqueue_catalog_thumbnail")
        db.execute("""
            CREATE TRIGGER IF NOT EXISTS catalog_thumbnail_published
            AFTER INSERT ON published BEGIN
                INSERT OR IGNORE INTO catalog_publications (key) VALUES (NEW.key);
            END
        """)


def record_keys(connection, bucket, keys):
    from psycopg2.extras import execute_values

    with connection, connection.cursor() as cursor:
        execute_values(cursor, """
            INSERT INTO r2_thumbnail_objects (bucket, object_key)
            VALUES %s ON CONFLICT DO NOTHING
        """, [(bucket, key) for key in keys], page_size=BATCH_SIZE)


def sync_batch(db, connection, bucket, after):
    records = db.execute("""
        SELECT sequence, key FROM catalog_publications
        WHERE sequence > ? ORDER BY sequence LIMIT ?
    """, (after, BATCH_SIZE)).fetchall()
    if not records:
        return after
    record_keys(connection, bucket, [key for _, key in records])
    return records[-1][0]


def read_cursor(path, bucket):
    try:
        data = json.loads(path.read_text())
        return int(data["sequence"]) if data["bucket"] == bucket else 0
    except (OSError, ValueError, TypeError, KeyError):
        return 0


def write_cursor(path, bucket, sequence):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"bucket": bucket, "sequence": sequence}))
    temporary.replace(path)


def connect():
    import psycopg2

    return psycopg2.connect(
        os.environ["KINDRED_R2_CATALOG_DATABASE_URL"], connect_timeout=8,
        options="-c statement_timeout=12000",
    )


def sync_catalog(checkpoint_path: Path, bucket: str, stopped: Event):
    cursor_path = checkpoint_path.with_suffix(".catalog.json")
    uri = f"{checkpoint_path.resolve().as_uri()}?mode=ro"
    while not stopped.is_set():
        try:
            with closing(sqlite3.connect(uri, uri=True, timeout=10)) as db, closing(connect()) as connection:
                after = read_cursor(cursor_path, bucket)
                latest = db.execute("SELECT COALESCE(max(sequence), 0) FROM catalog_publications").fetchone()[0]
                if not 0 <= after <= latest:
                    after = 0
                while not stopped.is_set():
                    sequence = sync_batch(db, connection, bucket, after)
                    if sequence == after:
                        stopped.wait(10)
                    else:
                        write_cursor(cursor_path, bucket, sequence)
                        after = sequence
        except Exception as exc:
            log.warning("Thumbnail catalog sync will retry (%s)", type(exc).__name__)
            stopped.wait(15)


def resync_catalog(client, bucket, connection):
    """Backfill all thumbnail keys actually present in R2 without uploading again."""
    count = 0
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=THUMBNAIL_PREFIX):
        keys = []
        for item in page.get("Contents", []):
            key = item["Key"]
            if key.endswith(".jpg") and key_for(key[len(THUMBNAIL_PREFIX):-4]) == key:
                keys.append(key)
        if keys:
            record_keys(connection, bucket, keys)
            count += len(keys)
    return count


if __name__ == "__main__":
    configured = storage()
    if not configured:
        raise SystemExit("Configure R2 before resyncing the thumbnail catalog")
    with closing(connect()) as connection:
        print(f"Reconciled {resync_catalog(*configured, connection):,} thumbnail keys from R2")
