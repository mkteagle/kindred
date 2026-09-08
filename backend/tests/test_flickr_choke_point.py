"""The per-photo Flickr writes must go through the paced helper.

Flickr's 3,600 queries an hour are shared by every call in the process, so a
budget can only be kept from one place. Before flickr_api existed, twelve call
sites each built their own request and spent from that budget without knowing
what the others were doing -- which is why a bulk mirror hit the ceiling
rather than approaching it.

These are the calls that run once per photo. A new one that signs its own
request would reintroduce exactly the problem, and would do it quietly, so
this test names them.
"""
from __future__ import annotations

import ast
import unittest
from pathlib import Path

PACED = {
    "_flickr_set_dates",
    "_flickr_set_location",
    "_flickr_set_perms",
    "_add_photo_to_album",
    "_create_flickr_photoset",
}


def functions():
    tree = ast.parse((Path(__file__).parents[1] / "main.py").read_text())
    return {n.name: n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


class ChokePointTests(unittest.TestCase):
    def setUp(self):
        self.functions = functions()

    def test_the_per_photo_writes_all_exist(self):
        missing = PACED - set(self.functions)
        self.assertEqual(missing, set(), "renamed without updating this guard")

    def test_none_of_them_sign_their_own_request(self):
        for name in sorted(PACED):
            body = ast.dump(self.functions[name])
            self.assertNotIn("_flickr_oauth_sign", body,
                             f"{name} builds its own Flickr request; route it through flickr_api")

    def test_none_of_them_open_their_own_client(self):
        for name in sorted(PACED):
            body = ast.dump(self.functions[name])
            self.assertNotIn("AsyncClient", body,
                             f"{name} sends its own request, bypassing the pacer")

    def test_each_one_calls_the_paced_helper(self):
        for name in sorted(PACED):
            calls = {node.func.id for node in ast.walk(self.functions[name])
                     if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
            self.assertIn("flickr_api", calls, f"{name} does not call flickr_api")

    def test_the_helper_paces_and_retries(self):
        helper = self.functions["flickr_api"]
        body = ast.dump(helper)
        self.assertIn("_flickr_pacer", body, "flickr_api does not consult the pacer")
        self.assertIn("attempt", body, "flickr_api does not apply the retry policy")
        self.assertIn("sleep", body, "flickr_api does not wait between attempts")


if __name__ == "__main__":
    unittest.main()
