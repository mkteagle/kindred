"""Turn "videos of Jen from last summer" into search facets.

A small local model is good at spotting which words are a person, which are a
media type, and which are a time expression. It is bad at arithmetic and worse
at inventing valid identifiers. So the split is:

    model  -> names a person, a media kind, and a relative period token
    Python -> resolves the period to real dates, and resolves the person name
              to a cluster id it actually holds

Nothing the model emits reaches SQL. `to_facets` only ever returns values from
fixed vocabularies plus dates this module computed, and an unrecognised answer
degrades to a plain text search rather than failing.
"""

from __future__ import annotations

from datetime import date, timedelta
import json
import re

MEDIA_KINDS = {"all", "photo", "video"}

# Meteorological seasons, northern hemisphere. Named rather than computed so
# "summer" means the same thing every time it is asked for.
SEASONS = {"spring": (3, 5), "summer": (6, 8), "fall": (9, 11), "autumn": (9, 11)}

PERIOD_TOKENS = {
    "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
    "this_year", "last_year", "last_spring", "last_summer", "last_fall",
    "last_autumn", "last_winter",
}

RELATIVE_DAYS = re.compile(r"^last_(\d{1,4})_days$")
RELATIVE_MONTHS = re.compile(r"^last_(\d{1,3})_months$")
EXPLICIT_YEAR = re.compile(r"^year:(\d{4})$")
EXPLICIT_MONTH = re.compile(r"^month:(\d{4})-(\d{2})$")

PROMPT = """You convert a photo library search into JSON. Reply with JSON only.

Fields:
  "media"  : "photo", "video", or "all"
  "person" : a name from the list below, or null
  "period" : one of {periods}, or "year:YYYY", or "month:YYYY-MM", or "last_N_days", or null
  "text"   : what remains to search for visually, or null

Known people: {people}

Examples:
  "videos of Jen from last summer" -> {{"media":"video","person":"Jen","period":"last_summer","text":null}}
  "sunset over water"              -> {{"media":"all","person":null,"period":null,"text":"sunset over water"}}
  "photos from 2019"               -> {{"media":"photo","person":null,"period":"year:2019","text":null}}

Query: {query}
JSON:"""


def build_prompt(query: str, people, periods=None) -> str:
    names = ", ".join(sorted({p for p in people if p})[:80]) or "(none)"
    return PROMPT.format(
        query=query.strip(),
        people=names,
        periods=", ".join(sorted(periods or PERIOD_TOKENS)),
    )


def parse_response(raw: str) -> dict | None:
    """Pull the JSON object out of a model reply, tolerating chatter around it."""
    if not raw:
        return None
    text = raw.strip()
    # Small models like to wrap answers in prose or fences.
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start:end + 1])
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _month_span(year: int, first: int, last: int) -> tuple[str, str]:
    start = date(year, first, 1)
    end = date(year + (1 if last == 12 else 0), 1 if last == 12 else last + 1, 1) - timedelta(days=1)
    return start.isoformat(), end.isoformat()


def resolve_period(token, today: date) -> tuple[str, str] | None:
    """Resolve a period token to an inclusive (from, to) pair of ISO dates."""
    if not token or not isinstance(token, str):
        return None
    token = token.strip().lower()

    if token == "today":
        return today.isoformat(), today.isoformat()
    if token == "yesterday":
        day = today - timedelta(days=1)
        return day.isoformat(), day.isoformat()
    if token == "this_week":
        start = today - timedelta(days=today.weekday())
        return start.isoformat(), today.isoformat()
    if token == "last_week":
        start = today - timedelta(days=today.weekday() + 7)
        return start.isoformat(), (start + timedelta(days=6)).isoformat()
    if token == "this_month":
        return _month_span(today.year, today.month, today.month)
    if token == "last_month":
        year, month = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
        return _month_span(year, month, month)
    if token == "this_year":
        return date(today.year, 1, 1).isoformat(), today.isoformat()
    if token == "last_year":
        return _month_span(today.year - 1, 1, 12)

    if token.startswith("last_"):
        season = token[len("last_"):]
        if season == "winter":
            # Winter spans a year boundary; "last winter" is the most recent one.
            year = today.year if today.month >= 3 else today.year - 1
            start = date(year - 1, 12, 1)
            end = date(year, 3, 1) - timedelta(days=1)
            return start.isoformat(), end.isoformat()
        if season in SEASONS:
            first, last = SEASONS[season]
            # If that season has not finished this year, mean last year's.
            year = today.year if today.month > last else today.year - 1
            return _month_span(year, first, last)

    days = RELATIVE_DAYS.match(token)
    if days:
        return (today - timedelta(days=int(days.group(1)))).isoformat(), today.isoformat()

    months = RELATIVE_MONTHS.match(token)
    if months:
        return (today - timedelta(days=30 * int(months.group(1)))).isoformat(), today.isoformat()

    year_match = EXPLICIT_YEAR.match(token)
    if year_match:
        return _month_span(int(year_match.group(1)), 1, 12)

    month_match = EXPLICIT_MONTH.match(token)
    if month_match:
        year, month = int(month_match.group(1)), int(month_match.group(2))
        if 1 <= month <= 12:
            return _month_span(year, month, month)

    return None


def match_person(name, people):
    """Find the person the model named. `people` is [{label, cluster_id, category}].

    Exact match first, then case-insensitive, then a first-name match — a
    person saying "Jen" should reach "Jen Teagle", but never two of them.
    """
    if not name or not isinstance(name, str):
        return None
    wanted = name.strip().lower()
    if not wanted:
        return None

    for person in people:
        if (person["label"] or "").lower() == wanted:
            return person

    prefixed = [p for p in people if (p["label"] or "").lower().startswith(wanted + " ")]
    return prefixed[0] if len(prefixed) == 1 else None


def to_facets(parsed, people, today: date) -> dict:
    """Validate a model answer into facet arguments.

    Every value returned here is either from a fixed vocabulary, a date this
    module computed, or an id taken from `people` — never a string the model
    invented.
    """
    result = {"media": "all", "date_from": None, "date_to": None,
              "cluster_id": None, "category": None, "text": "", "person_label": None}
    if not isinstance(parsed, dict):
        return result

    media = parsed.get("media")
    if isinstance(media, str) and media.lower() in MEDIA_KINDS:
        result["media"] = media.lower()

    period = resolve_period(parsed.get("period"), today)
    if period:
        result["date_from"], result["date_to"] = period

    person = match_person(parsed.get("person"), people)
    if person:
        result["cluster_id"] = person["cluster_id"]
        result["category"] = person["category"]
        result["person_label"] = person["label"]

    text = parsed.get("text")
    result["text"] = text.strip() if isinstance(text, str) and text.strip() else ""
    return result
