"""Manage the one household belonging to this Kindred installation."""

from contextlib import closing
from psycopg2 import sql
from psycopg2.extras import RealDictCursor
from fastapi import HTTPException

# Dedicated Kindred tables only. PostgreSQL rejects the truncation if a table
# outside this list references them. No CASCADE and no external file deletion.
HOUSEHOLD_TABLES = (
    "album_photos", "albums", "api_keys", "clusters", "detection_clusters",
    "detections", "dismissed_faces", "endpoint_cache", "event_labels",
    "household_flickr_connection", "household_owners", "identity_link_approvals", "invites",
    "nas_source_files", "notifications", "pairing_codes", "passkey_challenges",
    "photo_colors", "photo_copies", "photo_embeddings", "photo_favorites",
    "photo_metadata", "photo_people_tags", "photo_text", "photos", "processed_photos",
    "r2_thumbnail_objects", "replication_jobs", "scene_overrides", "sessions",
    "settings", "shares", "social_auth_assertions", "sync_logs", "upload_sessions",
    "user_identities", "user_passkeys",
)


def require_session(user):
    if not user.get("user_id") or user.get("auth_method") != "session":
        raise HTTPException(403, "Sign in to your Kindred account first.")
    return user["user_id"]


def status(query, session):
    rows = query("""
        SELECT EXISTS (SELECT 1 FROM household_owners WHERE user_id = u.id) AS is_owner,
               u.password_hash IS NOT NULL AS has_password,
               s.confirmed_at > now() - interval '5 minutes' AS recently_signed_in,
               (SELECT count(*) FROM users WHERE id <> u.id) AS other_members,
               ARRAY(SELECT provider FROM user_identities WHERE user_id = u.id ORDER BY provider) AS providers
        FROM sessions s JOIN users u ON u.id = s.user_id
        CROSS JOIN household_lifecycle h
        WHERE u.id = %s AND s.token = %s AND s.expires_at > now() AND h.closed_at IS NULL
    """, session)
    if not rows:
        raise HTTPException(403, "Sign in to your Kindred account first.")
    return dict(rows[0], recently_signed_in=bool(rows[0]["recently_signed_in"]))


def lock(cur):
    cur.execute("SELECT closed_at FROM household_lifecycle WHERE singleton FOR UPDATE")
    household = cur.fetchone()
    if household["closed_at"] is not None:
        raise HTTPException(410, "This household was deleted. Ask the server operator to set up a new installation.")
    cur.execute("SELECT user_id::text AS user_id FROM household_owners")
    return {row["user_id"] for row in cur.fetchall()}


def confirm(cur, actor, token, password, verify_password):
    cur.execute("""
        SELECT u.password_hash, s.confirmed_at > now() - interval '5 minutes' AS recent
        FROM users u JOIN sessions s ON s.user_id = u.id
        WHERE u.id = %s AND s.token = %s AND s.expires_at > now()
        FOR UPDATE OF s
    """, (actor, token))
    session = cur.fetchone()
    if not session:
        raise HTTPException(403, "Sign in to your Kindred account first.")
    if password is not None:
        if (len(password.encode("utf-8")) > 72 or not session["password_hash"]
                or not verify_password(password, session["password_hash"])):
            raise HTTPException(403, "Current password is incorrect.")
    elif not session["recent"]:
        raise HTTPException(403, "Sign in again to confirm this change.")
    else:
        # One fresh login can confirm one sensitive change.
        cur.execute("UPDATE sessions SET confirmed_at = NULL WHERE token = %s", (token,))


def transfer(connect, actor, target, token, password, verify_password):
    with closing(connect()) as conn, conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        if actor not in lock(cur):
            raise HTTPException(403, "Only household owners can transfer ownership.")
        if actor == target:
            raise HTTPException(400, "Choose another household member.")
        confirm(cur, actor, token, password, verify_password)
        cur.execute("UPDATE users SET role = 'admin', updated_at = now() WHERE id = %s RETURNING id", (target,))
        if not cur.fetchone():
            raise HTTPException(404, "Household member not found.")
        cur.execute("INSERT INTO household_owners (user_id) VALUES (%s) ON CONFLICT DO NOTHING", (target,))
        cur.execute("DELETE FROM household_owners WHERE user_id = %s", (actor,))


def remove_user(cur, user_id):
    # A redeemed invitation must never become usable again.
    cur.execute("DELETE FROM invites WHERE used_by = %s", (user_id,))
    cur.execute("DELETE FROM shares WHERE created_by = %s", (user_id,))
    cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


def delete_account(connect, actor, token, password, verify_password, revoke_apple):
    with closing(connect()) as conn, conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        owners = lock(cur)
        confirm(cur, actor, token, password, verify_password)
        if actor in owners:
            raise HTTPException(409, "Transfer ownership or use Delete Household to close the installation.")
        manual = revoke_apple(cur, actor)
        remove_user(cur, actor)
    return {"ok": True, "manual_apple_revocation": manual}


def delete_household(connect, actor, token, password, verify_password, revoke_apple):
    with closing(connect()) as conn, conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Use the same lock order as first-run and social account creation.
        cur.execute("SET LOCAL lock_timeout = '4s'")
        cur.execute("SELECT pg_advisory_xact_lock(4921733102)")
        if actor not in lock(cur):
            raise HTTPException(403, "Only household owners can delete it.")
        confirm(cur, actor, token, password, verify_password)
        manual = revoke_apple(cur, None)
        # Include users and its referencing lifecycle table in the truncate to
        # reclaim large catalog tables immediately, then recreate the seal.
        names = (*HOUSEHOLD_TABLES, "users", "household_lifecycle")
        cur.execute(sql.SQL("TRUNCATE {}").format(sql.SQL(", ").join(map(sql.Identifier, names))))
        cur.execute("INSERT INTO household_lifecycle (closed_at) VALUES (now())")
        for name in HOUSEHOLD_TABLES:
            cur.execute(sql.SQL("""
                CREATE TRIGGER kindred_closed BEFORE INSERT OR UPDATE ON {}
                FOR EACH STATEMENT EXECUTE FUNCTION kindred_reject_closed_write()
            """).format(sql.Identifier(name)))
    return {"ok": True, "manual_apple_revocation": manual}
