"""Route-level tests for pairing, especially the unauthenticated claim."""
from __future__ import annotations as _future_annotations

import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
from unittest.mock import Mock

from fastapi import HTTPException

import pairing

NOW = datetime.now(timezone.utc)


def run_route(name, namespace):
    tree = ast.parse((Path(__file__).parents[1] / "main.py").read_text())
    function = next(n for n in tree.body
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    function.decorator_list = []
    namespace.setdefault("HTTPException", HTTPException)
    namespace.setdefault("pairing", pairing)
    code = compile(ast.Module(body=[function], type_ignores=[]), "<route>", "exec",
                   flags=_future_annotations.compiler_flag)
    exec(code, namespace)
    return namespace[name]


def request(ip="10.0.0.5"):
    return Mock(client=Mock(host=ip))


class RateLimitTests(unittest.TestCase):
    def setUp(self):
        self.limiter = run_route("_pairing_rate_limited", {
            "PAIRING_CLAIM_WINDOW_SECONDS": 300,
            "PAIRING_CLAIM_MAX_ATTEMPTS": 10,
            "_pairing_attempts": {},
        })

    def test_normal_use_is_never_throttled(self):
        for _ in range(10):
            self.assertFalse(self.limiter("10.0.0.5"))

    def test_a_guessing_loop_is_throttled(self):
        for _ in range(10):
            self.limiter("10.0.0.5")
        self.assertTrue(self.limiter("10.0.0.5"))

    def test_one_abuser_does_not_lock_out_everybody_else(self):
        for _ in range(30):
            self.limiter("10.0.0.5")
        self.assertFalse(self.limiter("10.0.0.9"))


class ClaimTests(unittest.TestCase):
    MISSING = object()

    def namespace(self, row, account=MISSING, **over):
        # `account=None` must mean "no such user", not "use the default".
        if account is self.MISSING:
            account = {"id": "u1", "username": "mike", "role": "admin"}
        cursor = Mock()
        cursor.fetchone.side_effect = [row, account]
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        conn = Mock()
        conn.cursor.return_value = cursor
        namespace = {
            "get_db": lambda: conn,
            "RealDictCursor": object,
            "create_session": Mock(return_value={"token": "sess-token", "expires_at": "2026-10-07T00:00:00+00:00"}),
            "PUBLIC_API_URL": "https://api.example.com",
            "_pairing_rate_limited": lambda ip: False,
            "uuid": __import__("uuid"),
        }
        namespace.update(over)
        self.cursor = cursor
        return namespace

    def valid_row(self, **over):
        base = {"id": "p1", "user_id": "u1", "server_url": "https://nas.example.com",
                "claimed_at": None, "expires_at": NOW + timedelta(minutes=5)}
        base.update(over)
        return base

    def claim(self, row, code="ABCD2345", **over):
        route = run_route("claim_pairing_code", self.namespace(row, **over))
        return route(Mock(code=code, device_name="Mike's iPhone"), request())

    def test_a_valid_code_yields_a_session_and_the_server_address(self):
        result = self.claim(self.valid_row())
        self.assertEqual(result["session"]["token"], "sess-token")
        self.assertEqual(result["server_url"], "https://nas.example.com")
        self.assertEqual(result["user"]["username"], "mike")

    def test_an_expired_code_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self.claim(self.valid_row(expires_at=NOW - timedelta(seconds=1)))
        self.assertEqual(caught.exception.status_code, 404)

    def test_a_code_cannot_be_claimed_twice(self):
        with self.assertRaises(HTTPException):
            self.claim(self.valid_row(claimed_at=NOW))

    def test_an_unknown_code_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self.claim(None)
        self.assertEqual(caught.exception.status_code, 404)

    def test_a_wrong_length_code_never_reaches_the_database(self):
        namespace = self.namespace(self.valid_row())
        namespace["get_db"] = Mock(side_effect=AssertionError("must not query"))
        route = run_route("claim_pairing_code", namespace)
        with self.assertRaises(HTTPException):
            route(Mock(code="SHORT", device_name=None), request())

    def test_the_claim_is_throttled(self):
        namespace = self.namespace(self.valid_row())
        namespace["_pairing_rate_limited"] = lambda ip: True
        route = run_route("claim_pairing_code", namespace)
        with self.assertRaises(HTTPException) as caught:
            route(Mock(code="ABCD2345", device_name=None), request())
        self.assertEqual(caught.exception.status_code, 429)

    def test_the_row_is_locked_so_two_phones_cannot_share_one_code(self):
        self.claim(self.valid_row())
        selects = [c.args[0] for c in self.cursor.execute.call_args_list if "SELECT" in c.args[0]]
        self.assertTrue(any("FOR UPDATE" in sql for sql in selects))

    def test_a_deleted_account_cannot_be_paired_into(self):
        with self.assertRaises(HTTPException):
            self.claim(self.valid_row(), account=None)


class MiddlewareTests(unittest.TestCase):
    def test_only_the_claim_path_is_anonymous(self):
        source = (Path(__file__).parents[1] / "main.py").read_text()
        self.assertIn('PUBLIC_PAIRING_PATH = "/public/pairing/claim"', source)
        # An exact match, not a prefix: minting a code still requires a session.
        self.assertIn("path == PUBLIC_PAIRING_PATH", source)
        self.assertNotIn("path.startswith(PUBLIC_PAIRING_PATH)", source)


if __name__ == "__main__":
    unittest.main()
