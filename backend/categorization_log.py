"""Persist NAS categorization failures and their next attempts in PostgreSQL."""

import psycopg2


RETRY_DELAYS_MINUTES = (5, 30, 120, 720, 1440)


class CategorizationError(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code


def describe_error(error, step):
    """Keep provider messages, filesystem paths and credentials out of the event log."""
    if isinstance(error, CategorizationError):
        return error
    if isinstance(error, (MemoryError, psycopg2.errors.OutOfMemory)):
        return CategorizationError("out_of_memory", f"Memory was exhausted while {step}.")
    if isinstance(error, psycopg2.Error):
        state = error.pgcode or "unavailable"
        return CategorizationError("database_error", f"PostgreSQL error while {step} (SQLSTATE {state}).")
    if isinstance(error, TimeoutError):
        return CategorizationError("timeout", f"Timed out while {step}.")
    if step == "decoding the image":
        return CategorizationError("decode_failed", f"The image decoder failed ({type(error).__name__}).")
    if isinstance(error, OSError) and step == "reading the source image":
        return CategorizationError("source_read_failed", f"Could not read the source image ({type(error).__name__}).")
    return CategorizationError("processing_error", f"Failed while {step} ({type(error).__name__}).")


def record_failure(query, photo_id, source_mtime_ns, error):
    query("""
        WITH failed_source AS (
            UPDATE nas_source_files SET ml_error = %s
            WHERE photo_id = %s AND mtime_ns = %s AND categorized_at IS NULL
            RETURNING photo_id, mtime_ns
        ), queued AS (
            INSERT INTO categorization_retries AS existing (photo_id, source_mtime_ns, attempts, next_attempt_at)
            SELECT photo_id, mtime_ns, 1, now() + make_interval(mins => (%s::int[])[1])
            FROM failed_source
            ON CONFLICT (photo_id) DO UPDATE SET
                source_mtime_ns = EXCLUDED.source_mtime_ns,
                attempts = CASE WHEN existing.source_mtime_ns = EXCLUDED.source_mtime_ns
                                THEN existing.attempts + 1 ELSE 1 END,
                next_attempt_at = now() + make_interval(mins => (%s::int[])[
                    CASE WHEN existing.source_mtime_ns = EXCLUDED.source_mtime_ns
                         THEN LEAST(existing.attempts + 1, %s) ELSE 1 END
                ])
            RETURNING photo_id, source_mtime_ns, attempts
        )
        INSERT INTO categorization_events (photo_id, source_mtime_ns, outcome, attempt, code, detail)
        SELECT photo_id, source_mtime_ns, 'failed', attempts, %s, %s FROM queued
    """, (str(error), photo_id, source_mtime_ns, list(RETRY_DELAYS_MINUTES),
          list(RETRY_DELAYS_MINUTES), len(RETRY_DELAYS_MINUTES), error.code, str(error)), fetch=False)


def record_success(cursor, photo_id, source_mtime_ns):
    cursor.execute("""
        WITH completed AS (
            UPDATE nas_source_files SET categorized_at = now(), ml_error = NULL
            WHERE photo_id = %s AND mtime_ns = %s AND categorized_at IS NULL
            RETURNING photo_id, mtime_ns
        ), recovered AS (
            DELETE FROM categorization_retries retry USING completed
            WHERE retry.photo_id = completed.photo_id
            RETURNING retry.photo_id, retry.source_mtime_ns, retry.attempts
        ), recorded AS (
            INSERT INTO categorization_events (photo_id, source_mtime_ns, outcome, attempt, code, detail)
            SELECT recovered.photo_id, source_mtime_ns, 'recovered', attempts + 1, 'recovered',
                   'Categorization succeeded on a later attempt.' FROM recovered
            JOIN completed ON completed.photo_id = recovered.photo_id AND completed.mtime_ns = recovered.source_mtime_ns
        )
        SELECT EXISTS (SELECT 1 FROM completed)
    """, (photo_id, source_mtime_ns))
    if not cursor.fetchone()[0]:
        raise CategorizationError("source_changed", "The file changed before analysis could be saved.")


def events(query, before=None, limit=50, history=False):
    latest_for_open_items = """
        AND p.id IN (
            SELECT source.photo_id
            FROM nas_source_files source
            JOIN categorization_retries active ON active.photo_id = source.photo_id
                 AND active.source_mtime_ns = source.mtime_ns
            WHERE source.ml_error IS NOT NULL AND source.categorized_at IS NULL
        )
        AND event.id = (
            SELECT max(latest.id) FROM categorization_events latest
            WHERE latest.photo_id = event.photo_id AND latest.source_mtime_ns = event.source_mtime_ns
        )
    """
    rows = query(f"""
        SELECT event.id, p.original_filename AS filename, event.outcome, event.attempt,
               event.code, event.detail, event.occurred_at,
               retry.next_attempt_at, source.preview_ready_at IS NOT NULL AS preview_ready
        FROM categorization_events event
        JOIN photos p ON p.id = event.photo_id
        LEFT JOIN categorization_retries retry ON retry.photo_id = p.id
            AND retry.source_mtime_ns = event.source_mtime_ns
        LEFT JOIN nas_source_files source ON source.photo_id = p.id
            AND source.mtime_ns = event.source_mtime_ns
        WHERE event.id < %s
        {'' if history else latest_for_open_items}
        ORDER BY event.id DESC LIMIT %s
    """, (before if before is not None else 2**63 - 1, limit + 1))
    return {"events": rows[:limit], "next_before": rows[limit - 1]["id"] if len(rows) > limit else None}
