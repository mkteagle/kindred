from datetime import datetime, timedelta, timezone
import unittest

from shares import (
    ShareError, check_live, hash_token, mint_token, normalise_subject,
    public_view, requires_password, scope_allows,
)


def share(**overrides):
    base = dict(subject_type="album", photo_id=None, album_id="al1", title="Maine",
                password_hash=None, allow_download=False, expires_at=None,
                revoked_at=None)
    base.update(overrides)
    return base


class TokenTests(unittest.TestCase):
    def test_tokens_are_unguessable_and_url_safe(self):
        tokens = {mint_token()[0] for _ in range(200)}
        self.assertEqual(len(tokens), 200)
        for token in tokens:
            self.assertGreaterEqual(len(token), 40)
            self.assertTrue(all(c.isalnum() or c in "-_" for c in token))

    def test_only_the_hash_is_storable_and_it_is_deterministic(self):
        token, digest = mint_token()
        self.assertNotIn(token, digest)
        self.assertEqual(digest, hash_token(token))
        self.assertEqual(len(digest), 64)

    def test_a_different_token_never_matches_a_stored_hash(self):
        _, digest = mint_token()
        self.assertNotEqual(hash_token(mint_token()[0]), digest)


class SubjectTests(unittest.TestCase):
    def test_a_photo_share_carries_only_a_photo(self):
        self.assertEqual(normalise_subject("photo", "p1", None), ("p1", None))

    def test_an_album_share_carries_only_an_album(self):
        self.assertEqual(normalise_subject("album", None, "al1"), (None, "al1"))

    def test_refuses_both_subjects_at_once(self):
        with self.assertRaises(ShareError):
            normalise_subject("photo", "p1", "al1")
        with self.assertRaises(ShareError):
            normalise_subject("album", "p1", "al1")

    def test_refuses_a_subject_that_is_missing_or_unknown(self):
        for args in (("photo", None, None), ("album", None, None), ("library", "p1", None)):
            with self.assertRaises(ShareError):
                normalise_subject(*args)


class LivenessTests(unittest.TestCase):
    def test_a_plain_share_is_live(self):
        check_live(share())

    def test_a_revoked_share_is_dead(self):
        with self.assertRaises(ShareError):
            check_live(share(revoked_at=datetime.now(timezone.utc)))

    def test_an_expired_share_is_dead(self):
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        with self.assertRaises(ShareError):
            check_live(share(expires_at=past))

    def test_a_future_expiry_is_still_live(self):
        check_live(share(expires_at=datetime.now(timezone.utc) + timedelta(days=1)))

    def test_a_naive_expiry_is_read_as_utc_rather_than_crashing(self):
        with self.assertRaises(ShareError):
            check_live(share(expires_at=datetime(2000, 1, 1)))

    def test_a_missing_share_is_dead(self):
        with self.assertRaises(ShareError):
            check_live(None)

    def test_dead_shares_never_admit_they_existed(self):
        # 404 for every dead case, so a stranger cannot probe for real links.
        for dead in (None, share(revoked_at=datetime.now(timezone.utc)),
                     share(expires_at=datetime(2000, 1, 1, tzinfo=timezone.utc))):
            with self.assertRaises(ShareError) as caught:
                check_live(dead)
            self.assertEqual(caught.exception.status, 404)


class ScopeTests(unittest.TestCase):
    def test_a_photo_share_admits_only_that_photo(self):
        one = share(subject_type="photo", photo_id="p1", album_id=None)
        self.assertTrue(scope_allows(one, "p1", []))
        self.assertFalse(scope_allows(one, "p2", []))

    def test_an_album_share_admits_only_its_members(self):
        self.assertTrue(scope_allows(share(), "p1", ["p1", "p2"]))
        self.assertFalse(scope_allows(share(), "p9", ["p1", "p2"]))

    def test_an_album_share_does_not_leak_through_a_photo_id_in_the_request(self):
        # The whole point: an attacker supplying another photo's id is refused.
        self.assertFalse(scope_allows(share(), "someone-elses-photo", ["p1"]))

    def test_ids_compare_as_strings_so_uuid_objects_match(self):
        import uuid
        photo = uuid.uuid4()
        self.assertTrue(scope_allows(share(), str(photo), [photo]))


