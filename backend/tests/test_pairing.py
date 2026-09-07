from datetime import datetime, timedelta, timezone
import unittest

from pairing import (
    ALPHABET, CODE_LENGTH, PairingError, check_claimable, format_code,
    hash_code, mint_code, normalise, pairing_payload, seconds_remaining,
)

NOW = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)


def row(**overrides):
    base = {"claimed_at": None, "expires_at": NOW + timedelta(minutes=5)}
    base.update(overrides)
    return base


class CodeTests(unittest.TestCase):
    def test_codes_avoid_characters_people_misread(self):
        for banned in "01OIL":
            self.assertNotIn(banned, ALPHABET)

    def test_codes_are_the_declared_length_and_unique(self):
        codes = {mint_code()[0] for _ in range(300)}
        self.assertEqual(len(codes), 300)
        for code in codes:
            self.assertEqual(len(code), CODE_LENGTH)
            self.assertTrue(set(code) <= set(ALPHABET))

    def test_only_the_hash_is_storable(self):
        code, digest = mint_code()
        self.assertNotIn(code, digest)
        self.assertEqual(digest, hash_code(code))
        self.assertEqual(len(digest), 64)

    def test_typing_variations_reach_the_same_code(self):
        code, digest = mint_code()
        spaced = " ".join(code[i:i + 2] for i in range(0, len(code), 2))
        for variant in (code.lower(), format_code(code), spaced, f" {code} "):
            self.assertEqual(hash_code(variant), digest, variant)

    def test_a_mistyped_lookalike_fails_rather_than_resolving_elsewhere(self):
        # O is not in the alphabet; normalising must not turn it into 0.
        self.assertEqual(normalise("ABCO"), "ABC")
        self.assertNotEqual(hash_code("ABCD2345"), hash_code("ABCO2345"))

    def test_display_grouping_is_reversible(self):
        code, _ = mint_code()
        self.assertIn("-", format_code(code))
        self.assertEqual(normalise(format_code(code)), code)


class ClaimTests(unittest.TestCase):
    def test_a_fresh_code_is_claimable(self):
        check_claimable(row(), NOW)

    def test_an_expired_code_is_not(self):
        with self.assertRaises(PairingError):
            check_claimable(row(expires_at=NOW - timedelta(seconds=1)), NOW)

    def test_a_claimed_code_cannot_be_claimed_twice(self):
        with self.assertRaises(PairingError):
            check_claimable(row(claimed_at=NOW), NOW)

    def test_an_unknown_code_is_refused(self):
        with self.assertRaises(PairingError):
            check_claimable(None, NOW)

    def test_a_naive_expiry_is_read_as_utc_rather_than_crashing(self):
        check_claimable(row(expires_at=datetime(2026, 9, 7, 12, 5)), NOW)

    def test_every_refusal_looks_identical_to_a_guesser(self):
        # Unknown, expired and claimed must not be distinguishable, or a caller
        # can probe for codes that exist.
        messages, statuses = set(), set()
        for bad in (None, row(claimed_at=NOW), row(expires_at=NOW - timedelta(seconds=1))):
            with self.assertRaises(PairingError) as caught:
                check_claimable(bad, NOW)
            messages.add(caught.exception.reason)
            statuses.add(caught.exception.status)
        self.assertEqual(len(messages), 1)
        self.assertEqual(statuses, {404})


class PayloadTests(unittest.TestCase):
    def test_the_qr_carries_both_the_address_and_the_code(self):
        payload = pairing_payload("ABCD2345", "https://nas.example.com/")
        self.assertEqual(payload["url"], "kindred://pair?server=https://nas.example.com&code=ABCD2345")
        self.assertEqual(payload["server_url"], "https://nas.example.com")
        self.assertEqual(payload["display_code"], "ABCD-2345")

    def test_a_trailing_slash_never_doubles_in_the_url(self):
        self.assertNotIn("//?", pairing_payload("ABCD2345", "https://x.test//")["url"])

    def test_a_missing_server_url_still_yields_a_typeable_code(self):
        payload = pairing_payload("ABCD2345", "")
        self.assertEqual(payload["display_code"], "ABCD-2345")

    def test_seconds_remaining_never_goes_negative(self):
        self.assertEqual(seconds_remaining(NOW - timedelta(hours=1), NOW), 0)
        self.assertEqual(seconds_remaining(NOW + timedelta(seconds=90), NOW), 90)


if __name__ == "__main__":
    unittest.main()
