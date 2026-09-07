"""Album naming rules, kept pure so they can be tested without a database.

An album's slug is load-bearing in two places: it is the URL reference and it
is the directory name under `albums/` on the NAS. Both want the same
conservative alphabet, which `LocalStorageProvider` re-checks before it will
create a directory.
"""

from __future__ import annotations

from typing import Iterable
import re

MAX_SLUG_LENGTH = 80


def album_slug(name: str) -> str:
    """Reduce a display name to a filesystem- and URL-safe slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug[:MAX_SLUG_LENGTH].strip("-") or "album"


def unique_album_slug(name: str, taken: Iterable[str]) -> str:
    """Return `album_slug(name)`, suffixed if that slug is already in use."""
    taken = set(taken)
    base = album_slug(name)
    if base not in taken:
        return base
    for n in range(2, 1000):
        candidate = f"{base}-{n}"
        if candidate not in taken:
            return candidate
    raise ValueError(f"Could not find a free slug for {name!r}")
