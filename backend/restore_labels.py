#!/usr/bin/env python3
"""Re-attach exported names to freshly built clusters, by face vector.

A rebuild produces new cluster ids, so names cannot be restored by key. They
can be restored by similarity: an exported label carries the mean embedding of
the faces it was applied to, and the cluster covering the same person will sit
close to it.

Matching is greedy and one-to-one — the highest-scoring pair is taken first and
both sides are then spent — so two similar-looking people cannot both collapse
onto the same name.

    python restore_labels.py --export labels.json --dry-run
    python restore_labels.py --export labels.json --apply
"""

from __future__ import annotations

import json
import math
import os
import re

# Cosine similarity below which a pair is not the same subject. Deliberately
# conservative: a wrong name is worse than a missing one, because a missing one
# is obvious and a wrong one is not.
DEFAULT_THRESHOLD = 0.55

# Labels the detector generated from its own class vocabulary rather than a
# person naming someone. "Car (4)", "Dog (9)", "Zebra" — these carry no
# information a fresh clustering run does not already produce.
DETECTOR_VOCABULARY = {
    "airplane", "bear", "bicycle", "bird", "boat", "bus", "car", "cat", "cow",
    "dog", "elephant", "giraffe", "horse", "motorcycle", "person", "sheep",
    "train", "truck", "vehicle", "zebra",
}

SUFFIX = re.compile(r"\s*\(\d+\)\s*$")


def label_base(label: str) -> str:
    """The label with any auto-generated ' (n)' disambiguator removed."""
    return SUFFIX.sub("", (label or "").strip())


def is_junk(label: str) -> bool:
    """Is this a detector-generated label rather than a name someone chose?"""
    return label_base(label).lower() in DETECTOR_VOCABULARY


def cosine(a, b) -> float:
    """Cosine similarity, 0.0 when either side is absent or degenerate."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    magnitude = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / magnitude if magnitude else 0.0


def mean_vector(vectors):
    usable = [v for v in vectors if v]
    if not usable:
        return None
    width = len(usable[0])
    usable = [v for v in usable if len(v) == width]
    return [sum(v[i] for v in usable) / len(usable) for i in range(width)]


def match_labels(exported, candidates, threshold: float = DEFAULT_THRESHOLD):
    """Pair exported labels with candidate clusters.

    `exported`  : [{label, category, centroid}]
    `candidates`: [{cluster_id, category, centroid, size}]

    Returns (assignments, unmatched_labels, unused_clusters). Categories never
    cross: a person is never matched to a vehicle.
    """
    scored = []
    for label_index, entry in enumerate(exported):
        if not entry.get("centroid"):
            continue
        for cluster_index, candidate in enumerate(candidates):
            if candidate["category"] != entry["category"]:
                continue
            score = cosine(entry["centroid"], candidate["centroid"])
            if score >= threshold:
                scored.append((score, label_index, cluster_index))

    scored.sort(key=lambda row: (-row[0], row[1], row[2]))

    used_labels, used_clusters, assignments = set(), set(), []
    for score, label_index, cluster_index in scored:
        if label_index in used_labels or cluster_index in used_clusters:
            continue
        used_labels.add(label_index)
        used_clusters.add(cluster_index)
        assignments.append({
            "label": exported[label_index]["label"],
            "category": exported[label_index]["category"],
            "cluster_id": candidates[cluster_index]["cluster_id"],
            "score": round(score, 4),
            "cluster_size": candidates[cluster_index].get("size"),
        })

    unmatched = [e for i, e in enumerate(exported) if i not in used_labels]
    unused = [c for i, c in enumerate(candidates) if i not in used_clusters]
    return assignments, unmatched, unused


def partition_export(labels):
    """Split an export into (nameable, junk). Junk is reported, never applied."""
    keep, junk = [], []
    for entry in labels:
        (junk if is_junk(entry["label"]) else keep).append(entry)
    return keep, junk


def load_candidates(conn):
    """Unlabelled clusters in the target database, with a centroid derived
    from their member detections."""
    from psycopg2.extras import RealDictCursor

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT c.id AS cluster_id, c.category, d.embedding
            FROM clusters c
            JOIN detection_clusters dc ON dc.cluster_id = c.id AND dc.category = c.category
            JOIN detections d ON d.id = dc.detection_id
            WHERE (c.label IS NULL OR c.label = '') AND d.embedding IS NOT NULL
        """)
        rows = cur.fetchall()

    grouped: dict[tuple, list] = {}
    for row in rows:
        vector = row["embedding"]
        if isinstance(vector, str):
            vector = [float(p) for p in vector.strip("[]").split(",") if p.strip()]
        grouped.setdefault((row["cluster_id"], row["category"]), []).append(list(vector))

    return [
        {"cluster_id": cid, "category": category,
         "centroid": mean_vector(vectors), "size": len(vectors)}
        for (cid, category), vectors in grouped.items()
    ]


def apply_assignments(conn, assignments):
    with conn.cursor() as cur:
        for row in assignments:
            cur.execute(
                """
                UPDATE clusters SET label = %s, label_source = 'restored'
                WHERE id = %s AND category = %s AND (label IS NULL OR label = '')
                """,
                (row["label"], row["cluster_id"], row["category"]),
            )
    conn.commit()


def _main(argv=None) -> int:
    import argparse
    import psycopg2

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", required=True)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--apply", action="store_true", help="Write the matches.")
    args = parser.parse_args(argv)

    if not args.database_url:
        print("DATABASE_URL is required.")
        return 2

    payload = json.load(open(args.export, encoding="utf-8"))
    if payload.get("kind") != "kindred-label-export":
        print(f"{args.export} is not a Kindred label export.")
        return 2

    nameable, junk = partition_export(payload["labels"])
    with_vectors = [e for e in nameable if e.get("centroid")]

    conn = psycopg2.connect(args.database_url, connect_timeout=30)
    try:
        candidates = load_candidates(conn)
        assignments, unmatched, unused = match_labels(with_vectors, candidates, args.threshold)

        print(f"export:      {len(payload['labels'])} labels "
              f"({len(junk)} detector-generated, dropped)")
        print(f"nameable:    {len(nameable)}  of which {len(with_vectors)} carry a vector")
        print(f"clusters:    {len(candidates)} unlabelled clusters in the target")
        print(f"MATCHED:     {len(assignments)}  (threshold {args.threshold})")
        print()

        for row in sorted(assignments, key=lambda r: -r["score"])[:40]:
            print(f"  {row['score']:.3f}  {row['label']:<28} -> {row['cluster_id']} "
                  f"({row['category']}, {row['cluster_size']} faces)")

        real_unmatched = [e for e in unmatched if not is_junk(e["label"])]
        if real_unmatched:
            print(f"\nNOT MATCHED — {len(real_unmatched)} real names need doing by hand:")
            for entry in sorted(real_unmatched, key=lambda e: e["label"]):
                reason = "no vector in export" if not entry.get("centroid") else "no cluster above threshold"
                print(f"  {entry['label']:<32} ({entry['category']}) — {reason}")

        print(f"\n{len(unused)} clusters left unlabelled.")

        if args.apply:
            apply_assignments(conn, assignments)
            print(f"\nApplied {len(assignments)} labels.")
        else:
            print("\nDry run: nothing written. Re-run with --apply.")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
