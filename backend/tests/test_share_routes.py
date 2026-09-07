"""Route-level tests for share access control.

main.py needs a database to import, so each route is extracted from its AST and
executed against a namespace of stubs — the pattern already used for the image
routes in test_library_api.
"""
from __future__ import annotations as _future_annotations

import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
from unittest.mock import Mock

from fastapi import HTTPException

import shares


def load_route(name):
    """Compile one route function out of main.py, without its decorators."""
    tree = ast.parse((Path(__file__).parents[1] / "main.py").read_text())
    function = next(n for n in tree.body
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    function.decorator_list = []
    return function


def run_route(name, namespace):
    function = load_route(name)
    namespace.setdefault("HTTPException", HTTPException)
    namespace.setdefault("shares", shares)
    # main.py targets Python 3.11, where `int | None` in a signature is fine.
    # Compile with future annotations so these tests also run on 3.9.
    code = compile(ast.Module(body=[function], type_ignores=[]), "<route>", "exec",
                   flags=_future_annotations.compiler_flag)
    exec(code, namespace)
    return namespace[name]


ALBUM_SHARE = dict(
    id="11111111-1111-1111-1111-111111111111", subject_type="album",
    photo_id=None, album_id="al1", title="Maine", password_hash=None,
    allow_download=False, expires_at=None, revoked_at=None, view_count=0,
)


class ShareMediaScopeTests(unittest.TestCase):
    """The scope check is the whole security boundary for share links."""

    def media(self, share, album_photos, serve=None, **overrides):
        namespace = dict(
            _share_by_token=lambda token: share,
            _share_photo_ids=lambda s: album_photos,
            _share_signing_key=lambda: shares.signing_key("test-key"),
            get_local_photo=serve or Mock(return_value="media"),
        )
        namespace.update(overrides)
        return run_route("share_media", namespace)

    def test_serves_a_photo_that_is_inside_the_share(self):
        serve = Mock(return_value="media bytes")
        route = self.media(ALBUM_SHARE, ["p1", "p2"], serve=serve)
        self.assertEqual(route("tok", "p1"), "media bytes")
        serve.assert_called_once_with("p1", "thumb", None)

    def test_refuses_a_photo_outside_the_album(self):
        serve = Mock()
        route = self.media(ALBUM_SHARE, ["p1", "p2"], serve=serve)
        with self.assertRaises(HTTPException) as caught:
            route("tok", "not-in-this-album")
        self.assertEqual(caught.exception.status_code, 404)
        serve.assert_not_called()

    def test_a_photo_share_cannot_be_pointed_at_another_photo(self):
        one = {**ALBUM_SHARE, "subject_type": "photo", "photo_id": "p1", "album_id": None}
        serve = Mock(return_value="media")
        route = self.media(one, [], serve=serve)
        self.assertEqual(route("tok", "p1"), "media")
        with self.assertRaises(HTTPException):
            route("tok", "p2")
        serve.assert_called_once()

    def test_a_revoked_share_serves_nothing(self):
        revoked = {**ALBUM_SHARE, "revoked_at": datetime.now(timezone.utc)}
        with self.assertRaises(HTTPException) as caught:
            self.media(revoked, ["p1"])("tok", "p1")
        self.assertEqual(caught.exception.status_code, 404)

    def test_an_expired_share_serves_nothing(self):
        expired = {**ALBUM_SHARE, "expires_at": datetime.now(timezone.utc) - timedelta(days=1)}
        with self.assertRaises(HTTPException):
            self.media(expired, ["p1"])("tok", "p1")

    def test_an_unknown_token_is_a_plain_404(self):
        with self.assertRaises(HTTPException) as caught:
            self.media(None, [])("nonsense", "p1")
        self.assertEqual(caught.exception.status_code, 404)

    def test_originals_are_withheld_unless_downloads_were_enabled(self):
        with self.assertRaises(HTTPException) as caught:
            self.media(ALBUM_SHARE, ["p1"])("tok", "p1", "original")
        self.assertEqual(caught.exception.status_code, 403)

    def test_originals_are_served_when_downloads_are_enabled(self):
        open_share = {**ALBUM_SHARE, "allow_download": True}
        self.assertEqual(self.media(open_share, ["p1"])("tok", "p1", "original"), "media")

    def test_a_protected_share_refuses_media_without_a_valid_signature(self):
        locked = {**ALBUM_SHARE, "password_hash": "bcrypt"}
        with self.assertRaises(HTTPException) as caught:
            self.media(locked, ["p1"])("tok", "p1", "thumb", None, None)
        self.assertEqual(caught.exception.status_code, 403)

    def test_a_protected_share_accepts_its_own_signature(self):
        locked = {**ALBUM_SHARE, "password_hash": "bcrypt"}
        key = shares.signing_key("test-key")
        expires = int((datetime.now(timezone.utc) + timedelta(minutes=5)).timestamp())
        signature = shares.sign_media(key, locked["id"], "p1", expires)
        self.assertEqual(self.media(locked, ["p1"])("tok", "p1", "thumb", expires, signature), "media")

    def test_a_signature_for_one_photo_does_not_unlock_another(self):
        locked = {**ALBUM_SHARE, "password_hash": "bcrypt"}
        key = shares.signing_key("test-key")
        expires = int((datetime.now(timezone.utc) + timedelta(minutes=5)).timestamp())
        signature = shares.sign_media(key, locked["id"], "p1", expires)
        with self.assertRaises(HTTPException):
            self.media(locked, ["p1", "p2"])("tok", "p2", "thumb", expires, signature)


class ViewShareTests(unittest.TestCase):
    def route(self, share, items=None, recorded=None):
        namespace = dict(
            _share_by_token=lambda token: share,
            _share_photo_ids=lambda s: ["p1"],
            _share_items=lambda s, t, ids: items if items is not None else [{"photo_id": "p1"}],
            _record_share_view=recorded or Mock(),
        )
        return run_route("view_share", namespace)

    def test_an_open_share_returns_its_items(self):
        view = self.route(ALBUM_SHARE)("tok")
        self.assertFalse(view["locked"])
        self.assertEqual(len(view["items"]), 1)

    def test_a_protected_share_returns_nothing_until_unlocked(self):
        locked = {**ALBUM_SHARE, "password_hash": "bcrypt"}
        view = self.route(locked)("tok")
        self.assertTrue(view["locked"])
        self.assertEqual(view["items"], [])

    def test_a_protected_share_is_not_counted_as_viewed_before_unlocking(self):
        recorded = Mock()
        locked = {**ALBUM_SHARE, "password_hash": "bcrypt"}
        self.route(locked, recorded=recorded)("tok")
        recorded.assert_not_called()

    def test_the_response_never_carries_the_token_hash_or_owner(self):
        view = self.route(ALBUM_SHARE)("tok")
        for leaked in ("token_hash", "created_by", "password_hash", "album_id", "view_count"):
            self.assertNotIn(leaked, view)


class MiddlewareExemptionTests(unittest.TestCase):
    def test_only_the_share_prefix_is_anonymous(self):
        source = (Path(__file__).parents[1] / "main.py").read_text()
        self.assertIn('PUBLIC_SHARE_PREFIX = "/public/shares/"', source)
        self.assertIn("path.startswith(PUBLIC_SHARE_PREFIX)", source)
        # The exemption must be a prefix under /public/shares/, never a bare
        # /public/ that a future route could accidentally fall under.
        self.assertNotIn('PUBLIC_SHARE_PREFIX = "/public/"', source)


if __name__ == "__main__":
    unittest.main()
