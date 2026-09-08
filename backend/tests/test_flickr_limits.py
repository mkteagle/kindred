"""Rate limiting is backpressure, not failure.

A query that comes back throttled has already cost its slot in the hour.
Abandoning the photo throws away the slot and the work, and leaves it to be
re-walked later -- so throttling must retry until the quota refills, however
long that takes. A photo that genuinely is not there must not, or the importer
spins on it forever while the library stands still. These tests pin that line.
"""
from __future__ import annotations

import random
import unittest

import flickr_limits as fl
from flickr_limits import Decision, Pacer, attempt, backoff, classify


class ClassifyTests(unittest.TestCase):
    def test_429_is_backpressure(self):
        self.assertEqual(classify(429, None), "rate_limited")

    def test_flickr_signals_throttling_inside_a_200(self):
        # Error 105 arrives with an HTTP 200, so status alone cannot be trusted.
        self.assertEqual(classify(200, {"stat": "fail", "code": 105}), "rate_limited")

    def test_a_server_error_is_worth_waiting_out(self):
        self.assertEqual(classify(503, None), "rate_limited")
        self.assertEqual(classify(500, None), "rate_limited")

    def test_a_missing_photo_is_fatal(self):
        self.assertEqual(classify(200, {"stat": "fail", "code": 1}), "fatal")

    def test_a_bad_token_is_fatal_not_retried(self):
        # Retrying a dead token forever burns the quota it is trying to protect.
        for code in (98, 99, 100):
            self.assertEqual(classify(200, {"stat": "fail", "code": code}), "fatal")

    def test_a_normal_response_is_ok(self):
        self.assertEqual(classify(200, {"stat": "ok"}), "ok")
        self.assertEqual(classify(200, None), "ok")

    def test_a_non_numeric_code_is_not_mistaken_for_success(self):
        self.assertEqual(classify(200, {"stat": "fail", "code": "weird"}), "fatal")


class RetryPolicyTests(unittest.TestCase):
    def test_throttling_retries_without_limit(self):
        # The quota refills, so waiting always eventually works.
        for tries in (0, 5, 50, 5000):
            self.assertTrue(attempt(429, None, tries).should_retry)

    def test_a_fatal_error_gives_up_quickly(self):
        decisions = [attempt(200, {"stat": "fail", "code": 1}, t) for t in range(6)]
        self.assertTrue(any(d.action == "fail" for d in decisions))

    def test_success_proceeds(self):
        self.assertEqual(attempt(200, {"stat": "ok"}, 0).action, "proceed")

    def test_backoff_grows_and_is_capped(self):
        rng = random.Random(1)
        early = backoff(0, jitter=rng)
        late = backoff(20, jitter=rng)
        self.assertLess(early, late)
        self.assertLessEqual(late, fl.MAX_BACKOFF)

    def test_backoff_is_jittered_so_workers_do_not_retry_in_lockstep(self):
        values = {backoff(4, jitter=random.Random(seed)) for seed in range(8)}
        self.assertGreater(len(values), 1)

    def test_every_wait_is_positive(self):
        for tries in range(0, 30):
            self.assertGreater(attempt(429, None, tries).wait, 0)


class PacerTests(unittest.TestCase):
    def test_the_budget_leaves_headroom_under_the_ceiling(self):
        # The key is shared with the web app; hitting the wall stalls the
        # importer rather than whoever else is using it.
        self.assertLess(Pacer().budget, fl.HOURLY_QUOTA)

    def test_a_fresh_pacer_does_not_wait(self):
        self.assertEqual(Pacer().next_wait(now=1000.0), 0.0)

    def test_spending_faster_than_the_budget_earns_a_wait(self):
        pacer = Pacer()
        pacer.record(now=0.0)
        for _ in range(50):
            pacer.record(now=0.0)
        self.assertGreater(pacer.next_wait(now=0.0), 0.0)

    def test_waiting_long_enough_clears_the_debt(self):
        pacer = Pacer()
        for _ in range(50):
            pacer.record(now=0.0)
        self.assertEqual(pacer.next_wait(now=3600.0), 0.0)

    def test_the_window_rolls_over_after_an_hour(self):
        pacer = Pacer()
        pacer.record(now=0.0)
        pacer.record(now=4000.0)
        self.assertEqual(pacer.spent, 1)

    def test_the_budget_would_be_consumed_evenly_across_the_hour(self):
        pacer = Pacer()
        self.assertAlmostEqual(pacer.interval * pacer.budget, 3600.0, places=3)


if __name__ == "__main__":
    unittest.main()
