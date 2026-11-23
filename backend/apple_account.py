"""Store provider credentials solely for Sign in with Apple revocation."""

import base64
from datetime import datetime, timezone
import hashlib
import hmac
import logging
import os
import time

import httpx
import jwt

logger = logging.getLogger(__name__)


def _cipher(secret):
    from cryptography.fernet import Fernet

    key = hmac.digest(secret.encode(), b"kindred/apple-account-revocation/v1", hashlib.sha256)
    return Fernet(base64.urlsafe_b64encode(key))


def save_token(cur, subject, token, secret):
    if isinstance(token, str) and 1 <= len(token) <= 4096:
        cur.execute("""
            UPDATE user_identities SET apple_refresh_token = %s
            WHERE provider = 'apple' AND subject = %s
        """, (_cipher(secret).encrypt(token.encode()), subject))


def revoke(cur, user_id, secret):
    cur.execute("""
        SELECT apple_refresh_token FROM user_identities
        WHERE provider = 'apple' AND (%s::uuid IS NULL OR user_id = %s::uuid)
    """, (user_id, user_id))
    tokens = [r["apple_refresh_token"] for r in cur.fetchall()]
    if not tokens:
        return False

    client, team, key_id, key = (os.environ.get(name) for name in (
        "APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY",
    ))
    if not all((client, team, key_id, key, secret)) or not any(tokens):
        return True

    from cryptography.fernet import InvalidToken

    now = int(datetime.now(timezone.utc).timestamp())
    try:
        client_secret = jwt.encode(
            {"sub": client, "iss": team, "aud": "https://appleid.apple.com", "iat": now, "exp": now + 300},
            key.replace("\\n", "\n").strip(), algorithm="ES256", headers={"kid": key_id},
        )
    except (jwt.PyJWTError, TypeError, ValueError):
        logger.warning("Sign in with Apple revocation could not be configured")
        return True

    manual = False
    deadline = time.monotonic() + 6
    for token in tokens:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return True
        if not token:
            manual = True
            continue
        try:
            response = httpx.post("https://appleid.apple.com/auth/revoke", data={
                "client_id": client, "client_secret": client_secret,
                "token": _cipher(secret).decrypt(bytes(token)).decode(),
                "token_type_hint": "refresh_token",
            }, timeout=min(remaining, 2))
            manual |= response.status_code != 200
        except (httpx.HTTPError, InvalidToken):
            manual = True
    return manual
