"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import type { SearchResult } from "@/types";

interface SearchResponse {
  results: SearchResult[];
  visual_pending?: boolean;
}

const EMPTY_RESULTS: SearchResult[] = [];
const SEARCH_TIMEOUT_MS = 12_000;

async function fetchSearch(params: string, limit: number, mode: "quick" | "visual", signal: AbortSignal) {
  const query = new URLSearchParams(params);
  query.set("limit", String(limit));
  query.set("mode", mode);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal.aborted) cancel();
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND}/search?${query}`, { signal: controller.signal });
    if (!response.ok) throw new Error("Search is unavailable");
    return (await response.json()) as SearchResponse;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

export function useSearchResults(params: string, limit: number, enabled: boolean, expand: boolean) {
  const quick = useQuery({
    queryKey: ["kx-search", "quick", params, limit],
    queryFn: ({ signal }) => fetchSearch(params, limit, "quick", signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  const direct = quick.data?.results ?? EMPTY_RESULTS;
  const visual = useQuery({
    queryKey: ["kx-search", "visual", params, limit],
    queryFn: ({ signal }) => fetchSearch(params, limit, "visual", signal),
    enabled: enabled && !!quick.data?.visual_pending && (expand || direct.length === 0),
    staleTime: 60_000,
    retry: false,
  });

  const results = useMemo(() => {
    if (!visual.data) return direct;
    const byId = new Map(direct.map((row) => [row.photo_id, row]));
    for (const row of visual.data.results) {
      if (!byId.has(row.photo_id)) byId.set(row.photo_id, row);
    }
    return Array.from(byId.values()).slice(0, limit);
  }, [direct, visual.data, limit]);

  return {
    results,
    loading: quick.isLoading || visual.isLoading,
    error: quick.isError || visual.isError,
    retry: quick.isError ? quick.refetch : visual.refetch,
  };
}
