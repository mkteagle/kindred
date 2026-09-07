"use client";

import { useQuery } from "@tanstack/react-query";
import { BACKEND, toBackendCategory } from "@/lib/constants";
import type { ClustersSummaryResponse } from "@/types";
import { useNamedPeople } from "./use-people";

export interface ReviewCounts {
  /** Every group the scan has made in this category. */
  total: number;
  /** Groups somebody has named. */
  named: number;
  /** What is left to review. */
  unnamed: number;
}

/**
 * The numbers behind the review banner.
 *
 * Both halves are cheap: the summary is asked for a single row purely to read
 * its `total`, and the named list is the same one the people facets already
 * cache. Nothing here pages through 700 groups to count them.
 */
export function useReviewCounts(category: string): ReviewCounts | null {
  const backendCat = toBackendCategory(category);

  const { data: total } = useQuery<number>({
    queryKey: ["kx-cluster-total", backendCat],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/clusters/${backendCat}/summary?limit=1&offset=0`);
      if (!response.ok) throw new Error("That count could not be loaded.");
      const data: ClustersSummaryResponse = await response.json();
      return data.total ?? 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: named } = useNamedPeople(backendCat);

  if (total === undefined || named === undefined) return null;
  return {
    total,
    named: named.length,
    unnamed: Math.max(0, total - named.length),
  };
}

/**
 * TODO: the design's middle clause — "12 look like someone you already named"
 * — and the review screen's duplicate-pair card both need candidate pairs with
 * a similarity score. Nothing compares one cluster's centroid against another,
 * so neither is shown rather than shown with an invented number. A
 * `GET /clusters/{category}/similar` returning
 * `[{source_id, target_id, similarity}]` would close both.
 */
export const SIMILAR_CLUSTERS_ENDPOINT = null;
