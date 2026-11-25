"""Rebuild Kindred album membership from the verified household Flickr account."""

import asyncio

from fastapi import HTTPException


MIN_FLICKR_ALBUM_ITEMS = 2

# Ignore remote IDs with no verified household link. Older, ownerless copies
# are eligible only when the catalog carries the same legacy Flickr photo ID.
MATCHED_ITEMS = """
    FROM unnest(%s::text[]) WITH ORDINALITY AS r(flickr_id, position)
    JOIN photo_copies c ON c.provider = 'flickr'
        AND c.provider_key = r.flickr_id AND c.status = 'available'
    JOIN photos p ON p.id = c.photo_id
    WHERE c.provider_owner_id = %s
        OR (c.provider_owner_id IS NULL AND p.legacy_photo_id = r.flickr_id)
"""


def show_in_album_list(album):
    return (album.get("created_by") is not None or not album.get("flickr_photoset_id")
            or album["photo_count"] >= MIN_FLICKR_ALBUM_ITEMS)


async def _pages(call_flickr, creds, method, key, **params):
    page = 1
    while True:
        result = await call_flickr({
            "method": method, "user_id": creds["user_id"], "per_page": 500,
            "page": page, **params,
        }, creds)
        data = result.get(key)
        if not isinstance(data, dict):
            raise HTTPException(502, "Flickr returned an incomplete album listing")
        yield data
        if page >= int(data.get("pages", 1)):
            return
        page += 1


async def read_albums(call_flickr, creds):
    albums = []
    async for page in _pages(call_flickr, creds, "flickr.photosets.getList", "photosets"):
        for photoset in page.get("photoset", []):
            title = photoset.get("title", "")
            albums.append({
                "id": str(photoset["id"]),
                "title": title.get("_content", "") if isinstance(title, dict) else str(title),
                "photo_count": int(photoset.get("photos") or 0) + int(photoset.get("videos") or 0),
                "primary_photo_id": str(photoset["primary"]) if photoset.get("primary") else None,
            })
    return albums


def save_membership(query, album_id, flickr_ids, owner, primary):
    rows = query(f"""
        WITH matched AS (
            SELECT c.photo_id, r.flickr_id, r.position
            {MATCHED_ITEMS}
        ), saved AS (
            INSERT INTO album_photos (album_id, photo_id, flickr_synced_at)
            SELECT %s, photo_id, now() FROM matched
            ORDER BY photo_id
            ON CONFLICT (album_id, photo_id) DO UPDATE
            SET flickr_synced_at = EXCLUDED.flickr_synced_at, flickr_last_error = NULL
            WHERE album_photos.flickr_synced_at IS NULL OR album_photos.flickr_last_error IS NOT NULL
            RETURNING photo_id
        ), cover AS (
            SELECT photo_id, flickr_id FROM matched
            ORDER BY (flickr_id = %s) DESC NULLS LAST, position LIMIT 1
        ), updated AS (
            UPDATE albums SET cover_photo_id = cover.photo_id, updated_at = now()
            FROM cover WHERE albums.id = %s AND albums.cover_photo_id IS DISTINCT FROM cover.photo_id
            RETURNING albums.id
        )
        SELECT (SELECT count(*) FROM matched) AS matched,
               (SELECT count(*) FROM saved) AS saved,
               EXISTS (SELECT 1 FROM cover WHERE flickr_id = %s) AS primary_matched
    """, (flickr_ids, owner, album_id, primary, album_id, primary))
    return rows[0]


async def import_albums(call_flickr, query, adopt_album, creds):
    if not creds or not creds.get("verified"):
        raise HTTPException(409, "Connect and verify the household Flickr account first")

    totals = dict(albums=0, matched_items=0, unmatched_items=0, primary_covers=0, skipped_small_albums=0)
    photosets = await read_albums(call_flickr, creds)
    if not photosets:
        return totals
    existing = await asyncio.to_thread(query, """
        SELECT id, flickr_photoset_id FROM albums
        WHERE created_by IS NOT NULL AND flickr_photoset_id = ANY(%s)
    """, ([photoset["id"] for photoset in photosets],))
    user_albums = {album["flickr_photoset_id"]: album["id"] for album in existing}
    for photoset in photosets:
        photoset_id = photoset["id"]
        album_id = user_albums.get(photoset_id)
        if album_id is None and photoset["photo_count"] < MIN_FLICKR_ALBUM_ITEMS:
            totals["skipped_small_albums"] += 1
            continue
        flickr_ids = {}
        async for page in _pages(
            call_flickr, creds, "flickr.photosets.getPhotos", "photoset",
            photoset_id=photoset_id, media="all",
        ):
            for item in page.get("photo", []):
                flickr_ids[str(item["id"])] = None
        if album_id is None:
            match_count, = await asyncio.to_thread(
                query, f"SELECT count(DISTINCT c.photo_id) AS total {MATCHED_ITEMS}",
                (list(flickr_ids), creds["user_id"]),
            )
            if match_count["total"] < MIN_FLICKR_ALBUM_ITEMS:
                totals["skipped_small_albums"] += 1
                continue
            album = await asyncio.to_thread(adopt_album, photoset_id, photoset["title"])
            album_id = album["id"]
        saved = await asyncio.to_thread(
            save_membership, query, album_id, list(flickr_ids), creds["user_id"],
            photoset["primary_photo_id"],
        )
        totals["albums"] += 1
        totals["matched_items"] += saved["matched"]
        totals["unmatched_items"] += len(flickr_ids) - saved["matched"]
        totals["primary_covers"] += int(saved["primary_matched"])
    return totals
