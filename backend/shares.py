"""Share-link capabilities: minting, validating and scoping public access.

A share token is a bearer capability. Three rules follow from that, and every
function here exists to enforce one of them:

1. The token is never stored. Only its SHA-256 hash is, so a database leak
   yields no working links. Lookup hashes the presented token and matches.
2. A token carries its own scope. Resolving one yields exactly one photo or
   one album; a caller must check every requested photo against that scope
   rather than trusting an id from the request.
3. A token is revocable and may expire. Validity is decided at request time,
   never cached into a session.

Kept free of database and framework imports so the rules can be tested
directly.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import secrets

# 32 bytes of entropy, URL-safe. Long enough that guessing is hopeless and
# short enough to paste into a message.
TOKEN_BYTES = 32

SUBJECT_TYPES = ("photo", "album")


class ShareError(Exception):
    """A share token was absent, unknown, revoked, expired or locked."""

    def __init__(self, reason: str, status: int = 404):
        super().__init__(reason)
        self.reason = reason
        self.status = status


def mint_token() -> tuple[str, str]:
    """Return (token, token_hash). The token is shown to the user once."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    """Deterministic hash, so the stored form is still indexable."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalise_subject(subject_type: str, photo_id, album_id):
    """Validate that exactly one subject is present and matches its type."""
    if subject_type not in SUBJECT_TYPES:
        raise ShareError("subject_type must be photo or album", status=400)
    if subject_type == "photo":
        if not photo_id or album_id:
            raise ShareError("A photo share needs photo_id and no album_id", status=400)
        return photo_id, None
    if not album_id or photo_id:
        raise ShareError("An album share needs album_id and no photo_id", status=400)
    return None, album_id


def check_live(share: dict, now: datetime | None = None) -> None:
    """Raise unless the share is still usable.

    Revoked and expired both read as 404 rather than 410: a link that is gone
    should not confirm to a stranger that it ever existed.
    """
    if share is None:
        raise ShareError("Share not found")
    if share.get("revoked_at"):
        raise ShareError("Share not found")
    expires_at = share.get("expires_at")
    if expires_at:
        now = now or datetime.now(timezone.utc)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= now:
            raise ShareError("Share not found")


def requires_password(share: dict) -> bool:
    return bool(share.get("password_hash"))


def scope_allows(share: dict, photo_id: str, album_photo_ids) -> bool:
    """Is `photo_id` inside this share?

    The caller supplies album membership rather than this module querying for
    it, so the containment rule stays testable and has one obvious reading.
    """
    if share["subject_type"] == "photo":
        return str(share["photo_id"]) == str(photo_id)
    return str(photo_id) in {str(candidate) for candidate in album_photo_ids}


def public_view(share: dict, *, items, unlocked: bool) -> dict:
    """The shape a share is exposed to an anonymous viewer.

    Deliberately narrow: no owner, no internal ids beyond the photo ids needed
    to fetch media, no counts. A locked share reveals nothing but its need for
    a password.
    """
    if requires_password(share) and not unlocked:
        return {
            "locked": True,
            "subject_type": share["subject_type"],
            "title": share.get("title") or "",
            "items": [],
            "allow_download": False,
        }
    return {
        "locked": False,
        "subject_type": share["subject_type"],
        "title": share.get("title") or "",
        "items": items,
        "allow_download": bool(share.get("allow_download")),
        "expires_at": share["expires_at"].isoformat() if share.get("expires_at") else None,
    }


# ── Signed media URLs ────────────────────────────────────────────────────────
# A password-protected share cannot put its password in an <img src>, and must
# not fall back to a session. Instead, unlocking hands back per-photo URLs
# carrying a short-lived HMAC bound to (share, photo, expiry) — the same shape
# a CDN uses for signed assets. A leaked URL grants one photo for a few minutes
# and nothing else.

MEDIA_URL_TTL_SECONDS = 900


def signing_key(api_key: str) -> bytes:
    """Derive a signing key from the deployment secret, domain-separated.

    Deriving rather than reusing API_KEY directly means a share signature can
    never be replayed as, or confused with, an API credential.
    """
    return hashlib.sha256(b"kindred-share-media-v1|" + api_key.encode("utf-8")).digest()


def sign_media(key: bytes, share_id: str, photo_id: str, expires_unix: int) -> str:
    message = f"{share_id}|{photo_id}|{expires_unix}".encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def verify_media(key: bytes, share_id: str, photo_id: str, expires_unix: int,
                 signature: str, now_unix: int | None = None) -> bool:
    """Constant-time check of a media signature, including its expiry."""
    now_unix = now_unix if now_unix is not None else int(datetime.now(timezone.utc).timestamp())
    if expires_unix <= now_unix:
        return False
    expected = sign_media(key, share_id, photo_id, expires_unix)
    return hmac.compare_digest(expected, signature or "")
