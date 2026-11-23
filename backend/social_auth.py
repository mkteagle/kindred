"""Exchange a short-lived assertion from Kindred's own web server for a session.

The web server verifies the provider's ID token. This bridge is independently
signed, bound to this installation's secret, expires in a minute and is single-use.
"""
from datetime import datetime, timezone
from contextlib import closing
import jwt
from fastapi import HTTPException
from psycopg2.extras import RealDictCursor


def _verified_email(claims):
    email = claims.get("email")
    if claims.get("email_verified") is not True or not isinstance(email, str):
        return None
    email = email.strip().lower()
    if (len(email) > 320 or email.count("@") != 1 or email.startswith("@")
            or email.endswith("@") or any(char.isspace() for char in email)):
        return None
    return email


def _apple_google_match(cur, email, claims):
    # Google's older identity records only store provider-verified email.
    # Gmail addresses are Google-managed; third-party emails need explicit linking.
    if (claims["provider"] != "apple" or not email
            or email.rsplit("@", 1)[1] not in {"gmail.com", "googlemail.com"}
            or claims.get("private_email") is True):
        return None
    cur.execute("""
        SELECT u.id, u.username, u.display_name, u.role, apple.subject AS apple_subject
        FROM user_identities google
        JOIN users u ON u.id = google.user_id
        LEFT JOIN user_identities apple ON apple.user_id = u.id AND apple.provider = 'apple'
        WHERE google.provider = 'google' AND LOWER(google.email) = %s
        LIMIT 2
    """, (email,))
    rows = cur.fetchall()
    if len(rows) > 1 or (rows and rows[0]["apple_subject"]):
        raise HTTPException(409, "That email already has a conflicting sign-in connection")
    if not rows:
        return None
    user = dict(rows[0])
    user.pop("apple_subject")
    return user


def exchange_identity(assertion: str, secret: str, connect, create_session, current_user=None):
    if not secret:
        raise HTTPException(503, "Social sign-in is not configured on this server")
    try:
        claims = jwt.decode(assertion, secret, algorithms=["HS256"],
                            audience="kindred-backend", issuer="kindred-web",
                            options={"require": ["exp", "iat", "jti", "sub", "provider"]})
        if claims["provider"] not in ("google", "apple") or claims['exp'] - claims['iat'] > 60:
            raise ValueError("Invalid assertion")
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(401, "Invalid social sign-in assertion")

    email = _verified_email(claims)
    with closing(connect()) as conn, conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("DELETE FROM social_auth_assertions WHERE expires_at < now()")
            cur.execute("INSERT INTO social_auth_assertions (id, expires_at) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING id",
                        (claims['jti'], datetime.fromtimestamp(claims['exp'], timezone.utc)))
            if not cur.fetchone():
                raise HTTPException(401, "Social sign-in assertion already used")
            # Serialize account creation/linking, including an empty installation.
            cur.execute("SELECT pg_advisory_xact_lock(4921733102)")
            cur.execute("SELECT u.id, u.username, u.display_name, u.role FROM user_identities i JOIN users u ON u.id=i.user_id WHERE i.provider=%s AND i.subject=%s",
                        (claims['provider'], claims['sub']))
            identity = cur.fetchone()
            link_id = claims.get('link_user_id')
            if link_id:
                if not current_user or str(current_user.get('user_id')) != link_id:
                    raise HTTPException(403, "Sign in to the account before linking it")
                if identity and str(identity['id']) != link_id:
                    raise HTTPException(409, "This provider is already linked to another account")
                cur.execute("SELECT id, username, display_name, role FROM users WHERE id=%s", (link_id,))
                user = cur.fetchone()
                if not user:
                    raise HTTPException(404, "Account not found")
                cur.execute("SELECT subject FROM user_identities WHERE user_id=%s AND provider=%s", (link_id, claims['provider']))
                existing = cur.fetchone()
                if existing and existing['subject'] != claims['sub']:
                    raise HTTPException(409, "A different identity is already linked for this provider")
            elif identity:
                user = identity
            else:
                approved = None
                if email:
                    cur.execute("SELECT user_id, linked_subject FROM identity_link_approvals WHERE provider=%s AND email=%s FOR UPDATE",
                                (claims['provider'], email))
                    approved = cur.fetchone()
                if approved:
                    if approved['linked_subject'] and approved['linked_subject'] != claims['sub']:
                        raise HTTPException(409, "This email approval has already been used by a different identity")
                    cur.execute("SELECT id, username, display_name, role FROM users WHERE id=%s", (str(approved['user_id']),))
                    user = cur.fetchone()
                    if not user:
                        raise HTTPException(403, "The approved account is no longer available")
                    cur.execute("SELECT subject FROM user_identities WHERE user_id=%s AND provider=%s", (str(user['id']), claims['provider']))
                    existing = cur.fetchone()
                    if existing and existing['subject'] != claims['sub']:
                        raise HTTPException(409, "A different identity is already linked to this account")
                    cur.execute("UPDATE identity_link_approvals SET linked_subject=%s, linked_at=now() WHERE provider=%s AND email=%s",
                                (claims['sub'], claims['provider'], email))
                else:
                    user = _apple_google_match(cur, email, claims)
                if user is None:
                    invite_code = claims.get('invite_code')
                    if invite_code:
                        cur.execute("SELECT id, role FROM invites WHERE code=%s AND used_by IS NULL AND expires_at>now() FOR UPDATE", (invite_code.upper(),))
                        invite = cur.fetchone()
                        if not invite:
                            raise HTTPException(403, "Invalid or expired invitation")
                        role = invite['role']
                    else:
                        cur.execute("SELECT count(*) AS n FROM users")
                        if cur.fetchone()['n']:
                            raise HTTPException(403, "account_not_linked")
                        role = 'admin'
                    username = f"{claims['provider']}-{claims['jti'][:12]}"
                    cur.execute("INSERT INTO users (username, display_name, role) VALUES (%s,%s,%s) RETURNING id, username, display_name, role",
                                (username, (claims.get('name') or email or 'Kindred member')[:200], role))
                    user = cur.fetchone()
                    if invite_code:
                        cur.execute("UPDATE invites SET used_by=%s WHERE id=%s", (str(user['id']), str(invite['id'])))
            cur.execute("""
                INSERT INTO user_identities (provider, subject, user_id, email) VALUES (%s,%s,%s,%s)
                ON CONFLICT (provider, subject) DO UPDATE
                SET email = COALESCE(EXCLUDED.email, user_identities.email)
            """, (claims['provider'], claims['sub'], str(user['id']), email))
            if claims["provider"] == "apple" and claims.get("apple_refresh_token"):
                from apple_account import save_token
                save_token(cur, claims["sub"], claims["apple_refresh_token"], secret)
    uid = str(user['id'])
    return {'user': dict(user, id=uid), 'session': create_session(uid)}
