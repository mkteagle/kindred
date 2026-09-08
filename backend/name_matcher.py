#!/usr/bin/env python3
"""Name a face cluster from Google's photo-level tags.

Google says who is in a photo but never which face is which: a sidecar carries
["Madison Teagle", "Britain Teagle"] and no bounding boxes. Kindred has the
opposite -- it knows exactly which faces are the same person, and nothing about
who that person is. Between them the answer is recoverable.

The reliable evidence is a photo carrying exactly one name. If Google says only
Madison is in the frame, then every face Kindred found there is Madison, and a
cluster appearing across many such photos is Madison with near-certainty.

Photos with several names are weak evidence and are treated as such. A parent
photographed with the same child a thousand times co-occurs with that child's
name a thousand times, so raw co-occurrence would confidently name the parent
after the child. Multi-name photos therefore only break ties among names that
solo photos already support, and never introduce a name on their own.

Two guards on top:

  support  a handful of photos is a coincidence, not a match.
  margin   the leading name has to beat the runner-up clearly. Twins, and
           couples always photographed together, are exactly the case where a
           confident wrong answer is worse than no answer.

Everything here is a pure function of counts, so the judgement can be tested
without a library.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

# Below this many solo-tagged photos, a match is a coincidence.
MIN_SUPPORT = 4
# The leader must hold this share of the solo evidence.
MIN_SHARE = 0.6
# ...and beat the runner-up by this much, or the cluster is ambiguous.
MIN_MARGIN = 0.25


@dataclass(frozen=True)
class Match:
    cluster_id: str
    name: str | None
    confidence: float
    support: int
    runner_up: str | None = None
    reason: str = ""

    @property
    def confident(self) -> bool:
        return self.name is not None


def match_cluster(cluster_id: str, photo_names: dict[str, list[str]]) -> Match:
    """Best name for one cluster, given the names on each photo it appears in.

    `photo_names` maps a photo the cluster appears in to the names Google put
    on that photo. A photo with no names contributes nothing; a photo with one
    name is evidence; a photo with several is a tie-breaker only.
    """
    solo: Counter[str] = Counter()
    shared: Counter[str] = Counter()
    for names in photo_names.values():
        if len(names) == 1:
            solo[names[0]] += 1
        elif len(names) > 1:
            for name in names:
                shared[name] += 1

    total_solo = sum(solo.values())
    if total_solo < MIN_SUPPORT:
        return Match(cluster_id, None, 0.0, total_solo,
                     reason=f"only {total_solo} single-name photos; need {MIN_SUPPORT}")

    ranked = solo.most_common()
    leader, leader_count = ranked[0]
    share = leader_count / total_solo

    # A genuine tie on solo evidence: let the multi-name photos break it, since
    # they at least distinguish someone present from someone never present.
    contenders = [name for name, count in ranked if count == leader_count]
    if len(contenders) > 1:
        leader = max(contenders, key=lambda name: (shared[name], name))
        leader_count = solo[leader]
        share = leader_count / total_solo

    runner_up_name, runner_up_count = (ranked[1] if len(ranked) > 1 else (None, 0))
    if runner_up_name == leader and len(ranked) > 2:
        runner_up_name, runner_up_count = ranked[2]
    margin = (leader_count - runner_up_count) / total_solo

    if share < MIN_SHARE:
        return Match(cluster_id, None, share, total_solo, runner_up_name,
                     reason=f"{leader} holds only {share:.0%} of the evidence")
    if margin < MIN_MARGIN:
        return Match(cluster_id, None, share, total_solo, runner_up_name,
                     reason=f"{leader} and {runner_up_name} are too close to separate")
    return Match(cluster_id, leader, share, total_solo, runner_up_name,
                 reason=f"{leader_count} of {total_solo} single-name photos")


def resolve(clusters: dict[str, dict[str, list[str]]],
            already_named: set[str] | None = None) -> list[Match]:
    """Match every cluster, refusing to give one name to two clusters.

    Kindred often splits a person across clusters -- a beard, a decade -- and
    two of them will both look like Madison. Naming both "Madison Teagle"
    creates two people with the same name rather than one person, so the
    strongest claim keeps the name and the others are left for a human to merge.
    """
    matches = [match_cluster(cluster_id, photos) for cluster_id, photos in clusters.items()]
    matches.sort(key=lambda m: (-m.confidence, -m.support, m.cluster_id))

    taken = set(already_named or ())
    resolved: list[Match] = []
    for match in matches:
        if match.name and match.name in taken:
            resolved.append(Match(match.cluster_id, None, match.confidence, match.support,
                                  match.name,
                                  reason=f"{match.name} is already claimed by a stronger cluster"))
            continue
        if match.name:
            taken.add(match.name)
        resolved.append(match)
    resolved.sort(key=lambda m: m.cluster_id)
    return resolved
