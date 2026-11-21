"""Shared catalog rules for non-destructive library cleanup."""

from typing import Literal

JunkMode = Literal["default", "all", "only"]
JUNK = "p.junk_classification IN ('screenshot', 'receipt', 'document', 'code', 'blank')"
AUTO_MARK = "COALESCE((SELECT value FROM settings WHERE key='library_junk_scanner'), 'true') = 'true'"


def visibility(mode: JunkMode, viewer_id=None):
    """Use an uncorrelated preference lookup so pagination stays a single query."""
    if mode == "only":
        return JUNK, []
    if mode == "all":
        return "TRUE", []
    visible = f"({JUNK}) IS NOT TRUE"
    if viewer_id:
        visible = f"({visible} OR EXISTS (SELECT 1 FROM users WHERE id=%s AND NOT hide_library_junk))"
    return visible, [viewer_id] if viewer_id else []


def preferences(query, user_id):
    rows = query(
        f"""SELECT COALESCE((SELECT hide_library_junk FROM users WHERE id=%s), TRUE) AS hide_junk,
                   {AUTO_MARK} AS auto_mark""",
        (user_id,),
    )
    return dict(rows[0])


def set_preferences(query, user_id, hide_junk, auto_mark):
    scanner_value = None if auto_mark is None else str(auto_mark).lower()
    rows = query(
        f"""WITH viewer AS (
                 UPDATE users SET hide_library_junk=COALESCE(%s, hide_library_junk)
                 WHERE id=%s RETURNING hide_library_junk
             ), scanner AS (
                 INSERT INTO settings (key, value, updated_at)
                 SELECT 'library_junk_scanner', %s::text, now() FROM viewer WHERE %s::text IS NOT NULL
                 ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()
                 RETURNING value
             )
             SELECT hide_library_junk AS hide_junk,
                    COALESCE((SELECT value='true' FROM scanner), {AUTO_MARK}) AS auto_mark
             FROM viewer""",
        (hide_junk, user_id, scanner_value, scanner_value),
    )
    return dict(rows[0]) if rows else None


def keep(query, photo_id):
    """Protect a reviewed photo from every subsequent automatic pass."""
    rows = query(
        f"""UPDATE photos AS p SET junk_classification='keep'
            WHERE p.id=%s AND (({JUNK}) OR p.junk_classification='keep')
            RETURNING id""",
        (photo_id,),
    )
    return bool(rows)
