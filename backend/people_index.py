"""Assign ungrouped faces incrementally while preserving existing corrections."""
from __future__ import annotations

from contextlib import closing
from uuid import UUID, uuid5

from psycopg2.extras import RealDictCursor

MAX_DISTANCE = 0.36
MIN_MARGIN = 0.06
NEIGHBORS = 48
GROUP_NAMESPACE = UUID('8af0270d-0402-4b32-9e3f-9d2d8e1f7f66')


def choose_group(candidates, threshold=MAX_DISTANCE):
    """Consider the closest face in each distinct group; abstain on ties."""
    closest = {}
    for candidate in candidates:
        distance = candidate['distance']
        group = candidate['cluster_id']
        closest[group] = min(closest.get(group, distance), distance)
    ranked = sorted((distance, group) for group, distance in closest.items())
    if not ranked or ranked[0][0] > threshold:
        return None
    if len(ranked) > 1 and ranked[1][0] - ranked[0][0] < MIN_MARGIN:
        return None
    return ranked[0][1]


def group_batch(get_db, *, limit=128, threshold=MAX_DISTANCE):
    with closing(get_db()) as conn, conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT pg_try_advisory_xact_lock(%s) AS acquired', (4_921_733_113,))
        if not cur.fetchone()['acquired']:
            return 0
        cur.execute('SET LOCAL hnsw.ef_search = 96')
        cur.execute("""
            SELECT d.id, d.photo_id, d.embedding
            FROM detections d
            WHERE d.category = 'people' AND d.embedding IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM detection_clusters m
                              WHERE m.detection_id = d.id AND m.category = 'people')
            ORDER BY d.created_at, d.id LIMIT %s
        """, (limit,))
        faces = cur.fetchall()
        for face in faces:
            # Compare against nearby detections using pgvector's bounded HNSW
            # query. Only after selecting neighbors do we resolve assignments.
            cur.execute("""
                WITH nearest AS MATERIALIZED (
                    SELECT d.id, d.photo_id, d.embedding <=> %s AS distance
                    FROM detections d
                    WHERE d.category = 'people' AND d.embedding IS NOT NULL
                    ORDER BY d.embedding <=> %s LIMIT %s
                )
                SELECT m.cluster_id, n.distance
                FROM nearest n
                JOIN detection_clusters m ON m.detection_id=n.id AND m.category='people'
                WHERE n.photo_id <> %s
                  AND NOT EXISTS (
                      SELECT 1 FROM detection_clusters member JOIN detections sibling
                      ON sibling.id=member.detection_id
                      WHERE member.cluster_id=m.cluster_id AND member.category='people'
                        AND sibling.photo_id=%s
                  )
            """, (face['embedding'], face['embedding'], NEIGHBORS, face['photo_id'], face['photo_id']))
            group = choose_group(cur.fetchall(), threshold) or str(uuid5(GROUP_NAMESPACE, str(face['id'])))
            cur.execute("""
                INSERT INTO detection_clusters (detection_id, cluster_id, category, pinned)
                SELECT id, %s, 'people', false FROM detections WHERE id=%s AND category='people'
                ON CONFLICT (detection_id, category) DO NOTHING
            """, (group, str(face['id'])))
    return len(faces)


def detect_faces(model, image):
    """Run recognition only for detections that pass the existing quality checks."""
    import cv2
    from insightface.utils.face_align import norm_crop

    boxes, landmarks = model.det_model.detect(image, max_num=0)
    recognizer = model.models['recognition']
    accepted = []
    crops = []
    for index, row in enumerate(boxes):
        bbox, score = row[:4].tolist(), float(row[4])
        x1, y1, x2, y2 = bbox
        if score < 0.35 or x2 - x1 < 24 or y2 - y1 < 24:
            continue
        crop = image[max(0, int(y1)):int(y2), max(0, int(x1)):int(x2)]
        if not crop.size or cv2.Laplacian(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() < 15:
            continue
        accepted.append((bbox, score))
        crops.append(norm_crop(image, landmark=landmarks[index], image_size=recognizer.input_size[0]))
    # Some model exports require a single fixed-size batch.
    batch_size = recognizer.input_shape[0]
    batch_size = batch_size if isinstance(batch_size, int) and batch_size > 0 else 16
    for start in range(0, len(crops), batch_size):
        batch = crops[start:start + batch_size]
        if isinstance(recognizer.input_shape[0], int) and len(batch) < batch_size:
            batch = batch + [batch[-1]] * (batch_size - len(batch))
        features = recognizer.get_feat(batch)
        for (bbox, score), embedding in zip(accepted[start:start + batch_size], features):
            yield bbox, score, embedding.tolist()
