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
    #: How many other clusters this same name also matches. Kindred splits a
    #: person across groups routinely, so this is usually more than zero.
    sibling_clusters: int = 0
    #: Whether this is the best-supported of those, and so the one to lead with.
    is_strongest: bool = True
    #: Whether Kindred already has a cluster carrying this name.
    already_in_library: bool = False

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
    """Match every cluster, and let a name land on as many as it fits.

    An earlier version gave each name to exactly one cluster, reasoning that
    naming two "Madison Teagle" would create two people instead of one. Run
    against the real library that was plainly wrong: 998 clusters cover about
    27 people, so Kindred splits everyone across many groups -- Allison Jarrett
    matched five clusters with thirty to fifty single-name photos each -- and
    the rule refused 93 of 96 matches to protect against a duplicate that is
    actually the correct answer. Several clusters matching one name is evidence
    they are the same person, not a conflict.

    Each match carries how many other clusters share its name and whether it is
    the strongest of them, so a reviewer can accept a person once rather than
    five times, and merge them if they choose. `already_named` no longer blocks
    a proposal either -- another group of someone Kindred already knows is worth
    surfacing, not hiding.
    """
    matches = [match_cluster(cluster_id, photos) for cluster_id, photos in clusters.items()]

    by_name: dict[str, list[Match]] = {}
    for match in matches:
        if match.name:
            by_name.setdefault(match.name, []).append(match)

    known = set(already_named or ())
    resolved: list[Match] = []
    for match in matches:
        if not match.name:
            resolved.append(match)
            continue
        peers = sorted(by_name[match.name], key=lambda m: (-m.support, m.cluster_id))
        rank = peers.index(match) + 1
        resolved.append(Match(
            match.cluster_id, match.name, match.confidence, match.support,
            match.runner_up, match.reason,
            sibling_clusters=len(peers) - 1,
            is_strongest=(rank == 1),
            already_in_library=match.name in known,
        ))
    resolved.sort(key=lambda m: m.cluster_id)
    return resolved
