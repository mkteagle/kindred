"""Relocate managed videos intact; default dry run, explicit --apply for mutation.

Create a same-filesystem hardlink, replace the old path atomically with an alias,
then update SQL. Every crash boundary keeps both old and new consumers readable.
Staged source paths and checkpoint receipt IDs are deliberately unchanged.
"""
import argparse
import fcntl
from hashlib import sha256
import os
from pathlib import Path
import uuid


def checksum(path):
    digest = sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def migrate_one(root, row, update, apply=False):
    root = Path(root).resolve()
    photo_id = str(uuid.UUID(str(row['photo_id'])))
    key = row['provider_key']
    old = root / key
    # Only the known managed layout is eligible; reject arbitrary catalog paths.
    if (Path(key).is_absolute() or len(Path(key).parts) != 3
            or Path(key).parts[:2] != (photo_id[:2], photo_id)
            or not old.name.startswith('original.')):
        raise ValueError(f'Unexpected legacy original path: {key}')
    new = root / 'videos' / key
    if not old.resolve().is_relative_to(root) or not new.resolve().is_relative_to(root):
        raise ValueError('Original path escapes storage root')
    expected = row['sha256']
    if not expected or checksum(old) != expected:
        raise ValueError(f'Original checksum mismatch: {photo_id}')
    if new.exists() and checksum(new) != expected:
        raise ValueError(f'Destination checksum mismatch: {photo_id}')
    new_key = new.relative_to(root).as_posix()
    if not apply:
        return new_key
    new.parent.mkdir(parents=True, exist_ok=True)
    if not new.exists():
        # Never copy/delete an 8GB original or silently cross filesystems.
        os.link(old.resolve(), new)
        for directory in (new.parent, new.parent.parent, new.parent.parent.parent, root):
            sync_directory(directory)
    if checksum(new) != expected:
        raise ValueError(f'Migrated checksum mismatch: {photo_id}')
    if not old.is_symlink() or old.resolve() != new.resolve():
        temporary = old.with_name('.video-alias-' + uuid.uuid4().hex)
        try:
            temporary.symlink_to(os.path.relpath(new, old.parent))
            os.replace(temporary, old)
            sync_directory(old.parent)
        finally:
            temporary.unlink(missing_ok=True)
    # Existing album links and queued job paths resolve through the legacy alias.
    # If SQL fails, retrying this exact row safely completes the migration.
    update(photo_id, key, new_key)
    return new_key


def run(apply=False):
    import main
    root = Path(os.environ['PHOTO_STORAGE_ROOT'])
    with (root / '.video-migration.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        rows = main.db_query("""SELECT n.photo_id, n.provider_key, n.sha256
            FROM photo_copies n JOIN photos p ON p.id=n.photo_id
            WHERE n.provider='nas' AND n.status='available'
              AND p.media_type LIKE 'video/%%' AND n.provider_key NOT LIKE 'videos/%%'
            ORDER BY n.photo_id""")
        def update(photo_id, old_key, new_key):
            main.db_query("""UPDATE photo_copies SET provider_key=%s, storage_path=%s,
                updated_at=now() WHERE photo_id=%s AND provider='nas' AND provider_key=%s""",
                (new_key, new_key, photo_id, old_key), fetch=False)
        for row in rows:
            destination = migrate_one(root, row, update, apply)
            print(('migrated' if apply else 'would migrate'), row['photo_id'], destination, flush=True)
        if apply:
            main.invalidate_cache('timeline')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    run(parser.parse_args().apply)
