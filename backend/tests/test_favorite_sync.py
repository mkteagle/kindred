"""Adopting the phone's hearts must not delete the library's own.

The phone knows about assets that are still on it. A camera roll that has been
cleared -- which is the point of this whole migration -- knows about almost
nothing. So the list it sends is evidence of what IS favourited, never of what
is not, and treating it as the complete truth would unfavourite most of the
library on the first sync.
"""
from __future__ import annotations

import ast
import unittest
import uuid
from pathlib import Path
from unittest.mock import Mock

from fastapi import HTTPException


def load_route():
    tree = ast.parse((Path(__file__).parents[1] / "main.py").read_text())
    function = next(n for n in tree.body
                    if isinstance(n, ast.FunctionDef) and n.name == "sync_favorites")
    function.decorator_list = []
    return function


class FavoriteSyncTests(unittest.TestCase):
    def setUp(self):
        self.known: set[str] = set()
        self.existing: set[str] = set()
        self.writes: list = []

        def db_query(sql, params=(), fetch=True):
            if "FROM photos" in sql:
                return [{"id": pid} for pid in params[0] if pid in self.known]
            if "FROM photo_favorites" in sql:
                return [{"photo_id": pid} for pid in params[1] if pid in self.existing]
            self.writes.append(params)
            return []

        self.namespace = dict(db_query=db_query, uuid=uuid, HTTPException=HTTPException,
                              Depends=lambda f: None, get_current_user=lambda: None)
        exec(compile(ast.Module(body=[load_route()], type_ignores=[]), "<fav>", "exec"),
             self.namespace)

    def call(self, ids, user_id="11111111-1111-1111-1111-111111111111"):
        request = Mock(photo_ids=ids)
        return self.namespace["sync_favorites"](request, {"user_id": user_id})

    def test_new_favourites_are_added(self):
        a, b = str(uuid.uuid4()), str(uuid.uuid4())
        self.known = {a, b}
        result = self.call([a, b])
        self.assertEqual(result["added"], 2)
        self.assertEqual(len(self.writes), 1)

    def test_favourites_already_held_are_not_written_again(self):
        a = str(uuid.uuid4())
        self.known = {a}
        self.existing = {a}
        result = self.call([a])
        self.assertEqual((result["added"], result["already"]), (0, 1))
        self.assertEqual(self.writes, [])

    def test_a_photo_the_library_does_not_have_is_reported_not_invented(self):
        stranger = str(uuid.uuid4())
        result = self.call([stranger])
        self.assertEqual(result["unknown"], 1)
        self.assertEqual(result["added"], 0)

    def test_nothing_is_ever_unfavourited(self):
        # The guarantee is in the SQL, so check the SQL -- not the whole dump,
        # which includes a docstring that says the word "delete" about this
        # very property.
        route = load_route()
        statements = [node.value for node in ast.walk(route)
                      if isinstance(node, ast.Constant) and isinstance(node.value, str)]
        verbs = ("SELECT", "INSERT", "UPDATE", "DELETE")
        sql = [text for text in statements
               if text.strip().upper().startswith(verbs)]
        self.assertTrue(sql, "expected to find SQL to check")
        for statement in sql:
            self.assertNotIn("DELETE", statement.upper(), statement)

    def test_a_malformed_id_does_not_lose_the_rest_of_the_batch(self):
        good = str(uuid.uuid4())
        self.known = {good}
        result = self.call(["not-a-uuid", good, None])
        self.assertEqual(result["added"], 1)

    def test_an_empty_list_is_not_an_error(self):
        self.assertEqual(self.call([]), {"added": 0, "already": 0, "unknown": 0})

    def test_a_batch_is_bounded(self):
        many = [str(uuid.uuid4()) for _ in range(6000)]
        self.known = set(many)
        result = self.call(many)
        self.assertLessEqual(result["added"], 5000)

    def test_a_household_account_is_required(self):
        with self.assertRaises(HTTPException):
            self.namespace["sync_favorites"](Mock(photo_ids=[]), {"user_id": None})


if __name__ == "__main__":
    unittest.main()
