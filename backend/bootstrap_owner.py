"""Set the owner of this Kindred installation."""
import argparse
from contextlib import closing
from getpass import getpass

from psycopg2.extras import RealDictCursor

from db_migrations import apply_migrations
from household_lifecycle import lock
from main import get_db, hash_password


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    parser.add_argument("--name", help="Display name for a new owner account")
    parser.add_argument("--claim-existing", action="store_true", help="Assign ownership to an existing admin")
    args = parser.parse_args()
    if args.claim_existing:
        if args.name:
            parser.error("--name is only used when creating an account")
        apply_migrations()
        with closing(get_db()) as conn, conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT pg_advisory_xact_lock(4921733102)")
            lock(cur)
            cur.execute("SELECT id FROM users WHERE username = %s AND role = 'admin'", (args.username,))
            admin = cur.fetchone()
            if admin is None:
                parser.error("The username must belong to an existing admin.")
            cur.execute(
                "INSERT INTO household_owners (user_id) VALUES (%s) ON CONFLICT DO NOTHING",
                (str(admin["id"]),),
            )
        print("Household ownership assigned.")
        return
    if not args.name:
        parser.error("--name is required when creating an account")
    password = getpass("Owner password: ")
    if not 12 <= len(password.encode("utf-8")) <= 72:
        parser.error("Choose a password between 12 and 72 UTF-8 bytes.")
    if password != getpass("Confirm password: "):
        parser.error("Passwords do not match.")

    apply_migrations()
    with closing(get_db()) as conn, conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT pg_advisory_xact_lock(4921733102)")
        lock(cur)
        cur.execute("SELECT EXISTS (SELECT 1 FROM users) AS configured")
        if cur.fetchone()["configured"]:
            parser.error("This installation already has accounts.")
        cur.execute("""
            INSERT INTO users (username, display_name, password_hash, role)
            VALUES (%s, %s, %s, 'admin')
        """, (args.username, args.name, hash_password(password)))
    print("Owner created. Sign in to Kindred with your username and password.")


if __name__ == "__main__":
    main()
