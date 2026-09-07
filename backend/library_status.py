#!/usr/bin/env python3
"""Print reconciled Kindred catalog/index counts from inside the API container."""

from __future__ import annotations

import json
import os
from pathlib import Path

import main
from storage.local import managed_originals


def scalar(sql: str) -> int:
    rows = main.db_query(sql)
    return int(rows[0]["count"]) if rows else 0


storage_root = Path(os.environ["PHOTO_STORAGE_ROOT"])
status = {
    "catalog_total": scalar("SELECT count(*) FROM photos"),
    "catalog_images": scalar(
        "SELECT count(*) FROM photos WHERE media_type LIKE 'image/%'"
    ),
    "catalog_videos": scalar(
        "SELECT count(*) FROM photos WHERE media_type LIKE 'video/%'"
    ),
    "nas_available": scalar(
        "SELECT count(*) FROM photo_copies WHERE provider='nas' AND status='available'"
    ),
    "flickr_available": scalar(
        "SELECT count(*) FROM photo_copies WHERE provider='flickr' AND status='available'"
    ),
    "indexed_images": scalar(
        """
        SELECT count(DISTINCT p.id)
        FROM photos p
        LEFT JOIN photo_copies f ON f.photo_id=p.id AND f.provider='flickr'
        JOIN processed_photos done
          ON done.photo_id IN (p.id::text, f.provider_key)
        WHERE p.media_type LIKE 'image/%'
        """
    ),
    "image_embeddings": scalar("SELECT count(*) FROM photo_embeddings"),
    "detections": scalar("SELECT count(*) FROM detections"),
    "face_detections": scalar(
        "SELECT count(*) FROM detections WHERE category='people'"
    ),
    "object_detections": scalar(
        "SELECT count(*) FROM detections WHERE category IN ('pets','vehicles')"
    ),
    "managed_original_files": sum(
        1 for _ in managed_originals(storage_root)
    ),
    "thumbnail_files": sum(
        1 for _ in Path("/app/data/thumbnails").glob("*.jpg")
    ),
}
status["images_pending_index"] = max(
    status["catalog_images"] - status["indexed_images"], 0
)
print(json.dumps(status, indent=2, sort_keys=True))
