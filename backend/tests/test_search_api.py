import sqlite3
import unittest
from unittest.mock import Mock

from fastapi import HTTPException

import search_api
from search_api import Facets, browse, by_text, by_vector, candidate_pool, merge


class FacetValidationTests(unittest.TestCase):
    def test_rejects_an_unknown_media_kind(self):
        with self.assertRaises(HTTPException):
            Facets(media="videos; DROP TABLE photos")

    def test_a_cluster_without_its_category_is_ambiguous(self):
        with self.assertRaises(HTTPException):
            Facets(cluster_id="c1")

    def test_no_filters_means_no_active_facets(self):
        self.assertFalse(Facets().active)
        self.assertTrue(Facets(media="video").active)
        self.assertTrue(Facets(date_from="2024-01-01").active)

    def test_every_filter_value_is_a_bound_parameter(self):
        clauses, params = Facets(media="video", date_from="2024-01-01",
                                 date_to="2024-12-31", cluster_id="c1",
                                 category="people", album_id="a1").where()
        sql = " AND ".join(clauses)
        self.assertEqual(sql.count("%s"), len(params))
        for value in ("video", "c1", "people", "a1"):
            self.assertNotIn(f"'{value}'", sql)

    def test_rejects_an_unknown_date_field(self):
        with self.assertRaises(HTTPException):
            Facets(date_field="created_at; DROP TABLE photos")

    def test_taken_and_added_target_different_columns(self):
        taken, _ = Facets(date_from="2024-01-01").where()
        added, _ = Facets(date_from="2024-01-01", date_field="added").where()
        self.assertIn("COALESCE(p.taken_at,p.created_at) >= %s", " AND ".join(taken))
        self.assertIn("p.created_at >= %s", " AND ".join(added))
        self.assertNotIn("COALESCE", " AND ".join(added).split("WHERE")[-1].split(">=")[0])

    def test_the_end_of_the_range_includes_that_whole_day(self):
        clauses, _ = Facets(date_to="2024-12-31").where()
        self.assertIn("< (%s::date + 1)", " AND ".join(clauses))


class CandidatePoolTests(unittest.TestCase):
    def test_widens_the_pool_when_facets_will_discard_candidates(self):
        self.assertGreater(candidate_pool(60, Facets(media="video")),
                           candidate_pool(60, Facets()))

    def test_is_capped_so_a_large_limit_cannot_scan_the_table(self):
        self.assertEqual(candidate_pool(200, Facets(media="video")), search_api.MAX_CANDIDATES)


class QueryShapeTests(unittest.TestCase):
    def test_vector_search_keeps_the_ann_scan_unfiltered_so_the_index_is_used(self):
        query = Mock(return_value=[])
        by_vector(query, [0.1] * 512, Facets(media="photo"), limit=10)
        sql, params = query.call_args.args
        # The CTE that hits the ANN index must stay a bare nearest-neighbour
        # scan; a facet predicate inside it would stop the index being used.
        cte = sql[sql.index("WITH nearest AS ("):sql.index("SELECT p.id::text AS photo_id")]
        self.assertIn("ORDER BY pe.clip_embedding <=>", cte)
        self.assertNotIn("media_kind", cte)
        # The facet still applies, just outside the CTE.
        self.assertIn("p.media_kind = %s", sql)
        self.assertEqual(sql.count("%s"), len(params))

    def test_person_facet_reaches_photos_through_every_legacy_identity(self):
        clauses, _ = Facets(cluster_id="c1", category="people").where()
        sql = " AND ".join(clauses)
        self.assertIn("p.legacy_photo_id", sql)
        self.assertIn("f.provider_key", sql)

    def test_browse_rejects_an_unknown_sort(self):
        with self.assertRaises(HTTPException):
            browse(Mock(return_value=[]), Facets(), sort="id; DROP TABLE photos")


class MergeTests(unittest.TestCase):
    def test_earlier_result_sets_win_and_photos_never_repeat(self):
        people = [{"photo_id": "a", "match_type": "person"}]
        visual = [{"photo_id": "a", "match_type": "visual"}, {"photo_id": "b"}]
        merged = merge(people, visual, limit=10)
        self.assertEqual([row["photo_id"] for row in merged], ["a", "b"])
        self.assertEqual(merged[0]["match_type"], "person")

    def test_stops_at_the_limit(self):
        rows = [{"photo_id": str(n)} for n in range(50)]
        self.assertEqual(len(merge(rows, limit=10)), 10)


class AgainstSqliteTests(unittest.TestCase):
    """Exercise browse and by_text against a real relational engine."""

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
                ('p1','image/jpeg','Beach day','beach.jpg','2024-06-01','2024-06-01'),
                ('p2','video/mp4','Beach video','beach.mp4','2024-07-01','2024-07-01'),
                ('p3','image/jpeg','Snow','snow.jpg','2023-01-01','2023-01-01');
            INSERT INTO photo_copies VALUES
                ('p1','nas','available','k1',NULL),
                ('p2','nas','available','k2',NULL),
                ('p3','nas','available','k3',NULL);
        """)

    def tearDown(self):
        self.db.close()

    def query(self, sql, params=()):
        sql = (sql.replace("p.id::text", "CAST(p.id AS TEXT)")
                  .replace("ILIKE", "LIKE")
                  .replace("(%s::date + 1)", "date(%s,'+1 day')")
                  .replace("%s", "?"))
        return [dict(row) for row in self.db.execute(sql, params)]

    def test_browse_with_no_facets_returns_everything_newest_first(self):
        rows = browse(self.query, Facets(), limit=10)
        self.assertEqual([r["photo_id"] for r in rows], ["p2", "p1", "p3"])

    def test_video_facet_isolates_the_video(self):
        rows = browse(self.query, Facets(media="video"), limit=10)
        self.assertEqual([r["photo_id"] for r in rows], ["p2"])

    def test_date_range_is_inclusive_of_the_final_day(self):
        rows = browse(self.query, Facets(date_from="2024-06-01", date_to="2024-06-01"), limit=10)
        self.assertEqual([r["photo_id"] for r in rows], ["p1"])

    def test_import_date_filter_finds_a_bulk_import_of_old_photos(self):
        # A Takeout import: everything arrives today, but was taken years ago.
        self.db.execute("INSERT INTO photos (id,media_type,title,original_filename,"
                        "taken_at,created_at) VALUES ('p4','image/jpeg','Old','old.jpg',"
                        "'1998-05-01','2024-08-01')")
        self.db.execute("INSERT INTO photo_copies VALUES ('p4','nas','available','k4',NULL)")

        by_import = browse(self.query, Facets(date_from="2024-08-01", date_to="2024-08-01",
                                             date_field="added"), limit=10)
        by_capture = browse(self.query, Facets(date_from="2024-08-01", date_to="2024-08-01"), limit=10)

        self.assertEqual([r["photo_id"] for r in by_import], ["p4"])
        self.assertEqual(by_capture, [])

    def test_text_search_reaches_videos_which_have_no_embeddings(self):
        rows = by_text(self.query, "beach", Facets(media="video"), limit=10)
        self.assertEqual([r["photo_id"] for r in rows], ["p2"])

    def test_text_and_media_facet_combine(self):
        rows = by_text(self.query, "beach", Facets(), limit=10)
        self.assertEqual({r["photo_id"] for r in rows}, {"p1", "p2"})


if __name__ == "__main__":
    unittest.main()
