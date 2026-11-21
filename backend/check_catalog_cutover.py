"""Compare a frozen Kindred source and target before switching application traffic."""
import os

import psycopg2
from psycopg2 import sql


CHECKS = {
    "users": "id::text",
    "user_identities": "jsonb_build_array(provider, subject, user_id)::text",
    "sessions": "jsonb_build_array(id, user_id)::text",
    "photos": "id::text",
    "photo_copies": "jsonb_build_array(photo_id, provider, provider_key, status)::text",
    "albums": "id::text",
    "album_photos": "jsonb_build_array(album_id, photo_id)::text",
    "photo_embeddings": "photo_id",
}


def summarize(dsn):
    with psycopg2.connect(dsn, connect_timeout=8) as connection:
        connection.set_session(readonly=True, isolation_level="REPEATABLE READ")
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '90s'")
            cursor.execute("SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')")
            extensions = {row[0] for row in cursor.fetchall()}
            checks = {}
            for table, identity in CHECKS.items():
                cursor.execute(sql.SQL("SELECT count(*), bit_xor(hashtextextended({}, 0)) FROM {}")
                               .format(sql.SQL(identity), sql.Identifier(table)))
                checks[table] = cursor.fetchone()
            return extensions, checks


def main():
    try:
        _, source = summarize(os.environ["KINDRED_SOURCE_DATABASE_URL"])
        extensions, target = summarize(os.environ["KINDRED_TARGET_DATABASE_URL"])
    except (KeyError, psycopg2.Error) as error:
        # A driver's connection failure can contain a private hostname or user.
        print(f"Catalog comparison could not complete ({type(error).__name__})")
        return 1
    for table in CHECKS:
        print(f"{table}: {source[table][0]:,} source, {target[table][0]:,} target"
              f" · {'match' if source[table] == target[table] else 'different'}")
    ready = extensions == {"vector", "pg_trgm"} and source == target
    print("Catalog identity checks passed" if ready else "Catalog is not ready for cutover")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
