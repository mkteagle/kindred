def credentials(query, required_owner, legacy):
    """Resolve the installation's one destination independently of its members."""
    rows = query("""
        SELECT flickr_user_id AS user_id, oauth_token, oauth_secret,
               verified_at IS NOT NULL AS verified
        FROM household_flickr_connection WHERE singleton
    """)
    selection = rows[0] if rows else legacy
    if not selection or not all(selection.get(key) for key in ("user_id", "oauth_token", "oauth_secret")):
        return None
    if required_owner and selection["user_id"] != required_owner:
        return None
    return dict(selection)


def connect(query, account, required_owner):
    """Pin a verified destination, or refresh credentials for its existing owner."""
    if required_owner and account["user_id"] != required_owner:
        return False
    rows = query("""
        INSERT INTO household_flickr_connection
            (singleton, flickr_user_id, oauth_token, oauth_secret, verified_at)
        VALUES (TRUE, %s, %s, %s, now())
        ON CONFLICT (singleton) DO UPDATE SET
            flickr_user_id = EXCLUDED.flickr_user_id,
            oauth_token = EXCLUDED.oauth_token,
            oauth_secret = EXCLUDED.oauth_secret,
            verified_at = now()
        WHERE household_flickr_connection.flickr_user_id = EXCLUDED.flickr_user_id
           OR EXCLUDED.flickr_user_id = %s
        RETURNING flickr_user_id
    """, (account["user_id"], account["oauth_token"], account["oauth_secret"], required_owner or None))
    return bool(rows)
