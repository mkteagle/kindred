"""Helpers for the isolated App Store review login."""

from datetime import datetime, timedelta, timezone
import hmac
import os


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
