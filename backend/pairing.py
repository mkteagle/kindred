"""Pairing codes: teaching a phone where its household's server lives.

The hard part of self-hosting is not running the server, it is telling the
phone about it — a URL behind someone's own tunnel, plus credentials, typed on
a touchscreen. A pairing code carries both, and is designed to be safe to show
on a screen for a minute:

  * short and unambiguous, so it can be read aloud or typed if a camera fails
  * stored only as a hash, so the database never holds a working code
  * single-use and short-lived, so a shoulder-surfed code is worthless quickly

Kept free of database and framework imports so the rules can be tested
directly.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import secrets

# No 0/O/1/I/L — these are read off a screen and sometimes read aloud.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8
GROUP_SIZE = 4

# Long enough to walk to another room, short enough that an observed code is
# useless by the time it could be used.
TTL_SECONDS = 600

# An account may not stockpile open codes; a stolen screen should not yield a
# drawer full of valid ones.
MAX_OPEN_CODES = 3


class PairingError(Exception):
    def __init__(self, reason: str, status: int = 400):
        super().__init__(reason)
        self.reason = reason
        self.status = status


def mint_code() -> tuple[str, str]:
    """Return (code, code_hash). The code is displayed once and never stored."""
    raw = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
    return raw, hash_code(raw)


def normalise(code: str) -> str:
    """Accept what a person might actually type: spacing, dashes, lower case.

    Deliberately does not map look-alikes (O to 0, l to 1) — the alphabet
    excludes them, so a look-alike means a genuine mistype and should fail
    rather than silently resolve to someone else's code.
    """
    return "".join(ch for ch in (code or "").upper() if ch in ALPHABET)


def hash_code(code: str) -> str:
    return hashlib.sha256(normalise(code).encode("utf-8")).hexdigest()


def format_code(code: str) -> str:
    """Group for display: ABCD-EFGH."""
    clean = normalise(code)
    return "-".join(clean[i:i + GROUP_SIZE] for i in range(0, len(clean), GROUP_SIZE))


def expiry(now: datetime | None = None) -> datetime:
    return (now or datetime.now(timezone.utc)) + timedelta(seconds=TTL_SECONDS)


def check_claimable(row: dict | None, now: datetime | None = None) -> None:
    """Raise unless this code can still be claimed.

    Unknown, expired and already-claimed all answer the same way: a caller
    guessing codes learns nothing about which of its guesses came close.
    """
    if row is None:
        raise PairingError("That code is not valid", status=404)
    if row.get("claimed_at"):
        raise PairingError("That code is not valid", status=404)
    now = now or datetime.now(timezone.utc)
    expires_at = row.get("expires_at")
    if expires_at is None:
        raise PairingError("That code is not valid", status=404)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise PairingError("That code is not valid", status=404)


def pairing_payload(code: str, server_url: str) -> dict:
    """What the QR encodes.

    A custom scheme so the phone can be opened straight from the camera, with
    the fields also present so a person can pair by hand if scanning fails.
    """
    clean = normalise(code)
    server = (server_url or "").rstrip("/")
    return {
        "url": f"kindred://pair?server={server}&code={clean}",
        "server_url": server,
        "code": clean,
        "display_code": format_code(clean),
        "expires_in_seconds": TTL_SECONDS,
    }


def seconds_remaining(expires_at: datetime, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return max(0, int((expires_at - now).total_seconds()))
