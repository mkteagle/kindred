"""The timeline's on-disk fallback must not re-add photos the catalog knows.

Originals are the durable source of truth, so `/timeline` folds NAS files the
database has no row for into the page. The catalog check has to be a real
lookup: a photo that is merely on an older page is still indexed, and file
mtime is the import date, so treating "absent from this page" as "unindexed"
collapses the whole library into the current month.
"""
from __future__ import annotations

import ast
import os
import tempfile
import unittest
import uuid as uuid_module
from datetime import datetime, timezone
from pathlib import Path

from storage.local import managed_originals

VIDEO_EXTENSIONS = {'.mp4', '.mov'}


def load_merge(storage_root: str, db_query):
    """Exec the route helper out of main.py with its module globals stubbed."""
    tree = ast.parse((Path(__file__).parents[1] / 'main.py').read_text())
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                    and n.name == '_merge_unindexed_originals')
    namespace = dict(managed_originals=managed_originals, Path=Path, uuid=uuid_module,
                     datetime=datetime, timezone=timezone,
                     VIDEO_EXTENSIONS=VIDEO_EXTENSIONS,
                     PHOTO_STORAGE_ROOT=storage_root,
                     PUBLIC_API_URL='https://api.test', db_query=db_query)
    exec(compile(ast.Module(body=[function], type_ignores=[]), '<merge>', 'exec'), namespace)
    return namespace['_merge_unindexed_originals']


class TimelineMergeTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.ids = [str(uuid_module.uuid4()) for _ in range(3)]
        for photo_id in self.ids:
            original = self.root / photo_id[:2] / photo_id / 'original.jpg'
            original.parent.mkdir(parents=True)
            original.write_bytes(b'jpeg')
            # Imported today; the capture date lives in the catalog, not here.
            stamp = datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp()
            os.utime(original, (stamp, stamp))
        self.queries = []

    def tearDown(self):
        self._tmp.cleanup()

    def catalog(self, known_ids):
        def db_query(sql, params=()):
            self.queries.append((sql, params))
            wanted = set(params[0]) if params else set()
            return [{'photo_id': i} for i in known_ids if i in wanted]
        return db_query

    def test_catalogued_photos_off_the_page_are_not_re_added_by_mtime(self):
        # The page shows one photo; the other two are catalogued, older pages.
        page = [{'month': '2014-05', 'count': 1, 'photos': [
            {'photo_id': self.ids[0], 'date_taken': '2014-05-02'}]}]
        merge = load_merge(str(self.root), self.catalog(self.ids))
        merge(page, 3, 'all', '')
        self.assertEqual([b['month'] for b in page], ['2014-05'])
        self.assertEqual(page[0]['count'], 1)
        self.assertNotIn('2026-09', {b['month'] for b in page})

    def test_a_genuinely_unindexed_original_still_appears(self):
        # Only the paged photo is in the catalog; the other two are orphans.
        page = [{'month': '2014-05', 'count': 1, 'photos': [
            {'photo_id': self.ids[0], 'date_taken': '2014-05-02'}]}]
        merge = load_merge(str(self.root), self.catalog(self.ids[:1]))
        merge(page, 3, 'all', '')
        months = {b['month']: b for b in page}
        self.assertIn('2026-09', months)
        self.assertEqual(months['2026-09']['count'], 2)
        self.assertEqual(months['2014-05']['count'], 1)

    def test_the_catalog_is_asked_once_not_once_per_file(self):
        page = [{'month': '2014-05', 'count': 0, 'photos': []}]
        merge = load_merge(str(self.root), self.catalog(self.ids))
        merge(page, 3, 'all', '')
        self.assertEqual(len(self.queries), 1)
        self.assertEqual(sorted(self.queries[0][1][0]), sorted(self.ids))

    def test_no_candidates_means_no_query(self):
        page = [{'month': '2014-05', 'count': 3, 'photos': [
            {'photo_id': i, 'date_taken': '2014-05-02'} for i in self.ids]}]
        merge = load_merge(str(self.root), self.catalog(self.ids))
        merge(page, 3, 'all', '')
        self.assertEqual(self.queries, [])


if __name__ == '__main__':
    unittest.main()