class PublicViewTests(unittest.TestCase):
    def test_a_locked_share_reveals_no_items(self):
        view = public_view(share(password_hash="bcrypt"), items=[{"photo_id": "p1"}], unlocked=False)
        self.assertTrue(view["locked"])
        self.assertEqual(view["items"], [])
        self.assertFalse(view["allow_download"])

    def test_unlocking_reveals_the_items(self):
        view = public_view(share(password_hash="bcrypt"), items=[{"photo_id": "p1"}], unlocked=True)
        self.assertFalse(view["locked"])
        self.assertEqual(len(view["items"]), 1)

    def test_the_public_shape_leaks_no_internal_fields(self):
        view = public_view(share(album_id="al1"), items=[], unlocked=True)
        for leaked in ("album_id", "photo_id", "created_by", "token_hash",
                       "view_count", "password_hash", "revoked_at"):
            self.assertNotIn(leaked, view)

    def test_requires_password_reflects_the_stored_hash(self):
        self.assertFalse(requires_password(share()))
        self.assertTrue(requires_password(share(password_hash="bcrypt")))


if __name__ == "__main__":
    unittest.main()


class MediaSignatureTests(unittest.TestCase):
    def setUp(self):
        from shares import signing_key
        self.key = signing_key("deployment-api-key")

    def test_a_valid_signature_verifies(self):
        from shares import sign_media, verify_media
        signature = sign_media(self.key, "s1", "p1", 2_000_000_000)
        self.assertTrue(verify_media(self.key, "s1", "p1", 2_000_000_000, signature,
                                     now_unix=1_000_000_000))

    def test_a_signature_does_not_transfer_to_another_photo_or_share(self):
        from shares import sign_media, verify_media
        signature = sign_media(self.key, "s1", "p1", 2_000_000_000)
        self.assertFalse(verify_media(self.key, "s1", "p2", 2_000_000_000, signature,
                                      now_unix=1_000_000_000))
        self.assertFalse(verify_media(self.key, "s2", "p1", 2_000_000_000, signature,
                                      now_unix=1_000_000_000))

    def test_an_expired_signature_is_refused_even_though_it_is_authentic(self):
        from shares import sign_media, verify_media
        signature = sign_media(self.key, "s1", "p1", 1_000)
        self.assertFalse(verify_media(self.key, "s1", "p1", 1_000, signature, now_unix=2_000))

    def test_the_expiry_is_covered_by_the_signature(self):
        from shares import sign_media, verify_media
        signature = sign_media(self.key, "s1", "p1", 1_000)
        # Extending the deadline in the URL must invalidate it.
        self.assertFalse(verify_media(self.key, "s1", "p1", 2_000_000_000, signature,
                                      now_unix=1_000_000_000))

    def test_a_different_deployment_secret_cannot_forge_one(self):
        from shares import sign_media, signing_key, verify_media
        forged = sign_media(signing_key("someone-elses-key"), "s1", "p1", 2_000_000_000)
        self.assertFalse(verify_media(self.key, "s1", "p1", 2_000_000_000, forged,
                                      now_unix=1_000_000_000))

    def test_missing_or_malformed_signatures_are_refused(self):
        from shares import verify_media
        for bad in ("", None, "nonsense"):
            self.assertFalse(verify_media(self.key, "s1", "p1", 2_000_000_000, bad,
                                          now_unix=1_000_000_000))

    def test_the_signing_key_is_not_the_api_key(self):
        from shares import signing_key
        self.assertNotIn(b"deployment-api-key", signing_key("deployment-api-key"))
