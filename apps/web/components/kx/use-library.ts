"use client";

import { useQuery } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import type { Stats, SyncLog } from "@/types";

export interface LibraryCounts {
  total_files: number;
  photos: number;
  videos: number;
  on_nas: number;
  on_flickr: number;
  indexed_photos: number;
  pending_index: number;
}

/** Catalog totals — the numbers beside the sidebar rows and the header pills. */
export function useLibraryCounts() {
  return useQuery<LibraryCounts>({
    queryKey: ["library-counts"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/library/counts`);
      if (!response.ok) throw new Error("Library counts could not be loaded.");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Cluster group counts per category (people / pets / vehicles). */
export function useStats() {
  return useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/stats`);
      if (!response.ok) throw new Error("Stats could not be loaded.");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useShareCount() {
  return useQuery<number>({
    queryKey: ["share-count"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/shares`);
      if (!response.ok) throw new Error("Shares could not be loaded.");
      const data: { shares?: unknown[] } = await response.json();
      return data.shares?.length ?? 0;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Most recent sync run — feeds the sidebar's sync card. */
export function useLatestSync() {
  return useQuery<SyncLog | null>({
    queryKey: ["latest-sync"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/syncs`);
      if (!response.ok) throw new Error("Sync history could not be loaded.");
      const rows: SyncLog[] = await response.json();
      return rows[0] ?? null;
    },
    staleTime: 60 * 1000,
  });
}

/** "3 minutes ago" / "yesterday" — the sync card's timestamp. */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso.includes("Z") || iso.includes("+") ? iso : `${iso}Z`).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
