"""Restore Google albums and favorites using verified NAS consolidation receipts.

Run with the extracted Google Photos directory for one account, the NAS
consolidation ledger, and that member's Kindred user ID. Defaults to a dry run.
"""

import argparse
from contextlib import closing
from functools import lru_cache
import hashlib
from itertools import chain
import json
import re
import sqlite3
from pathlib import Path
import uuid

from capture_date import sidecar_for
from staged_import import SUPPORTED_EXTENSIONS


def read_json(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def is_favorite(data):
    return any(data.get(key) is True for key in ("favorited", "isFavorite"))


def evidence(archive, ledger, canonical_root):
    """Yield only exact duplicate receipts, including files since consolidated."""
    prefix = archive.as_posix().rstrip("/") + "/"

    @lru_cache(maxsize=None)
    def album_name(folder):
        if re.fullmatch(r"Photos from \d{4}", folder):
            return None
        title = read_json(archive / folder / "metadata.json").get("title")
        return title.strip() if isinstance(title, str) and title.strip() else None

    rows = ledger.execute("""
        SELECT path, canonical, sha256, size FROM checked
        WHERE path >= ? AND path < ? AND canonical IS NOT NULL AND sha256 IS NOT NULL
          AND status IN ('verified_pending_unlink', 'removed_exact_duplicate')
        ORDER BY path
    """, (prefix, prefix[:-1] + "0"))
    for source, canonical, digest, size in rows:
        source = Path(source)
        file_parts = source.relative_to(archive).parts
        try:
            relative = Path(canonical).relative_to(canonical_root).as_posix()
        except ValueError:
            continue
        folder = file_parts[0] if len(file_parts) > 1 else ""
        title = album_name(folder) if folder else None
        sidecar = sidecar_for(source)
        favorite = bool(sidecar and is_favorite(read_json(sidecar)))
        if title or favorite:
            yield (relative, digest, size, folder, title, favorite)


def fingerprint(path):
    """Read a stable original's digest without relying on its filename."""
    try:
        before = path.stat()
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        after = path.stat()
    except OSError:
        return None
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns
    ):
        return digest, before.st_size
    return None


def retained_favorites(archive):
    """Reconcile favorite originals still in the export by their full digest."""
    for sidecar in archive.rglob("*.json"):
        if sidecar.name == "metadata.json" or sidecar.is_symlink():
            continue
        metadata = read_json(sidecar)
        title = metadata.get("title")
        if not is_favorite(metadata) or not isinstance(title, str) or not title or Path(title).name != title:
            continue
        path = sidecar.with_name(title)
        if path.is_symlink() or not path.is_file() or sidecar_for(path) != sidecar:
            continue
        if result := fingerprint(path):
            yield ("", *result, "", None, True)


def selected_favorites(directory):
    """Use the original media in a member's explicitly selected Favorites export."""
    for path in directory.rglob("*"):
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS or path.is_symlink() or not path.is_file():
            continue
        if result := fingerprint(path):
            yield ("", *result, "", None, True)


def match_catalog(cursor, rows, source_key):
    from psycopg2.extras import execute_values

    return execute_values(cursor, """
        WITH receipts (relative_path, sha256, byte_size, folder, title, favorite, source_key) AS (VALUES %s)
        SELECT COALESCE(exact.id, canonical.id), r.folder, r.title, r.favorite
        FROM receipts r
        LEFT JOIN photos exact ON exact.sha256 = r.sha256 AND exact.byte_size = r.byte_size
        LEFT JOIN nas_source_files source ON source.source_key = r.source_key
            AND source.relative_path = r.relative_path AND source.byte_size = r.byte_size
        LEFT JOIN photos canonical ON canonical.id = source.photo_id
            AND (canonical.sha256 IS NULL OR canonical.sha256 = r.sha256)
    """,
        [(*row, source_key) for row in rows], page_size=len(rows), fetch=True)


def sync(connection, items, user_id, source_key, apply=False):
    from itertools import islice
    from psycopg2.extras import execute_values

    albums = {}
    favorites = set()
    unmatched = 0
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM users WHERE id = %s", (user_id,))
        if not cursor.fetchone():
            raise ValueError("Kindred user not found")
        while batch := list(islice(items, 500)):
            for photo_id, folder, title, favorite in match_catalog(cursor, batch, source_key):
                if not photo_id:
                    unmatched += 1
                    continue
                if favorite:
                    favorites.add(photo_id)
                if title:
                    albums.setdefault(folder, (title, set()))[1].add(photo_id)
        if apply:
            if favorites:
                execute_values(cursor, """
                    INSERT INTO photo_favorites (photo_id, user_id) VALUES %s
                    ON CONFLICT (photo_id, user_id) DO NOTHING
                """, [(photo_id, user_id) for photo_id in favorites])
            for folder, (title, photo_ids) in albums.items():
                digest = hashlib.sha256(f"{user_id}/{folder}".encode()).hexdigest()[:24]
                slug = f"google-{digest}"
                cursor.execute("""
                    INSERT INTO albums (name, slug, created_by) VALUES (%s, %s, %s)
                    ON CONFLICT (slug) DO NOTHING
                """, (title, slug, user_id))
                cursor.execute("SELECT id FROM albums WHERE slug = %s AND created_by = %s", (slug, user_id))
                album = cursor.fetchone()
                if not album:
                    raise ValueError("Google album slug conflicts with a different owner")
                execute_values(cursor, """
                    INSERT INTO album_photos (album_id, photo_id, added_by) VALUES %s
                    ON CONFLICT (album_id, photo_id) DO NOTHING
                """, [(album[0], photo_id, user_id) for photo_id in photo_ids])
    return {"albums": len(albums), "album_memberships": sum(len(ids) for _, ids in albums.values()),
            "favorites": len(favorites), "unmatched_receipts": unmatched, "applied": apply}


def main():
    import os
    import psycopg2

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Extracted Google Photos directory")
    parser.add_argument("ledger", type=Path, help="NAS consolidation SQLite ledger")
    parser.add_argument("canonical_root", type=Path, help="Original library path recorded in the ledger")
    parser.add_argument("--user-id", type=uuid.UUID, required=True, help="Kindred member who owns this export")
    parser.add_argument("--source-key", default="family-photos")
    parser.add_argument("--favorites-dir", type=Path, help="Import only favorites from this member's selected Google Photos export")
    parser.add_argument("--apply", action="store_true", help="Write matched album memberships and favorites")
    args = parser.parse_args()
    if not args.archive.is_dir():
        parser.error("The extracted Google Photos directory does not exist")
    if args.favorites_dir and not args.favorites_dir.is_dir():
        parser.error("The exported Favorites directory does not exist")
    with closing(sqlite3.connect(args.ledger.resolve().as_uri() + "?mode=ro", uri=True)) as ledger:
        with closing(psycopg2.connect(os.environ["DATABASE_URL"])) as connection, connection:
            connection.set_session(readonly=not args.apply)
            archive = args.archive.resolve()
            if args.favorites_dir:
                items = selected_favorites(args.favorites_dir.resolve())
            else:
                items = chain(evidence(archive, ledger, args.canonical_root), retained_favorites(archive))
            print(json.dumps(sync(connection, items, str(args.user_id), args.source_key, args.apply)))


if __name__ == "__main__":
    main()
