#!/usr/bin/env python3
"""Export the hand-authored parts of the catalog: names, and the decisions.

Everything else in the database is derivable — photos from the NAS, embeddings
and detections from re-running the models. These are not. A cluster label is a
person telling Kindred who someone is, and a dismissed face is a person telling
it who someone is not.

Labels survive a rebuild because they are anchored to vectors, not row ids.
`clusters` itself stores no vector — a label reaches the face data through
detection_clusters -> detections.embedding — so the centroid written here is
computed from the member embeddings. After a rebuild produces fresh clusters,
each can be matched to the nearest exported centroid and recover its name.

    python export_labels.py --out labels.json            # uses $DATABASE_URL
    python export_labels.py --database-url ... --out ...
"""

from __future__ import annotations

import json
import os

# Enough members per label to match reliably without exporting the whole table:
# a centroid alone is fragile for a cluster spanning years of a face.
MEMBERS_PER_LABEL = 40


def parse_vector(value):
    """pgvector returns either a list or its '[1,2,3]' text form."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return [float(v) for v in value]
    return [float(part) for part in str(value).strip("[]").split(",") if part.strip()]


def mean_vector(vectors):
    """Element-wise mean of equal-length vectors, or None when there are none.

    Never returns zeroes for an empty input: a zero centroid would sit at
    cosine distance 1.0 from everything and match arbitrarily during a restore.
    """
    usable = [v for v in vectors if v]
    if not usable:
        return None
    width = len(usable[0])
    usable = [v for v in usable if len(v) == width]
    return [sum(v[i] for v in usable) / len(usable) for i in range(width)]


def build_export(clusters, members, dismissed, meta):
    """Shape the payload. Pure, so its structure is testable without a database."""
    by_cluster: dict[tuple, list] = {}
    for row in members:
        by_cluster.setdefault((row["cluster_id"], row["category"]), []).append(
            {"detection_id": str(row["detection_id"]),
             "photo_id": row["photo_id"],
             "embedding": parse_vector(row["embedding"])}
        )

    exported = []
    for row in clusters:
        key = (row["id"], row["category"])
        entry_members = by_cluster.get(key, [])
        exported.append({
            "cluster_id": row["id"],
            "category": row["category"],
            "label": row["label"],
            "label_source": row.get("label_source"),
            # Derived here, because clusters stores no vector of its own.
            "centroid": mean_vector([m["embedding"] for m in entry_members]),
            "members": entry_members,
        })

    return {
        "version": 1,
        "kind": "kindred-label-export",
        "source": meta,
        "counts": {
            "labels": len(exported),
            "member_embeddings": sum(len(c["members"]) for c in exported),
            "dismissed_faces": len(dismissed),
        },
        "labels": exported,
        # Dismissed faces are stored as centroids with a category, not as
        # detection references — they say "this face group is not someone I
        # want surfaced", which stays meaningful across a rebuild.
        "dismissed_faces": [
            {"category": row.get("category"),
             "det_count": row.get("det_count"),
             "centroid": parse_vector(row.get("centroid"))}
            for row in dismissed
        ],
    }


def export(database_url: str, members_per_label: int = MEMBERS_PER_LABEL) -> dict:
    import psycopg2
    from psycopg2.extras import RealDictCursor

    conn = psycopg2.connect(database_url, connect_timeout=20)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, category, label, label_source
                FROM clusters
                WHERE label IS NOT NULL AND label <> ''
                ORDER BY category, label
            """)
            clusters = cur.fetchall()

            # A bounded sample per label, newest first.
            cur.execute("""
                SELECT dc.cluster_id, dc.category, d.id AS detection_id,
                       d.photo_id, d.embedding
                FROM detection_clusters dc
                JOIN detections d ON d.id = dc.detection_id
                JOIN clusters c ON c.id = dc.cluster_id AND c.category = dc.category
                WHERE c.label IS NOT NULL AND c.label <> '' AND d.embedding IS NOT NULL
                  AND dc.cluster_id IN (
                      SELECT id FROM clusters WHERE label IS NOT NULL AND label <> ''
                  )
            """)
            all_members = cur.fetchall()

            capped, seen = [], {}
            for row in all_members:
                key = (row["cluster_id"], row["category"])
                if seen.get(key, 0) >= members_per_label:
                    continue
                seen[key] = seen.get(key, 0) + 1
                capped.append(row)

            try:
                cur.execute("SELECT category, centroid, det_count FROM dismissed_faces")
                dismissed = cur.fetchall()
            except Exception:
                conn.rollback()
                dismissed = []

            cur.execute("SELECT current_database() AS db, version() AS server")
            info = cur.fetchone()

        meta = {"database": info["db"], "server": info["server"].split(",")[0]}
        return build_export(clusters, capped, dismissed, meta)
    finally:
        conn.close()


def _main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--out", required=True)
    parser.add_argument("--members-per-label", type=int, default=MEMBERS_PER_LABEL)
    args = parser.parse_args(argv)

    if not args.database_url:
        print("DATABASE_URL is required (pass --database-url or set the variable).")
        return 2

    payload = export(args.database_url, args.members_per_label)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)

    counts = payload["counts"]
    print(f"Exported {counts['labels']} labels, "
          f"{counts['member_embeddings']} member embeddings, "
          f"{counts['dismissed_faces']} dismissed faces")
    print(f"Wrote {args.out} ({os.path.getsize(args.out) / 1_000_000:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
