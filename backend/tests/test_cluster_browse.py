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
