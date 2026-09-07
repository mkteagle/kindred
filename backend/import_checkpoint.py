"""Incremental import receipts with compatible JSON snapshots and a durable journal.

Callers must hold the existing shared import lock from load through all saves.
A newline-terminated, checksummed record is the commit unit. An interrupted final
write is ignored; corruption of a complete record stops recovery rather than
silently forgetting imported originals.
"""
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile

COMPACT_EVERY = 10_000


class Progress(dict):
    sequence = 0
    snapshot_sequence = 0
    valid_journal_bytes = 0
    torn_tail = False
    last_saved_state = None


def journal_path(path):
    return Path(str(path) + '.journal')


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_write(path, value):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix=path.name + '.', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, separators=(',', ':'), ensure_ascii=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load(path):
    data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    if not isinstance(data, dict):
        raise ValueError('Checkpoint must be a JSON object')
    progress = Progress(data)
    progress.sequence = progress.pop('_journal_sequence', 0)
    if not isinstance(progress.sequence, int) or progress.sequence < 0:
        raise ValueError('Invalid checkpoint journal sequence')
    progress.snapshot_sequence = progress.sequence
    for section in ('completed', 'failed'):
        progress.setdefault(section, {})
        if not isinstance(progress[section], dict):
            raise ValueError(f'Invalid checkpoint {section}')
    journal = journal_path(path)
    if not journal.exists():
        return progress
    last_record = None
    with journal.open('rb') as stream:
        for raw in stream:
            if not raw.endswith(b'\n'):
                progress.torn_tail = True
                print('[checkpoint] ignoring incomplete final journal write', flush=True)
                break
            try:
                envelope = json.loads(raw)
                payload = envelope['payload']
                if sha256(payload.encode('utf-8')).hexdigest() != envelope['sha256']:
                    raise ValueError('checksum mismatch')
                record = json.loads(payload)
                if record['completed'] is not None and not isinstance(record['completed'], dict):
                    raise ValueError('invalid completed receipt')
                if record['failed'] is not None and not isinstance(record['failed'], str):
                    raise ValueError('invalid failure receipt')
                sequence = record['sequence']
                relative = record['relative']
                if not isinstance(sequence, int) or sequence < 1 or not isinstance(relative, str):
                    raise ValueError('invalid record fields')
                if last_record is not None and sequence != last_record + 1:
                    raise ValueError('nonconsecutive journal records')
                last_record = sequence
                if sequence > progress.sequence:
                    if sequence != progress.sequence + 1:
                        raise ValueError('missing journal record')
                    for section in ('completed', 'failed'):
                        value = record[section]
                        if value is None:
                            progress[section].pop(relative, None)
                        else:
                            progress[section][relative] = value
                    progress.sequence = sequence
            except (ValueError, KeyError, TypeError) as exc:
                raise ValueError(f'Corrupt checkpoint journal at byte {progress.valid_journal_bytes}: {exc}') from exc
            progress.valid_journal_bytes += len(raw)
    return progress


def save(path, progress, relative=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not isinstance(progress, Progress):
        journal = journal_path(path)
        if journal.exists() and journal.stat().st_size:
            raise ValueError('Refusing plain-dictionary save with a nonempty journal; load the merged checkpoint first')
    if relative is None or not isinstance(progress, Progress):
        # Also supports old callers passing ordinary dictionaries. Persist the
        # merged snapshot before clearing its journal; either crash order replays.
        snapshot = dict(progress)
        if isinstance(progress, Progress):
            snapshot['_journal_sequence'] = progress.sequence
        atomic_write(path, snapshot)
        journal = journal_path(path)
        if journal.exists():
            with journal.open('wb') as stream:
                stream.flush()
                os.fsync(stream.fileno())
        if isinstance(progress, Progress):
            progress.snapshot_sequence = progress.sequence
            progress.valid_journal_bytes = 0
            progress.torn_tail = False
        return
    record = dict(relative=relative, completed=progress['completed'].get(relative),
                  failed=progress['failed'].get(relative))
    state = json.dumps(record, separators=(',', ':'), sort_keys=True)
    if progress.last_saved_state == state:
        return
    record['sequence'] = progress.sequence + 1
    payload = json.dumps(record, separators=(',', ':'), ensure_ascii=True)
    raw = (json.dumps(dict(payload=payload, sha256=sha256(payload.encode('utf-8')).hexdigest()),
                      separators=(',', ':')) + '\n').encode('utf-8')
    journal = journal_path(path)
    created = not journal.exists()
    with journal.open('a+b') as stream:
        if progress.torn_tail:
            stream.truncate(progress.valid_journal_bytes)
            stream.seek(0, os.SEEK_END)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    if created:
        sync_directory(path.parent)
    progress.sequence += 1
    progress.last_saved_state = state
    progress.valid_journal_bytes += len(raw)
    progress.torn_tail = False
    if progress.sequence - progress.snapshot_sequence >= COMPACT_EVERY:
        save(path, progress)


def compact(path):
    """Export the complete legacy JSON checkpoint before an older-image rollback."""
    from staged_import import import_lock
    path = Path(path)
    with import_lock(path):
        progress = load(path)
        save(path, progress)
        print(f'Compacted checkpoint: {len(progress["completed"]):,} completed receipts', flush=True)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Compact a journal into its compatible JSON snapshot')
    parser.add_argument('path', nargs='?', default='/app/data/staged-import-progress.json')
    compact(parser.parse_args().path)
