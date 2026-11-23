"""Bootstrap a dedicated App Review installation from generated sample photos."""
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import os
import secrets
from urllib.parse import urlsplit

from psycopg2.extras import RealDictCursor

from db_migrations import apply_migrations
from preview_delivery import ensure_thumbnail
from storage import LocalStorageProvider
import main


ALBUMS = {
    "Camping at the Lake": (
        "lakeside-campfire", "first-light-canoe", "dog-at-the-lake",
        "cooking-at-camp", "morning-mountain-trail", "lantern-in-the-tent",
    ),
    "Around the House": (
        "making-a-birthday-cake", "cat-on-a-blanket", "birthday-candles",
        "dinner-in-the-garden", "fresh-bread", "dog-at-the-garden-gate",
    ),
}
DATASET = "kindred_app_review"


def seed(fixtures):
    if os.getenv("KINDRED_APP_REVIEW") != "1" or urlsplit(main.DATABASE_URL).path != f"/{DATASET}":
        raise SystemExit("The review seed requires KINDRED_APP_REVIEW=1 and a dedicated kindred_app_review database.")
    password = os.environ.get("KINDRED_REVIEW_PASSWORD", "")
    if not 16 <= len(password.encode()) <= 72:
        raise SystemExit("Set KINDRED_REVIEW_PASSWORD to a unique password between 16 and 72 UTF-8 bytes.")
    if not main.PHOTO_STORAGE_ROOT or main.FLICKR_API_KEY or main.FLICKR_OAUTH_TOKEN or os.getenv("KINDRED_R2_BUCKET"):
        raise SystemExit("Review requires dedicated local storage and no Flickr or R2 credentials.")
    files = {f.stem: f for f in Path(fixtures).glob("*.jpg")}
    if any(photo not in files for photos in ALBUMS.values() for photo in photos):
        raise SystemExit("The review photos directory is incomplete.")

    apply_migrations()
    with closing(main.get_db()) as conn, conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT pg_advisory_xact_lock(4921733102)")
        owners = main.household_lifecycle.lock(cur)
        cur.execute("SELECT 1 FROM settings WHERE key = %s", (DATASET,))
        if not cur.fetchone():
            cur.execute("SELECT EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM photos) AS occupied")
            if cur.fetchone()["occupied"]:
                raise SystemExit("The review seed can only initialize an empty database.")
            cur.execute("""
                INSERT INTO users (username, display_name, password_hash, role)
                VALUES ('review-owner', 'Sample Household Owner', %s, 'admin') RETURNING id
            """, (main.hash_password(secrets.token_urlsafe(40)),))
            owner = str(cur.fetchone()["id"])
            cur.execute("INSERT INTO settings (key, value) VALUES (%s, '1')", (DATASET,))
        else:
            if len(owners) != 1:
                raise SystemExit("The review database must have one sample household owner.")
            owner, = owners
        cur.execute("""
            INSERT INTO users (username, display_name, password_hash, role)
            VALUES ('kindred-reviewer', 'App Review', %s, 'admin')
            ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
            RETURNING id
        """, (main.hash_password(password),))
        reviewer = str(cur.fetchone()["id"])

    storage = LocalStorageProvider(main.PHOTO_STORAGE_ROOT)
    for index, (name, photos) in enumerate(ALBUMS.items()):
        date = datetime(2025 - index, 11, 12, 16, tzinfo=timezone.utc)
        items = []
        for photo in photos:
            path = files[photo]
            title = photo.replace("-", " ").title()
            stored = main._store_nas_original(
                str(path), path.name, "image/jpeg", title, f"Fictional example from {name}.",
                int(date.timestamp()), None, None, f"app-review-fixture-{photo}",
            )
            photo_id = stored["kindred_photo_id"]
            ensure_thumbnail(photo_id, storage.resolve_local_path(stored["provider_key"]))
            items.append(photo_id)
        with closing(main.get_db()) as conn, conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO albums (name, slug, created_by)
                VALUES (%s, %s, %s) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id
            """, (name, main.album_slug(name), owner))
            album_id = cur.fetchone()[0]
            cur.executemany("""
                INSERT INTO album_photos (album_id, photo_id, added_by)
                VALUES (%s, %s, %s) ON CONFLICT DO NOTHING
            """, [(album_id, item, owner) for item in items])
            cur.executemany("""
                INSERT INTO photo_favorites (user_id, photo_id)
                VALUES (%s, %s) ON CONFLICT DO NOTHING
            """, [(reviewer, items[0]), (reviewer, items[2])])

    print(f"Seeded {sum(map(len, ALBUMS.values()))} fictional photos and {len(ALBUMS)} albums for kindred-reviewer.")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixtures", type=Path)
    seed(parser.parse_args().fixtures)
