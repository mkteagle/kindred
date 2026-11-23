"""Helpers for the isolated App Store review login."""

from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import hmac
import os
import re


def review_credentials_match(username: str, password: str) -> bool:
    """Return true only when both configured review credentials match exactly."""
    configured_username = os.environ.get("APP_REVIEW_USERNAME", "")
    configured_password = os.environ.get("APP_REVIEW_PASSWORD", "")
    if not configured_username or not configured_password:
        return False
    return hmac.compare_digest(username, configured_username) and hmac.compare_digest(
        password, configured_password
    )


def build_review_auth_response(username: str) -> dict:
    """Return a client-only session that cannot authorize private API requests."""
    expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    return {
        "user": {
            "id": "app_review_demo",
            "username": username,
            "display_name": "App Review",
            "role": "member",
            "avatar_url": None,
        },
        "session": {
            "token": "review-demo",
            "expires_at": expires_at.isoformat(),
        },
        "review_demo": True,
    }

REVIEW_USERNAME = "kindred-reviewer"
REVIEW_PUBLIC = frozenset({
    ("GET", "/"), ("GET", "/health"), ("GET", "/app-config"), ("POST", "/auth/login"),
})
_REVIEW_READS = frozenset({
    "/auth/me", "/stats", "/admin/indexing-progress", "/pipelines",
    "/library/photos", "/library/counts", "/library/years", "/library/day-labels",
    "/library/junk-settings", "/albums", "/favorites", "/favorites/count",
    "/search", "/timeline", "/locations", "/clusters/named", "/notifications",
    "/storage/status", "/integrations/flickr", "/health/backup",
})
REVIEW_ARCHIVE_ROUTE = re.compile(r"/review/photos/[a-f0-9-]{36}/archive")
review_session = ContextVar("review_session", default="")
_REVIEW_READ_ROUTE = re.compile(
    r"/albums/[A-Za-z0-9-]+(?:/photos)?"
    r"|/clusters/(?:people|pets|animals|vehicles)/(?:summary|[a-f0-9-]{36}|[0-9]+)"
    r"|/photos/[a-f0-9-]{36}/(?:local|image|metadata|detections|favorite)"
)


def review_route_allowed(method, path):
    return (
        (method, path) in REVIEW_PUBLIC
        or method == "POST" and (path == "/auth/logout" or REVIEW_ARCHIVE_ROUTE.fullmatch(path) is not None)
        or method in ("GET", "HEAD") and (path in _REVIEW_READS or _REVIEW_READ_ROUTE.fullmatch(path) is not None)
    )

def session_key(token):
    return sha256(token.encode()).hexdigest()


def prepare_review_archive(cursor):
    # This namespace exists only in the separately seeded review database.
    cursor.execute("""
        CREATE SCHEMA IF NOT EXISTS kindred_review;
        CREATE TABLE IF NOT EXISTS kindred_review.archives (
            review_session text NOT NULL,
            photo_id uuid NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
            restore_at timestamptz NOT NULL,
            PRIMARY KEY (review_session, photo_id)
        );
        CREATE OR REPLACE VIEW kindred_review.photos AS
        SELECT photo.* FROM public.photos AS photo
        WHERE NOT EXISTS (
            SELECT 1 FROM kindred_review.archives AS archive
            WHERE archive.photo_id = photo.id
              AND archive.review_session = current_setting('kindred.review_session', true)
              AND archive.restore_at > now()
        );
    """)


def configure_review_connection(cursor, key):
    cursor.execute("SET LOCAL search_path TO kindred_review, public")
    cursor.execute("SELECT set_config('kindred.review_session', %s, true)", (key,))


def archive_review_photo(query, key, photo_id):
    query("DELETE FROM kindred_review.archives WHERE restore_at <= now()", fetch=False)
    rows = query("""
        INSERT INTO kindred_review.archives (review_session, photo_id, restore_at)
        SELECT %s, id, now() + interval '1 hour' FROM public.photos
        WHERE id = %s::uuid AND client_upload_id LIKE 'app-review-fixture-%%'
        ON CONFLICT (review_session, photo_id) DO UPDATE
            SET restore_at = GREATEST(archives.restore_at, EXCLUDED.restore_at)
        RETURNING restore_at
    """, (key, str(photo_id)))
    return dict(rows[0]) if rows else None
