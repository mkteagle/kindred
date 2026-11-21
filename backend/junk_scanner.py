"""Reuse existing CLIP embeddings to classify probable non-photo clutter."""

from functools import lru_cache
import re
from pathlib import PurePosixPath

import numpy as np

from library_junk import AUTO_MARK

# Require a conventional screenshot export name. A filename such as
# "screenshot ideas from the trip" isn't, by itself, evidence of a screenshot.
SCREENSHOT_NAME = re.compile(
    r"^screen[ _-]?shot(?:[ _-]*\(?\d[\d ().:_a-z-]*)?$", re.IGNORECASE
)

PROMPTS = {
    "screenshot": (
        "a screenshot of a mobile app interface with buttons, text and a status bar",
        "a computer screenshot of an application or web browser window",
        "a screenshot of a text message conversation",
    ),
    "receipt": (
        "a close-up image of a printed payment receipt or invoice filling the frame",
    ),
    "document": (
        "a flat scan of a printed form, bill, or typed document filling the entire image",
    ),
    "code": (
        "a standalone black QR code or barcode on a plain white background",
    ),
    "blank": (
        "an empty solid black image with no subject, objects or details",
        "an empty solid white image with no subject, objects or details",
    ),
    "photo": (
        "a candid family photograph of people, animals, food or a place",
        "a blurry or underexposed camera photograph taken at a family event",
        "a photograph of a real object, piece of artwork, printed sign or handwritten note",
        "an old scanned family photograph or print with people or a landscape",
        "a colorful illustration or digital artwork",
        "a photograph of a dark night scene, the sky, a white wall, or a snowy landscape",
    ),
}


def filename_reason(filename, title):
    for name in (filename, title):
        if name and SCREENSHOT_NAME.fullmatch(PurePosixPath(name.replace("\\", "/")).stem.strip()):
            return "screenshot"
    return None


@lru_cache(maxsize=1)
def prompt_vectors(embed_text):
    return {
        kind: np.stack([embed_text(prompt) for prompt in prompts])
        for kind, prompts in PROMPTS.items()
    }


def visual_reason(embedding, vectors):
    scores = {kind: float((prompts @ embedding).max()) for kind, prompts in vectors.items()}
    candidate = max((kind for kind in scores if kind != "photo"), key=scores.get)
    # CLIP scores are similarities, not probabilities. Keep uncertain photos,
    # including blur alone, and require a margin over the photographic prompts.
    minimum = 0.31 if candidate in {"blank", "document"} else 0.29
    return candidate if scores[candidate] >= minimum and scores[candidate] - scores["photo"] >= 0.065 else "photo"


def scan_batch(query, embed_text, after=None, limit=128):
    """Visit at most one ID-ordered page without opening original files.

    Leave rows without filename evidence or embeddings pending so the scanner
    can revisit them once recognition has added an embedding.
    """
    rows = query(
        f"""WITH batch AS (
                SELECT id, original_filename, title, legacy_photo_id FROM photos
                WHERE media_kind='photo' AND junk_classification IS NULL
                  AND id > %s::uuid AND {AUTO_MARK}
                ORDER BY id LIMIT %s
            )
            SELECT p.id::text AS photo_id, p.original_filename, p.title, image.clip_embedding
            FROM batch p
            LEFT JOIN photo_copies f ON f.photo_id=p.id AND f.provider='flickr' AND f.status='available'
            LEFT JOIN LATERAL (
                SELECT pe.clip_embedding FROM photo_embeddings pe
                WHERE pe.photo_id IN (p.id::text, p.legacy_photo_id, f.provider_key)
                  AND pe.clip_embedding IS NOT NULL
                ORDER BY (pe.photo_id=p.id::text) DESC, pe.photo_id LIMIT 1
            ) image ON TRUE
            ORDER BY p.id""",
        (after or "00000000-0000-0000-0000-000000000000", limit),
    )
    ids, classifications = [], []
    for row in rows:
        classification = filename_reason(row["original_filename"], row["title"])
        if classification is None and row["clip_embedding"] is not None:
            classification = visual_reason(row["clip_embedding"], prompt_vectors(embed_text))
        if classification is not None:
            ids.append(row["photo_id"])
            classifications.append(classification)
    if ids:
        query(
            f"""UPDATE photos p SET junk_classification=result.classification
                FROM unnest(%s::uuid[], %s::text[]) AS result(id, classification)
                WHERE p.id=result.id AND p.junk_classification IS NULL AND {AUTO_MARK}""",
            (ids, classifications), fetch=False,
        )
    return rows[-1]["photo_id"] if len(rows) == limit else None
