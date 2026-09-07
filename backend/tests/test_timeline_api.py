import sqlite3
import unittest
from unittest.mock import Mock

from fastapi import HTTPException

from search_api import Facets
from timeline_api import month_key, months_page


class MonthKeyTests(unittest.TestCase):
    def test_handles_strings_and_datetimes(self):
        from datetime import datetime
        self.assertEqual(month_key(datetime(2024, 6, 1)), "2024-06")
        self.assertEqual(month_key("2024-06-01T10:00:00+00:00"), "2024-06")


class BoundsTests(unittest.TestCase):
    def test_refuses_to_return_an_unbounded_number_of_months(self):
        for months in (0, 25, 1000):
            with self.assertRaises(HTTPException):
                months_page(Mock(return_value=[]), Facets(), months=months)


class PagingTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE photos (id TEXT, legacy_photo_id TEXT, media_type TEXT,
                title TEXT, original_filename TEXT, taken_at TEXT, created_at TEXT,
                media_kind TEXT GENERATED ALWAYS AS (
                    CASE WHEN media_type LIKE 'video/%' THEN 'video' ELSE 'photo' END) STORED,
                duration_seconds REAL);
            CREATE TABLE photo_copies (photo_id TEXT, provider TEXT, status TEXT,
                provider_key TEXT, remote_url TEXT);
            INSERT INTO photos (id,media_type,title,original_filename,taken_at,created_at) VALUES
                ('a','image/jpeg','A','a.jpg','2024-06-02','2024-06-02'),
                ('b','image/jpeg','B','b.jpg','2024-06-01','2024-06-01'),
                ('c','video/mp4','C','c.mp4','2024-05-01','2024-05-01'),
                ('d','image/jpeg','D','d.jpg','2024-04-01','2024-04-01');
            INSERT INTO photo_copies VALUES
                ('a','nas','available','k1',NULL),('b','nas','available','k2',NULL),
                ('c','nas','available','k3',NULL),('d','nas','available','k4',NULL);
        """)

    def tearDown(self):
        self.db.close()

    def query(self, sql, params=()):
        # SQLite has no to_char or = ANY(array); express both its way.
        sql = (sql.replace("p.id::text", "CAST(p.id AS TEXT)")
                  .replace("to_char(p.taken_at, 'YYYY-MM')", "substr(p.taken_at,1,7)"))
        params = list(params)
        if "= ANY(%s)" in sql:
            index = [i for i, p in enumerate(params) if isinstance(p, list)][0]
            values = params.pop(index)
            sql = sql.replace("= ANY(%s)", f"IN ({','.join('%s' for _ in values)})")
            params = params[:index] + list(values) + params[index:]
        return [dict(row) for row in self.db.execute(sql.replace("%s", "?"), params)]

    def test_returns_newest_months_first_with_their_photos(self):
        page, next_before = months_page(self.query, Facets(), months=2)

        self.assertEqual([b["month"] for b in page], ["2024-06", "2024-05"])
        self.assertEqual(page[0]["count"], 2)
        self.assertEqual([p["photo_id"] for p in page[0]["photos"]], ["a", "b"])
        self.assertEqual(next_before, "2024-05")

    def test_before_continues_into_older_months_without_repeating(self):
        first, next_before = months_page(self.query, Facets(), months=2)
        second, after = months_page(self.query, Facets(), months=2, before=next_before)

        self.assertEqual([b["month"] for b in second], ["2024-04"])
        self.assertIsNone(after)
        self.assertEqual(set(b["month"] for b in first) & set(b["month"] for b in second), set())

    def test_the_media_facet_reaches_the_month_buckets_too(self):
        page, _ = months_page(self.query, Facets(media="video"), months=12)

        self.assertEqual([b["month"] for b in page], ["2024-05"])
        self.assertEqual([p["photo_id"] for p in page[0]["photos"]], ["c"])

    def test_an_empty_library_pages_cleanly(self):
        self.db.execute("DELETE FROM photo_copies")
        self.assertEqual(months_page(self.query, Facets(), months=3), ([], None))

    def test_only_the_requested_months_are_fetched(self):
        query = Mock(return_value=[])
        months_page(query, Facets(), months=3)
        # No bucket rows come back, so the photo query must never be issued.
        self.assertEqual(query.call_count, 1)


if __name__ == "__main__":
    unittest.main()
