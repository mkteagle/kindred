"""WebAuthn ceremonies for the configured Kindred web origin."""
from contextlib import closing
import json
import secrets
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import HTTPException
from psycopg2.extras import RealDictCursor


def relying_party(configured_url, request_origin):
    url = urlsplit(configured_url)
    origin = f"{url.scheme}://{url.netloc}"
    secure = url.scheme == "https" or (url.scheme == "http" and url.hostname == "localhost")
    if not (secure and url.hostname and request_origin == origin):
        raise HTTPException(400, "Passkeys are available on the configured Kindred sign-in address.")
    return origin, url.hostname


def save_challenge(query, options, purpose, origin, user_id=None):
    from webauthn import options_to_json

    challenge_id = secrets.token_urlsafe(32)
    query("DELETE FROM passkey_challenges WHERE expires_at <= now()", fetch=False)
    query(
        """INSERT INTO passkey_challenges (id, purpose, user_id, origin, challenge, expires_at)
           VALUES (%s, %s, %s, %s, %s, now() + interval '5 minutes')""",
        (challenge_id, purpose, user_id, origin, options.challenge),
        fetch=False,
    )
    return {"challenge_id": challenge_id, "options": json.loads(options_to_json(options))}


def take_challenge(query, challenge_id, purpose, origin, user_id=None):
    rows = query(
        """DELETE FROM passkey_challenges
           WHERE id = %s AND purpose = %s AND origin = %s
             AND user_id IS NOT DISTINCT FROM %s::uuid AND expires_at > now()
           RETURNING challenge""",
        (challenge_id, purpose, origin, user_id),
    )
    if not rows:
        raise HTTPException(400, "The passkey request expired. Please start again.")
    return bytes(rows[0]["challenge"])


def registration_options(query, origin, rp_id, user):
    from webauthn import generate_registration_options
    from webauthn.helpers import base64url_to_bytes
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
        ResidentKeyRequirement, UserVerificationRequirement,
    )

    user_id = str(user["user_id"])
    known = list_passkeys(query, user_id, rp_id)
    options = generate_registration_options(
        rp_id=rp_id, rp_name="Kindred", user_id=UUID(user_id).bytes,
        user_name=user["username"], user_display_name=user.get("display_name") or user["username"],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(key["credential_id"])) for key in known
        ],
    )
    return save_challenge(query, options, "register", origin, user_id)


def register(query, origin, rp_id, user_id, challenge_id, credential):
    from webauthn import verify_registration_response
    from webauthn.helpers import bytes_to_base64url
    from webauthn.helpers.exceptions import WebAuthnException

    challenge = take_challenge(query, challenge_id, "register", origin, user_id)
    try:
        verified = verify_registration_response(
            credential=credential, expected_challenge=challenge,
            expected_origin=origin, expected_rp_id=rp_id, require_user_verification=True,
        )
    except (WebAuthnException, ValueError, TypeError) as exc:
        raise HTTPException(400, "Kindred could not verify the new passkey.") from exc
    rows = query(
        """INSERT INTO user_passkeys (credential_id, user_id, rp_id, public_key, sign_count)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT DO NOTHING RETURNING credential_id""",
        (bytes_to_base64url(verified.credential_id), user_id, rp_id,
         verified.credential_public_key, verified.sign_count),
    )
    if not rows:
        raise HTTPException(409, "That passkey is already registered.")


def authentication_options(query, origin, rp_id):
    from webauthn import generate_authentication_options
    from webauthn.helpers.structs import UserVerificationRequirement

    options = generate_authentication_options(
        rp_id=rp_id, user_verification=UserVerificationRequirement.REQUIRED,
    )
    return save_challenge(query, options, "login", origin)


def authenticate(query, connect, create_session, origin, rp_id, challenge_id, credential):
    from webauthn import verify_authentication_response
    from webauthn.helpers import bytes_to_base64url, parse_authentication_credential_json
    from webauthn.helpers.exceptions import WebAuthnException

    challenge = take_challenge(query, challenge_id, "login", origin)
    try:
        parsed = parse_authentication_credential_json(credential)
        with closing(connect()) as conn, conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT u.id, u.username, u.display_name, u.role, p.public_key, p.sign_count
                   FROM user_passkeys p JOIN users u ON u.id = p.user_id
                   WHERE p.credential_id = %s AND p.rp_id = %s FOR UPDATE OF p""",
                (parsed.id, rp_id),
            )
            row = cur.fetchone()
            if not row or parsed.response.user_handle != UUID(str(row["id"])).bytes:
                raise HTTPException(401, "Kindred could not verify that passkey.")
            verified = verify_authentication_response(
                credential=parsed, expected_challenge=challenge, expected_origin=origin,
                expected_rp_id=rp_id, credential_public_key=bytes(row["public_key"]),
                credential_current_sign_count=row["sign_count"], require_user_verification=True,
            )
            cur.execute(
                """UPDATE user_passkeys SET sign_count = %s, last_used_at = now()
                   WHERE credential_id = %s""",
                (verified.new_sign_count, bytes_to_base64url(verified.credential_id)),
            )
            user = {key: row[key] for key in ("id", "username", "display_name", "role")}
    except (WebAuthnException, ValueError, TypeError) as exc:
        raise HTTPException(401, "Kindred could not verify that passkey.") from exc
    user["id"] = str(user["id"])
    return {"user": user, "session": create_session(user["id"])}


def list_passkeys(query, user_id, rp_id):
    return query(
        """SELECT credential_id, created_at, last_used_at FROM user_passkeys
           WHERE user_id = %s AND rp_id = %s ORDER BY created_at DESC""",
        (user_id, rp_id),
    )


def remove_passkey(query, user_id, rp_id, credential_id):
    query(
        "DELETE FROM user_passkeys WHERE user_id = %s AND rp_id = %s AND credential_id = %s",
        (user_id, rp_id, credential_id),
        fetch=False,
    )
