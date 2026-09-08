#!/usr/bin/env python3
"""Pacing and retry for Flickr's REST quota.

Flickr allows 3,600 REST queries an hour per key. That is a hard server-side
ceiling: uploads use a separate endpoint, but every getInfo, setDates,
setLocation and photosets call comes out of the same hour. Mirroring a large
library is therefore quota-bound long before it is bandwidth-bound, and the
only two things that help are spending fewer queries and never wasting one.

Wasting one is the easy mistake. A request that fails on rate limiting has
already cost its slot; giving up on it throws away the slot *and* the work.
So rate limiting is not an error here -- it is backpressure, and the response
is to wait and try again, indefinitely. A genuine failure (a deleted photo, a
bad token) is different and must not be retried forever, or the importer
spins on it while the library stands still.

Two pieces, both pure so they can be tested without a network:

  `Pacer`     spends a budget over an hour, so the limit is approached rather
              than hit. Cheaper than discovering the ceiling by bouncing off it.
  `attempt()` decides what to do with a response: proceed, wait and retry
              forever, retry a bounded number of times, or give up.
"""
from __future__ import annotations

from dataclasses import dataclass
import random

# Flickr's published ceiling, per key, per hour.
HOURLY_QUOTA = 3600
# Leave headroom: other things share this key -- the web app's own calls, a
# manual album edit -- and hitting the wall stalls the importer, not them.
DEFAULT_SHARE = 0.9

# Flickr signals overload in more than one way, and not always with a 429.
RATE_LIMITED_STATUS = {429, 503}
# Error 105 is "service currently unavailable", which is what a throttled key
# tends to get back inside a 200 response.
RATE_LIMITED_CODES = {105}
FATAL_CODES = {
    1,    # photo not found
    2,    # permission denied
    98,   # login failed / bad token
    99,   # user not logged in
    100,  # invalid api key
}

MIN_BACKOFF = 2.0
MAX_BACKOFF = 900.0


@dataclass
class Pacer:
    """Spreads a quota across an hour instead of sprinting into the ceiling."""

    quota: int = HOURLY_QUOTA
    share: float = DEFAULT_SHARE
    spent: int = 0
    window_started: float | None = None

    @property
    def budget(self) -> int:
        return max(1, int(self.quota * self.share))

    @property
    def interval(self) -> float:
        """Seconds between calls that would exactly consume the budget."""
        return 3600.0 / self.budget

    def next_wait(self, now: float) -> float:
        """How long to wait before spending the next query."""
        if self.window_started is None:
            return 0.0
        elapsed = now - self.window_started
        earned = elapsed / self.interval
        if self.spent < earned:
            return 0.0
        return max(0.0, (self.spent - earned) * self.interval)

    def record(self, now: float) -> None:
        if self.window_started is None or now - self.window_started >= 3600.0:
            self.window_started, self.spent = now, 0
        self.spent += 1


@dataclass(frozen=True)
class Decision:
    """What to do next: proceed, wait then retry, or stop."""

    action: str          # "proceed" | "retry" | "fail"
    wait: float = 0.0
    reason: str = ""

    @property
    def should_retry(self) -> bool:
        return self.action == "retry"


def backoff(attempt: int, *, jitter: random.Random | None = None) -> float:
    """Exponential, capped, with jitter.

    Jitter matters more than usual here: without it, several workers throttled
    at the same moment retry at the same moment, and the key is right back at
    its ceiling in lockstep.
    """
    # Cap the exponent, not only the result: retrying a throttled call for an
    # hour reaches attempt numbers where 2 ** attempt overflows a float.
    raw = min(MAX_BACKOFF, MIN_BACKOFF * (2 ** min(max(0, attempt), 20)))
    rng = jitter or random
    return raw * (0.5 + rng.random() * 0.5)


def classify(status: int | None, payload: dict | None) -> str:
    """"ok", "rate_limited" or "fatal", from a status code and a Flickr body."""
    if status in RATE_LIMITED_STATUS:
        return "rate_limited"
    if status is not None and status >= 500:
        return "rate_limited"      # transient; worth waiting out
    failed = bool(payload) and payload.get("stat") == "fail"
    code = None
    if failed:
        try:
            code = int(payload.get("code"))
        except (TypeError, ValueError):
            # Flickr said it failed; an unreadable code does not make it a
            # success. Treating it as one silently drops the photo.
            return "fatal"
    if code is None:
        return "ok" if (status is None or status < 400) else "fatal"
    if code in RATE_LIMITED_CODES:
        return "rate_limited"
    if code in FATAL_CODES:
        return "fatal"
    return "fatal"


def attempt(status: int | None, payload: dict | None, tries: int,
            *, max_tries: int = 5, jitter: random.Random | None = None) -> Decision:
    """Decide what to do with a response.

    Rate limiting retries without limit: the quota refills, so waiting always
    eventually works, and abandoning the photo means re-walking it later. Other
    failures get a bounded number of tries, because no amount of waiting fixes
    a photo that is not there.
    """
    kind = classify(status, payload)
    if kind == "ok":
        return Decision("proceed")
    if kind == "rate_limited":
        return Decision("retry", backoff(tries, jitter=jitter),
                        "rate limited; waiting for quota")
    if tries + 1 >= max_tries:
        return Decision("fail", 0.0, f"gave up after {tries + 1} attempts")
    return Decision("retry", backoff(tries, jitter=jitter), "transient failure")
