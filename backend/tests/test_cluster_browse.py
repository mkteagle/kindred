import unittest
from unittest.mock import Mock

from cluster_browse import summary


class ClusterBrowseTests(unittest.TestCase):
    def test_covers_are_resolved_after_pagination(self):
        query = Mock(return_value=[{"id": "person1", "label": "Example", "total": 10, "named_total": 2}])
        page = summary(query, "people", 1, 0)
        self.assertEqual(page["clusters"], [{"id": "person1", "label": "Example"}])
        self.assertEqual((page["total"], page["named_total"], page["has_more"]), (10, 2, True))
        sql, params = query.call_args.args
        self.assertLess(sql.index("LIMIT %s OFFSET %s"), sql.index("SELECT d.chip"))
        self.assertEqual(params, ("people", "people", 1, 0, "people"))

    def test_people_name_filter_paginates_the_filtered_set(self):
        query = Mock(return_value=[{
            "id": "person1", "label": "Morgan", "total": 40,
            "named_total": 11, "filtered_total": 1,
        }])
        page = summary(query, "people", 1, 0, name_state="named", name="morgan")
        self.assertEqual(page["clusters"], [{"id": "person1", "label": "Morgan"}])
        self.assertEqual((page["total"], page["named_total"]), (40, 11))
        self.assertFalse(page["has_more"])
        sql, params = query.call_args.args
        self.assertLess(sql.index("strpos(lower(label)"), sql.index("LIMIT %s OFFSET %s"))
        self.assertEqual(params, ("people", "people", "morgan", 1, 0, "people"))
