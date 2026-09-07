"""Small, dependency-free PostgreSQL migration runner for self-hosted installs."""

from __future__ import annotations

from pathlib import Path
import os

import psycopg2


MIGRATIONS_DIR = Path(__file__).with_name("migrations")
MIGRATION_LOCK_ID = 4_921_733_101


def apply_migrations(database_url: str | None = None) -> list[str]:
    """Apply pending .sql files once, in filename order, under an advisory lock."""
    url = database_url or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is required")

    applied: list[str] = []
    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK_ID,))
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute("SELECT version FROM schema_migrations")
            completed = {row[0] for row in cur.fetchall()}

            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                if path.name in completed:
                    continue
                cur.execute(path.read_text(encoding="utf-8"))
                cur.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s)",
                    (path.name,),
                )
                applied.append(path.name)

    return applied


def pending_migrations(database_url: str | None = None) -> list[str]:
    """Names of migrations that have not been applied yet, in apply order."""
    url = database_url or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name='schema_migrations')"
            )
            completed: set[str] = set()
            if cur.fetchone()[0]:
                cur.execute("SELECT version FROM schema_migrations")
                completed = {row[0] for row in cur.fetchall()}
    return [p.name for p in sorted(MIGRATIONS_DIR.glob("*.sql")) if p.name not in completed]


def _main(argv: list[str] | None = None) -> int:
    """Apply migrations from the command line.

    The API also migrates on startup, but swallows failures into a log line —
    so when a migration matters, run it here and read the exit code.
    """
    import argparse

    parser = argparse.ArgumentParser(description="Apply Kindred database migrations.")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""),
                        help="Defaults to $DATABASE_URL.")
    parser.add_argument("--dry-run", action="store_true",
                        help="List what would be applied and exit without writing.")
    args = parser.parse_args(argv)

    if not args.database_url:
        print("DATABASE_URL is required (pass --database-url or set the variable).")
        return 2

    try:
        pending = pending_migrations(args.database_url)
    except Exception as exc:
        print(f"Could not read migration state: {exc}")
        return 1

    if not pending:
        print("Nothing to apply; the database is up to date.")
        return 0

    print(f"Pending ({len(pending)}):")
    for name in pending:
        print(f"  - {name}")
    if args.dry_run:
        print("\nDry run: nothing was written.")
        return 0

    try:
        applied = apply_migrations(args.database_url)
    except Exception as exc:
        print(f"\nMIGRATION FAILED: {exc}")
        print("Each file runs in its own transaction, so a failed file was rolled back.")
        return 1

    print("\nApplied:")
    for name in applied:
        print(f"  - {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
