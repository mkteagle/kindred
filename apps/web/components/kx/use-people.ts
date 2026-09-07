"use client";

import { useQuery } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";

/** A named cluster, as the people facets want it. */
export interface NamedPerson {
  id: string;
  label: string;
  category: string;
  avatar: string | null;
}

/**
 * `/clusters/named` returns rows keyed `id`, but several call sites were
 * written against `cluster_id`. Normalising here means one shape reaches the
 * search facet, the video people picker and the together bar.
 */
interface NamedClusterRow {
  id?: string;
  cluster_id?: string;
  label?: string | null;
  category?: string;
  avatar?: string | null;
}

/**
 * Everyone with a name, for the facets that offer people as chips. Cheap,
 * cached for the session, and unrelated to whatever query is running.
 */
export function useNamedPeople(category = "people") {
  return useQuery<NamedPerson[]>({
    queryKey: ["kx-named-people", category],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/clusters/named?category=${category}`);
      if (!response.ok) return [];
      const data: { clusters?: NamedClusterRow[] } | NamedClusterRow[] = await response.json();
      const rows = Array.isArray(data) ? data : (data.clusters ?? []);
      return rows
        .map((row) => ({
          id: String(row.id ?? row.cluster_id ?? ""),
          label: row.label ?? "",
          category: row.category ?? category,
          avatar: row.avatar ?? null,
        }))
        .filter((person) => person.id && person.label);
    },
    staleTime: 5 * 60 * 1000,
  });
}
