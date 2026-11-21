"""Paged cluster browse without sorting face images for the whole category."""


def summary(query, category, limit, offset):
    rows = query(
        """WITH counts AS (
               SELECT dc.cluster_id, COUNT(*) AS det_count,
                      COUNT(DISTINCT d.photo_id) AS photo_count
               FROM detection_clusters dc
               JOIN detections d ON d.id = dc.detection_id
               WHERE dc.category = %s AND dc.cluster_id <> '-1'
               GROUP BY dc.cluster_id
           ),
           page AS (
               SELECT counts.*, c.label, c.avatar_detection_id, c.cover_photo_id, c.cover_crop,
                      COUNT(*) OVER () AS total,
                      COUNT(NULLIF(c.label, '')) OVER () AS named_total
               FROM counts
               LEFT JOIN clusters c ON c.id = counts.cluster_id AND c.category = %s
               ORDER BY det_count DESC, cluster_id
               LIMIT %s OFFSET %s
           )
           SELECT page.cluster_id AS id, page.label, page.det_count, page.photo_count,
                  page.cover_crop, page.total, page.named_total,
                  COALESCE(custom.chip, best.chip) AS avatar,
                  COALESCE(NULLIF(cover.thumb_url, ''), best.thumb_url) AS thumb_url,
                  COALESCE(NULLIF(cover.photo_url, ''), best.photo_url) AS photo_url
           FROM page
           JOIN LATERAL (
               SELECT d.chip, d.thumb_url, d.photo_url
               FROM detection_clusters dc JOIN detections d ON d.id = dc.detection_id
               WHERE dc.cluster_id = page.cluster_id AND dc.category = %s
               ORDER BY d.det_score DESC NULLS LAST, d.id LIMIT 1
           ) best ON true
           LEFT JOIN detections custom ON custom.id = page.avatar_detection_id
           LEFT JOIN LATERAL (
               SELECT d.thumb_url, d.photo_url
               FROM detections d WHERE d.photo_id = page.cover_photo_id
               ORDER BY d.id LIMIT 1
           ) cover ON true
           ORDER BY page.det_count DESC, page.cluster_id""",
        (category, category, limit, offset, category),
    )
    total = rows[0]["total"] if rows else 0
    named_total = rows[0]["named_total"] if rows else 0
    clusters = [{key: value for key, value in row.items() if key not in ("total", "named_total")} for row in rows]
    return {"clusters": clusters, "total": total, "named_total": named_total,
            "offset": offset, "limit": limit, "has_more": offset + len(clusters) < total}
