from unittest import TestCase
from unittest.mock import Mock

from fastapi import HTTPException

import passkey_auth


class PasskeyAuthTests(TestCase):
    def test_passkeys_are_bound_to_an_exact_origin_and_host(self):
        configured = "https://kindred.example"
        self.assertEqual(passkey_auth.relying_party(configured, configured), (configured, "kindred.example"))
        for origin in ("https://other.kindred.example", "http://kindred.example", "https://kindred.example:3000"):
            with self.assertRaises(HTTPException):
                passkey_auth.relying_party(configured, origin)

    def test_registration_challenge_is_consumed_with_origin_and_user(self):
        query = Mock(return_value=[{"challenge": memoryview(b"fixture")}])
        origin = "https://kindred.example"
        user_id = "00000000-0000-4000-8000-000000000001"
        self.assertEqual(passkey_auth.take_challenge(query, "flow", "register", origin, user_id), b"fixture")
        sql, params = query.call_args.args
        self.assertIn("DELETE FROM passkey_challenges", sql)
        self.assertIn("expires_at > now()", sql)
        self.assertIn("RETURNING challenge", sql)
        self.assertEqual(params, ("flow", "register", origin, user_id))

    def test_expired_or_replayed_challenge_is_rejected(self):
        with self.assertRaises(HTTPException) as failed:
            passkey_auth.take_challenge(Mock(return_value=[]), "flow", "login", "https://kindred.example")
        self.assertEqual(failed.exception.status_code, 400)
