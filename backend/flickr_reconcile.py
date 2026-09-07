#!/usr/bin/env python3
"""Read-only Flickr/NAS reconciliation. No download, upload, delete or SQL writes."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.parse


def local_status(root, row, verify_hash=False):
    key = row.get('nas_key')
    if not key:
        return 'missing'
    path = Path(key)
    if path.is_absolute() or '..' in path.parts:
        return 'unsafe_path'
    root = Path(root).resolve()
    path = (root / path).resolve()
    if root not in path.parents:
        return 'unsafe_path'
    try:
        if not path.is_file():
            return 'missing'
        before = path.stat()
        expected_size = row.get('byte_size')
        if expected_size is None:
            return 'size_unknown'
        if before.st_size != expected_size:
            return 'size_mismatch'
        if not verify_hash:
            return 'present_not_hashed'
        expected = row.get('sha256')
        if not expected:
            return 'checksum_unknown'
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        after = path.stat()
        if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            return 'changed_during_check'
        return 'verified' if digest.hexdigest() == expected else 'checksum_mismatch'
    except OSError:
        return 'unreadable'


def build_links(rows, manifests, owner):
    catalog = {str(row['photo_id']): row for row in rows}
    links = defaultdict(list)
    for row in rows:
        if row.get('flickr_id'):
            links[str(row['flickr_id'])].append({'photo_id': str(row['photo_id']), 'relationship': 'catalog_copy'})
    issues = []
    for photo_id, manifest in manifests:
        photo_id = str(photo_id)
        if manifest.get('owner_id') != owner:
            issues.append({'photo_id': photo_id, 'reason': 'manifest_owner_unverified'})
        trusted = manifest.get('owner_id') == owner and photo_id in catalog
        if trusted and (not manifest.get('sha256') or manifest.get('sha256') != catalog[photo_id].get('sha256')):
            trusted = False
            issues.append({'photo_id': photo_id, 'reason': 'manifest_checksum_unverified'})
        for number, part in manifest.get('parts', {}).items():
            remote_id = part.get('flickr_id')
            if not remote_id:
                continue
            links[str(remote_id)].append({'photo_id': photo_id,
                'relationship': 'video_part' if trusted else 'unverified_video_part',
                'part': number, 'start': part.get('start'), 'duration': part.get('duration')})
    return catalog, links, issues


def classify(remote, catalog, links, status_cache, root, verify_hash=False):
    references = links.get(str(remote['id']), [])
    result = {'flickr_id': str(remote['id']), 'media': remote.get('media', 'photo'),
              'original_format': remote.get('originalformat'), 'links': references}
    identities = {ref['photo_id'] for ref in references}
    if len(identities) > 1 or any(r['relationship'] == 'unverified_video_part' for r in references):
        result['action'] = 'review_ambiguous_mapping'
        return result
    if not identities:
        # Never call an unmatched video thumbnail an original movie.
        result['action'] = 'resolve_video_original' if result['media'] == 'video' else 'download_candidate'
        return result
    photo_id = next(iter(identities))
    row = catalog[photo_id]
    if photo_id not in status_cache:
        status_cache[photo_id] = local_status(root, row, verify_hash)
    status = status_cache[photo_id]
    result.update(kindred_photo_id=photo_id, original_filename=row.get('original_filename'),
                  nas_key=row.get('nas_key'), nas_status=status)
    suffix = Path(row.get('original_filename') or row.get('nas_key') or '').suffix.lower()
    if any(ref['relationship'] == 'video_part' for ref in references):
        result['conversion'] = 'video_derivative'
    elif suffix in ('.heic', '.heif') and result.get('original_format') in ('jpg', 'jpeg'):
        result['conversion'] = 'heif_to_jpeg_inferred_from_linked_formats'
    else:
        result['conversion'] = 'linked_copy'
    result['action'] = {'verified': 'skip_verified_original',
                        'present_not_hashed': 'linked_requires_hash',
                        'missing': 'recover_missing_original'}.get(status, 'review_local_integrity')
    return result


def api(main, creds, method, **parameters):
    import httpx
    url = 'https://api.flickr.com/services/rest'
    params = {'method': method, 'format': 'json', 'nojsoncallback': '1', **parameters}
    for attempt in range(3):
        signed = main._flickr_oauth_sign(url, params, creds)
        header = 'OAuth ' + ', '.join(f'{k}="{urllib.parse.quote(str(v), "")}"' for k, v in signed.items())
        try:
            response = httpx.get(url, params=params, headers={'Authorization': header}, timeout=60)
            response.raise_for_status()
            data = response.json()
            if data.get('stat') != 'ok':
                raise RuntimeError('Flickr API failure: ' + str(data.get('code')))
            return data
        except (httpx.HTTPError, ValueError):
            if attempt == 2:
                raise RuntimeError('Flickr request failed after retries') from None
            time.sleep(2 ** attempt)


def run(args):
    import main
    from video_queue import queue_root
    creds = main.get_flickr_credentials()
    if not creds or not creds.get('user_id'):
        raise RuntimeError('Flickr credentials with owner ID required')
    owner = str(creds['user_id'])
    logged_in = api(main, creds, 'flickr.test.login')['user']['id']
    if str(logged_in) != owner:
        raise RuntimeError('Flickr credential owner mismatch')
    rows = main.db_query('''SELECT p.id::text photo_id, p.original_filename, p.sha256,
        p.byte_size, n.provider_key nas_key, f.provider_key flickr_id
        FROM photos p
        LEFT JOIN photo_copies n ON n.photo_id=p.id AND n.provider='nas'
        LEFT JOIN photo_copies f ON f.photo_id=p.id AND f.provider='flickr' ''')
    manifests, errors = [], []
    for path in sorted(queue_root().glob('*/manifest.json')):
        try:
            manifest = json.loads(path.read_text())
            if not isinstance(manifest.get('parts'), dict) or not all(isinstance(v, dict) for v in manifest['parts'].values()):
                raise ValueError('Invalid manifest parts')
            manifests.append((path.parent.name, manifest))
        except (OSError, ValueError, AttributeError):
            errors.append({'photo_id': path.parent.name, 'reason': 'unreadable_manifest'})
    catalog, links, issues = build_links(rows, manifests, owner)
    cutoff = int(time.time()) - 1
    report = {'mode': 'dry_run', 'owner_id': owner, 'hash_verification': args.verify_sha256,
              'max_upload_date': cutoff, 'content_types': '0,1,2,3', 'safe_search': 3,
              'started_at': datetime.now(timezone.utc).isoformat(),
              'complete': False, 'issues': errors + issues, 'items': []}
    seen, statuses, totals = set(), {}, set()
    page, expected_pages = 1, None
    while True:
        data = api(main, creds, 'flickr.people.getPhotos', user_id=owner, per_page=500,
                   page=page, extras='media,original_format', max_upload_date=cutoff,
                   content_types='0,1,2,3', safe_search=3)['photos']
        totals.add(int(data['total']))
        pages = int(data['pages'])
        if expected_pages is None:
            expected_pages = pages
        elif pages != expected_pages:
            report['issues'].append({'reason': 'pagination_changed_during_scan'})
        for remote in data['photo']:
            if str(remote.get('owner')) != owner:
                raise RuntimeError('Unexpected owner in Flickr inventory')
            if str(remote['id']) in seen:
                report['issues'].append({'reason': 'duplicate_remote_id_during_pagination'})
                continue
            seen.add(str(remote['id']))
            report['items'].append(classify(remote, catalog, links, statuses,
                                            main.PHOTO_STORAGE_ROOT, args.verify_sha256))
        print(f'[reconcile] page={page}/{pages} items={len(seen)}', file=sys.stderr, flush=True)
        if page >= pages or (args.max_pages and page >= args.max_pages):
            pagination_issues = any(issue['reason'] in (
                'pagination_changed_during_scan', 'duplicate_remote_id_during_pagination'
            ) for issue in report['issues'])
            report['complete'] = (page >= pages and len(totals) == 1
                                  and len(seen) == next(iter(totals)) and not pagination_issues)
            break
        page += 1
    report['summary'] = dict(Counter(item['action'] for item in report['items']))
    report['remote_items'] = len(seen)
    report['reported_totals'] = sorted(totals)
    report['finished_at'] = datetime.now(timezone.utc).isoformat()
    report['limitations'] = ['Live account changes can invalidate pagination; repeat before recovery.',
        'Uploads after max_upload_date are excluded and require a later incremental scan.',
        'Unmatched items may have unlinked NAS copies; candidates are not proof of absence.',
        'No media URLs resolved, downloads performed, album backup or cloud cleanup authorization.',
        'Video originals need explicit source resolution; thumbnails are never video backups.']
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        output.write(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ('complete', 'remote_items', 'summary', 'reported_totals')}))
    return 0 if report['complete'] else 2


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify-sha256', action='store_true', help='Read/hash linked NAS originals (disk intensive)')
    parser.add_argument('--max-pages', type=int, help='Bound metadata requests for a sample; incomplete reports exit 2')
    args = parser.parse_args()
    if args.max_pages is not None and args.max_pages < 1:
        parser.error('--max-pages must be positive')
    sys.exit(run(args))
