"""Unit checks plus optional PostgreSQL integration using only temporary tables."""
import ast
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
from import_activity import history


class ActivityValidationTests(unittest.TestCase):
    def test_rejects_invalid_filters_and_cursors_before_query(self):
        for kwargs in ({'kind':'secret'}, {'limit':101}, {'limit':0}, {'search':'x'*201},
                       {'cursor':'bad'}, {'cursor':'x'*1025},
                       {'cursor':base64.urlsafe_b64encode(b'["2026-01-01", "a"]').decode()}):
            query = Mock()
            with self.assertRaises(HTTPException):
                history(query, **kwargs)
            query.assert_not_called()

    def test_literal_search_is_parameterized(self):
        query = Mock(return_value=[])
        history(query, search="a%_\\'", kind='imported')
        sql, params = query.call_args.args
        self.assertNotIn("a%_", sql)
        self.assertEqual(params, ('imported', "%a\\%\\_\\\\'%", 51))

    def test_pagination_cursor_preserves_timestamp_and_tie_breaker(self):
        stamp = datetime(2026, 9, 10, tzinfo=timezone.utc)
        query = Mock(return_value=[dict(event_id='b', occurred_at=stamp), dict(event_id='a', occurred_at=stamp)])
        result = history(query, limit=1)
        self.assertEqual(len(result['events']), 1)
        query.return_value=[]
        history(query, cursor=result['next_cursor'])
        self.assertEqual(query.call_args.args[1], (stamp.isoformat(), 'b', 51))

    def test_route_requires_admin(self):
        path = Path(__file__).resolve().parents[1] / 'main.py'
        if not path.exists():
            path = Path('/app/main.py')
        tree = ast.parse(path.read_text())
        route = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'get_import_activity')
        self.assertTrue(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                            and n.func.id == 'Depends' and isinstance(n.args[0], ast.Name)
                            and n.args[0].id == 'require_admin' for n in route.args.defaults))


@unittest.skipUnless(os.environ.get('ACTIVITY_TEST_DATABASE_URL'), 'PostgreSQL integration database not configured')
class ActivityPostgresTests(unittest.TestCase):
    def setUp(self):
        import psycopg2
        from psycopg2.extras import RealDictCursor
        self.conn = psycopg2.connect(os.environ['ACTIVITY_TEST_DATABASE_URL'])
        self.cur = self.conn.cursor(cursor_factory=RealDictCursor)
        self.cur.execute('''
            SET LOCAL statement_timeout = '10s';
            CREATE TEMP TABLE photos (id uuid PRIMARY KEY, legacy_photo_id text, original_filename text, title text, created_at timestamptz);
            CREATE TEMP TABLE photo_copies (photo_id uuid, provider text, provider_key text);
            CREATE TEMP TABLE processed_photos (photo_id text, processed_at timestamptz);
            INSERT INTO photos VALUES
            ('00000000-0000-0000-0000-000000000001','123','family%_1.jpg','Family','2026-09-09T10:00:00Z'),
            ('00000000-0000-0000-0000-000000000002',NULL,'beach.heic','Beach','2026-09-09T10:00:00Z');
            INSERT INTO photo_copies VALUES ('00000000-0000-0000-0000-000000000001','flickr','123');
            INSERT INTO processed_photos VALUES
            ('123','2026-09-09T11:00:00Z'),
            ('00000000-0000-0000-0000-000000000002','2026-09-09T11:00:00Z'),
            ('unknown','2026-09-09T12:00:00Z'),
            ('------------------------------------','2026-09-09T12:00:00Z');
        ''')

    def tearDown(self):
        self.conn.rollback()
        self.conn.close()

    def query(self, sql, params):
        self.cur.execute(sql, params)
        return self.cur.fetchall()

    def test_history_resolves_both_identifiers_without_duplicate_mirror_rows(self):
        result = history(self.query)
        self.assertEqual(len(result['events']), 4)
        self.assertEqual([x['kind'] for x in result['events']], ['indexed','indexed','imported','imported'])
        self.assertIsNone(result['next_cursor'])

    def test_literal_filename_and_event_filters(self):
        result = history(self.query, search='%_',kind='indexed')
        self.assertEqual([x['filename'] for x in result['events']], ['family%_1.jpg'])

    def test_equal_timestamp_pagination_has_no_skips_or_duplicates(self):
        cursor=None
        events=[]
        for _ in range(5):
            result=history(self.query,cursor=cursor,limit=1)
            events.extend(x['event_id'] for x in result['events'])
            cursor=result['next_cursor']
            if not cursor: break
        self.assertEqual(len(events),4)
        self.assertEqual(len(set(events)),4)
        self.assertEqual(events,[x['event_id'] for x in history(self.query)['events']])


if __name__ == '__main__':
    unittest.main()
