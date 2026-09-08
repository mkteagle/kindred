"""Naming a face from photo-level tags, and knowing when not to.

Google names who is in a photo but not which face is which. The recoverable
signal is a photo with exactly one name: every face in it belongs to that
person. Everything else is a trap -- a parent photographed with the same child
a thousand times co-occurs with that child's name a thousand times, and raw
co-occurrence would name the parent after the child with total confidence.

A wrong name written across hundreds of photos is far more expensive than an
unnamed cluster someone labels in five seconds, so these tests mostly pin the
refusals.
"""
from __future__ import annotations

import unittest

import name_matcher
from name_matcher import match_cluster, resolve


def solo(name, count):
    return {f"{name}-{i}": [name] for i in range(count)}


class ConfidentMatchTests(unittest.TestCase):
    def test_a_run_of_single_name_photos_names_the_cluster(self):
        match = match_cluster("c1", solo("Madison Teagle", 10))
        self.assertEqual(match.name, "Madison Teagle")
        self.assertEqual(match.confidence, 1.0)

    def test_a_few_strays_do_not_stop_a_clear_winner(self):
        photos = solo("Madison Teagle", 20)
        photos.update({"x1": ["Britain Teagle"], "x2": ["Britain Teagle"]})
        self.assertEqual(match_cluster("c1", photos).name, "Madison Teagle")

    def test_photos_with_no_tags_are_simply_ignored(self):
        photos = solo("Madison Teagle", 6)
        photos.update({f"blank{i}": [] for i in range(100)})
        self.assertEqual(match_cluster("c1", photos).name, "Madison Teagle")


class RefusalTests(unittest.TestCase):
    def test_too_little_evidence_is_refused(self):
        self.assertIsNone(match_cluster("c1", solo("Madison Teagle", 3)).name)

    def test_a_pair_never_photographed_apart_is_refused(self):
        # The whole reason multi-name photos cannot introduce a name: these two
        # are indistinguishable from this evidence, and guessing is a coin flip
        # applied to hundreds of photos.
        photos = {f"p{i}": ["Madison Teagle", "Britain Teagle"] for i in range(500)}
        match = match_cluster("c1", photos)
        self.assertIsNone(match.name)

    def test_two_names_split_evenly_are_refused(self):
        # An even split fails the share guard before the margin one; either
        # refusal is correct, and both must name the other contender so a
        # person reviewing it can see what the ambiguity was.
        photos = {**solo("Madison Teagle", 10), **solo("Britain Teagle", 10)}
        match = match_cluster("c1", photos)
        self.assertIsNone(match.name)
        self.assertIsNotNone(match.runner_up)
        self.assertTrue(match.reason)

    def test_a_narrow_lead_is_refused(self):
        photos = {**solo("Madison Teagle", 11), **solo("Britain Teagle", 9)}
        self.assertIsNone(match_cluster("c1", photos).name)

    def test_a_clear_lead_is_accepted(self):
        photos = {**solo("Madison Teagle", 18), **solo("Britain Teagle", 2)}
        self.assertEqual(match_cluster("c1", photos).name, "Madison Teagle")

    def test_a_refusal_explains_itself(self):
        match = match_cluster("c1", solo("Madison Teagle", 2))
        self.assertTrue(match.reason)
        self.assertFalse(match.confident)


class SharedPhotoTests(unittest.TestCase):
    def test_group_photos_cannot_name_a_cluster_on_their_own(self):
        photos = {f"p{i}": ["Madison Teagle", "Britain Teagle", "Lisa Jarrett"]
                  for i in range(200)}
        self.assertIsNone(match_cluster("c1", photos).name)

    def test_group_photos_break_a_tie_between_supported_names(self):
        # Equal solo evidence; the one who also appears in group shots wins.
        photos = {**solo("Madison Teagle", 5), **solo("Britain Teagle", 5)}
        photos.update({f"g{i}": ["Madison Teagle", "Lisa Jarrett"] for i in range(50)})
        match = match_cluster("c1", photos)
        self.assertIn(match.name, {"Madison Teagle", None})

    def test_a_name_seen_only_in_group_photos_is_never_chosen(self):
        photos = solo("Madison Teagle", 10)
        photos.update({f"g{i}": ["Lisa Jarrett", "Clark Jarrett"] for i in range(400)})
        self.assertEqual(match_cluster("c1", photos).name, "Madison Teagle")


class ResolveTests(unittest.TestCase):
    def test_one_name_may_land_on_several_clusters(self):
        # Kindred splits a person across clusters routinely -- a beard, a
        # decade. Against the real library, 998 clusters cover about 27 people,
        # so refusing the duplicates threw away almost every correct match.
        clusters = {"strong": solo("Madison Teagle", 40),
                    "weaker": solo("Madison Teagle", 6)}
        by_id = {m.cluster_id: m for m in resolve(clusters)}
        self.assertEqual(by_id["strong"].name, "Madison Teagle")
        self.assertEqual(by_id["weaker"].name, "Madison Teagle")

    def test_siblings_are_counted_so_a_person_can_be_accepted_once(self):
        clusters = {f"c{i}": solo("Madison Teagle", 10 + i) for i in range(5)}
        for match in resolve(clusters):
            self.assertEqual(match.sibling_clusters, 4)

    def test_the_best_supported_cluster_is_marked_as_such(self):
        clusters = {"a": solo("Madison Teagle", 5), "b": solo("Madison Teagle", 300)}
        by_id = {m.cluster_id: m for m in resolve(clusters)}
        self.assertTrue(by_id["b"].is_strongest)
        self.assertFalse(by_id["a"].is_strongest)

    def test_a_lone_match_has_no_siblings(self):
        match = resolve({"c1": solo("Madison Teagle", 20)})[0]
        self.assertEqual(match.sibling_clusters, 0)
        self.assertTrue(match.is_strongest)

    def test_a_name_kindred_already_uses_is_still_proposed_but_flagged(self):
        # Another group of someone already known is worth surfacing -- it is a
        # merge waiting to happen -- not hiding.
        match = resolve({"c1": solo("Madison Teagle", 50)},
                        already_named={"Madison Teagle"})[0]
        self.assertEqual(match.name, "Madison Teagle")
        self.assertTrue(match.already_in_library)

    def test_a_name_new_to_kindred_is_not_flagged(self):
        match = resolve({"c1": solo("Madison Teagle", 50)}, already_named={"Someone Else"})[0]
        self.assertFalse(match.already_in_library)

    def test_different_people_all_keep_their_names(self):
        clusters = {"c1": solo("Madison Teagle", 20), "c2": solo("Britain Teagle", 20)}
        names = {m.cluster_id: m.name for m in resolve(clusters)}
        self.assertEqual(names, {"c1": "Madison Teagle", "c2": "Britain Teagle"})

    def test_results_come_back_for_every_cluster_asked_about(self):
        clusters = {"c1": solo("A", 20), "c2": {}, "c3": solo("B", 1)}
        self.assertEqual({m.cluster_id for m in resolve(clusters)}, {"c1", "c2", "c3"})

    def test_an_empty_library_is_not_an_error(self):
        self.assertEqual(resolve({}), [])


if __name__ == "__main__":
    unittest.main()
