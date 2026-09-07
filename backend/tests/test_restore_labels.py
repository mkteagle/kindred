import unittest

from restore_labels import (
    cosine, is_junk, label_base, match_labels, mean_vector, partition_export,
)


def exported(label, category="people", centroid=None):
    return {"label": label, "category": category, "centroid": centroid}


def candidate(cluster_id, category="people", centroid=None, size=5):
    return {"cluster_id": cluster_id, "category": category,
            "centroid": centroid, "size": size}


class JunkTests(unittest.TestCase):
    def test_detector_vocabulary_is_junk_with_or_without_a_suffix(self):
        for label in ("Car", "Car (2)", "Bus (3)", "Dog (9)", "Zebra", "Bear (17)", "Cat"):
            self.assertTrue(is_junk(label), label)

    def test_real_names_are_never_junk(self):
        for label in ("Ady LeBaron", "Carter Nelson", "David",
                      "James Arthur Payne Jr", "Mrs. Guastivino", "Beetlejuice"):
            self.assertFalse(is_junk(label), label)

    def test_a_named_vehicle_survives_even_though_vehicles_are_a_category(self):
        # "2003 GMC Sierra 1500" is a name someone typed, not a detector class.
        self.assertFalse(is_junk("2003 GMC Sierra 1500"))
        self.assertFalse(is_junk("2018 Honda Oddysey"))

    def test_suffix_stripping_only_removes_the_numeric_disambiguator(self):
        self.assertEqual(label_base("Car (12)"), "Car")
        self.assertEqual(label_base("Ady LeBaron"), "Ady LeBaron")
        # A number that is part of the name stays.
        self.assertEqual(label_base("2003 GMC Sierra 1500"), "2003 GMC Sierra 1500")

    def test_partition_keeps_names_and_sets_junk_aside(self):
        keep, junk = partition_export([exported("Ady LeBaron"), exported("Car (2)"),
                                       exported("David"), exported("Zebra")])
        self.assertEqual([e["label"] for e in keep], ["Ady LeBaron", "David"])
        self.assertEqual([e["label"] for e in junk], ["Car (2)", "Zebra"])


class CosineTests(unittest.TestCase):
    def test_identical_vectors_score_one(self):
        self.assertAlmostEqual(cosine([1, 0, 1], [1, 0, 1]), 1.0)

    def test_orthogonal_vectors_score_zero(self):
        self.assertAlmostEqual(cosine([1, 0], [0, 1]), 0.0)

    def test_scale_does_not_matter(self):
        self.assertAlmostEqual(cosine([1, 2, 3], [10, 20, 30]), 1.0)

    def test_missing_or_mismatched_vectors_score_zero_rather_than_raising(self):
        self.assertEqual(cosine(None, [1, 2]), 0.0)
        self.assertEqual(cosine([1, 2], []), 0.0)
        self.assertEqual(cosine([1, 2, 3], [1, 2]), 0.0)

    def test_a_zero_vector_scores_zero_not_nan(self):
        self.assertEqual(cosine([0, 0], [1, 1]), 0.0)

    def test_mean_vector_of_nothing_is_none_not_zeroes(self):
        self.assertIsNone(mean_vector([]))
        self.assertIsNone(mean_vector([None, None]))
        self.assertEqual(mean_vector([[0, 2], [2, 4]]), [1.0, 3.0])


class MatchingTests(unittest.TestCase):
    def test_a_label_lands_on_its_own_cluster(self):
        assignments, unmatched, unused = match_labels(
            [exported("Ady", centroid=[1.0, 0.0])],
            [candidate("c1", centroid=[0.99, 0.01]), candidate("c2", centroid=[0.0, 1.0])],
            threshold=0.5,
        )
        self.assertEqual(len(assignments), 1)
        self.assertEqual(assignments[0]["cluster_id"], "c1")
        self.assertEqual(unmatched, [])
        self.assertEqual([c["cluster_id"] for c in unused], ["c2"])

    def test_matching_is_one_to_one_so_two_names_cannot_take_one_cluster(self):
        # Both look alike; only the better pairing wins the cluster.
        assignments, unmatched, _ = match_labels(
            [exported("Ady", centroid=[1.0, 0.0]), exported("Alli", centroid=[0.98, 0.02])],
            [candidate("c1", centroid=[1.0, 0.0])],
            threshold=0.5,
        )
        self.assertEqual(len(assignments), 1)
        self.assertEqual(assignments[0]["label"], "Ady")
        self.assertEqual([e["label"] for e in unmatched], ["Alli"])

    def test_the_best_pairing_is_taken_first(self):
        assignments, _, _ = match_labels(
            [exported("Ady", centroid=[1.0, 0.0]), exported("Bo", centroid=[0.0, 1.0])],
            [candidate("c1", centroid=[0.0, 1.0]), candidate("c2", centroid=[1.0, 0.0])],
            threshold=0.5,
        )
        pairs = {a["label"]: a["cluster_id"] for a in assignments}
        self.assertEqual(pairs, {"Ady": "c2", "Bo": "c1"})

    def test_categories_never_cross(self):
        # A person must never be named after a vehicle cluster.
        assignments, unmatched, _ = match_labels(
            [exported("Ady", "people", centroid=[1.0, 0.0])],
            [candidate("v1", "vehicles", centroid=[1.0, 0.0])],
            threshold=0.5,
        )
        self.assertEqual(assignments, [])
        self.assertEqual(len(unmatched), 1)

    def test_a_weak_match_is_left_alone_rather_than_guessed(self):
        assignments, unmatched, _ = match_labels(
            [exported("Ady", centroid=[1.0, 0.0])],
            [candidate("c1", centroid=[0.3, 0.95])],
            threshold=0.55,
        )
        self.assertEqual(assignments, [])
        self.assertEqual(len(unmatched), 1)

    def test_a_label_without_a_vector_can_never_match(self):
        assignments, unmatched, _ = match_labels(
            [exported("David", centroid=None)],
            [candidate("c1", centroid=[1.0, 0.0])], threshold=0.1,
        )
        self.assertEqual(assignments, [])
        self.assertEqual([e["label"] for e in unmatched], ["David"])

    def test_a_cluster_without_a_vector_is_not_a_candidate(self):
        assignments, _, _ = match_labels(
            [exported("Ady", centroid=[1.0, 0.0])],
            [candidate("c1", centroid=None)], threshold=0.1,
        )
        self.assertEqual(assignments, [])

    def test_raising_the_threshold_only_ever_removes_matches(self):
        labels = [exported("Ady", centroid=[1.0, 0.1]), exported("Bo", centroid=[0.1, 1.0])]
        clusters = [candidate("c1", centroid=[1.0, 0.0]), candidate("c2", centroid=[0.0, 1.0])]
        loose, _, _ = match_labels(labels, clusters, threshold=0.5)
        strict, _, _ = match_labels(labels, clusters, threshold=0.999)
        self.assertGreaterEqual(len(loose), len(strict))

    def test_results_are_deterministic_across_runs(self):
        labels = [exported(f"n{i}", centroid=[1.0, i / 10]) for i in range(5)]
        clusters = [candidate(f"c{i}", centroid=[1.0, i / 10]) for i in range(5)]
        first, _, _ = match_labels(labels, clusters, threshold=0.5)
        second, _, _ = match_labels(labels, clusters, threshold=0.5)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
