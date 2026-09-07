import unittest

from export_labels import build_export, parse_vector


def cluster(cid="c1", category="people", label="Ady LeBaron"):
    return {"id": cid, "category": category, "label": label, "label_source": "manual"}


def member(cid="c1", category="people", detection_id="d1", photo_id="p1",
           embedding="[0.4,0.5,0.6]"):
    return {"cluster_id": cid, "category": category, "detection_id": detection_id,
            "photo_id": photo_id, "embedding": embedding}


class ParseVectorTests(unittest.TestCase):
    def test_reads_pgvectors_text_form(self):
        self.assertEqual(parse_vector("[0.1,0.2,0.3]"), [0.1, 0.2, 0.3])

    def test_passes_through_a_list(self):
        self.assertEqual(parse_vector([1, 2]), [1.0, 2.0])

    def test_a_missing_vector_stays_missing_rather_than_becoming_zeroes(self):
        # A zero vector would silently match everything during re-identification.
        self.assertIsNone(parse_vector(None))

    def test_handles_whitespace_and_empty(self):
        self.assertEqual(parse_vector("[ ]"), [])
        self.assertEqual(parse_vector("[1.5, 2.5]"), [1.5, 2.5])


class BuildExportTests(unittest.TestCase):
    def test_members_are_grouped_under_their_own_label(self):
        payload = build_export(
            [cluster("c1", "people", "Ady"), cluster("c2", "pets", "Rex")],
            [member("c1", "people", "d1"), member("c2", "pets", "d2"),
             member("c1", "people", "d3")],
            [], {},
        )
        by_label = {c["label"]: c for c in payload["labels"]}
        self.assertEqual(len(by_label["Ady"]["members"]), 2)
        self.assertEqual(len(by_label["Rex"]["members"]), 1)

    def test_a_cluster_id_reused_across_categories_does_not_bleed(self):
        # clusters is keyed on (id, category), so the same id can be a person
        # and a vehicle; their members must not merge.
        payload = build_export(
            [cluster("shared", "people", "Ady"), cluster("shared", "vehicles", "Truck")],
            [member("shared", "people", "d1"), member("shared", "vehicles", "d2")],
            [], {},
        )
        for entry in payload["labels"]:
            self.assertEqual(len(entry["members"]), 1)
            expected = "d1" if entry["category"] == "people" else "d2"
            self.assertEqual(entry["members"][0]["detection_id"], expected)

    def test_vectors_are_decoded_not_left_as_strings(self):
        payload = build_export([cluster()], [member()], [], {})
        entry = payload["labels"][0]
        self.assertEqual(entry["members"][0]["embedding"], [0.4, 0.5, 0.6])

    def test_the_centroid_is_the_mean_of_its_members(self):
        payload = build_export(
            [cluster()],
            [member(embedding="[0.0,2.0]"), member(detection_id="d2", embedding="[2.0,4.0]")],
            [], {},
        )
        self.assertEqual(payload["labels"][0]["centroid"], [1.0, 3.0])

    def test_a_label_with_no_members_has_no_centroid_rather_than_zeroes(self):
        # A zero centroid sits at cosine distance 1.0 from everything and would
        # match arbitrary faces on restore.
        payload = build_export([cluster()], [], [], {})
        self.assertIsNone(payload["labels"][0]["centroid"])

    def test_counts_describe_what_was_actually_written(self):
        payload = build_export(
            [cluster("c1"), cluster("c2", label="Rex")],
            [member("c1"), member("c1", detection_id="d2")],
            [{"category": "people", "centroid": "[0.1]", "det_count": 3}],
            {},
        )
        self.assertEqual(payload["counts"],
                         {"labels": 2, "member_embeddings": 2, "dismissed_faces": 1})

    def test_the_export_is_self_describing_so_a_restore_can_check_it(self):
        payload = build_export([cluster()], [], [], {"database": "kindred"})
        self.assertEqual(payload["kind"], "kindred-label-export")
        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["source"]["database"], "kindred")

    def test_dismissed_faces_are_carried_across_as_centroids(self):
        payload = build_export(
            [cluster()], [],
            [{"category": "people", "centroid": "[0.1,0.2]", "det_count": 4}], {},
        )
        self.assertEqual(payload["dismissed_faces"],
                         [{"category": "people", "det_count": 4, "centroid": [0.1, 0.2]}])


if __name__ == "__main__":
    unittest.main()
