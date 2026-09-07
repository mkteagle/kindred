"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BACKEND, fmt, toBackendCategory } from "@/lib/constants";
import type { ClusterSummary, ClustersSummaryResponse } from "@/types";
import { KxEmpty, KxErrorBanner, KxSkeletonCards } from "./states";
import { useReviewCounts } from "./use-review";

const PAGE_SIZE = 60;

/** Heading copy per category. The people wording is the handoff's own. */
const COPY: Record<string, { eyebrow: string; title: string; lede: string; singular: string; plural: string }> = {
  people: {
    eyebrow: "People first",
    title: "Everyone in the house.",
    lede: "Name someone once and every photo of them, past and future, comes with it.",
    singular: "person",
    plural: "people",
  },
  animals: {
    eyebrow: "Animals",
    title: "The four-legged ones.",
    lede: "Every animal the scan has picked out, grouped and waiting for a name.",
    singular: "animal",
    plural: "animals",
  },
  vehicles: {
    eyebrow: "Vehicles",
    title: "What we drove.",
    lede: "Cars, vans and bikes the scan has separated out of the library.",
    singular: "vehicle",
    plural: "vehicles",
  },
};

/** A data URI is a detection chip, not a real cover photo. */
function coverFor(cluster: ClusterSummary): { src: string; round: boolean } | null {
  const cover = cluster.photo_url || cluster.thumb_url;
  if (cover && !cover.startsWith("data:")) return { src: cover, round: true };
  if (cluster.avatar) return { src: cluster.avatar, round: true };
  return null;
}

/**
 * The browse face of /people, /animals and /vehicles: circular covers, a name
 * and a count. The labelling, merging and review tools stay one click away
 * behind "Manage".
 */
export function KxClusterBrowse({
  category,
  onManage,
}: {
  category: string;
  onManage: () => void;
}) {
  const copy = COPY[category] ?? COPY.people;
  const backendCat = toBackendCategory(category);
  const sentinel = useRef<HTMLDivElement>(null);
  const counts = useReviewCounts(category);

  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery<ClustersSummaryResponse>({
      queryKey: ["kx-cluster-browse", backendCat],
      initialPageParam: 0,
      queryFn: async ({ pageParam }) => {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam) });
        const response = await fetch(`${BACKEND}/clusters/${backendCat}/summary?${params}`);
        if (!response.ok) throw new Error("These groups could not be loaded.");
        return response.json();
      },
      getNextPageParam: (last) => (last.has_more ? (last.offset ?? 0) + PAGE_SIZE : undefined),
    });

  const clusters = useMemo(
    () =>
      Array.from(
        new Map((data?.pages.flatMap((p) => p.clusters) ?? []).map((c) => [c.id, c])).values(),
      ),
    [data],
  );

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasNextPage || isFetchingNextPage || error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchNextPage();
      },
      { rootMargin: "600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, error, clusters.length]);

  return (
    <main className="kx-page">
      <div className="kx-pagehead">
        <div className="kx-pagehead-copy">
          <span className="kx-eyebrow">{copy.eyebrow}</span>
          <h1 className="kx-title">{copy.title}</h1>
          <p className="kx-lede">{copy.lede}</p>
        </div>
        <div className="kx-pagehead-pills">
          <button className="kx-button" onClick={onManage}>
            Manage
          </button>
        </div>
      </div>

      {/* Naming people is a first-class job with its own screen, not a button
          filed under settings — so the work outstanding is stated here, on the
          screen where it is felt. */}
      {counts && counts.unnamed > 0 && (
        <div className="kx-reviewbanner">
          <span className="kx-reviewbanner-copy">
            <strong>
              {fmt.format(counts.unnamed)} {counts.unnamed === 1 ? copy.singular : copy.plural} still
              need{counts.unnamed === 1 ? "s" : ""} a name
            </strong>
            {/* TODO: the design's "12 look like someone you already named" needs
                candidate pairs with a similarity score, which nothing produces
                — see use-review.ts. It is left out rather than invented. */}
            <span className="kx-mono">{fmt.format(counts.named)} named so far</span>
          </span>
          <Link className="kx-button primary" href={`/review?category=${category}`}>
            Start review
          </Link>
          <button className="kx-button" onClick={onManage}>
            Merge duplicates
          </button>
        </div>
      )}

      {isPending && <KxSkeletonCards count={12} minWidth={150} round />}
      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
      {!isPending && !error && clusters.length === 0 && (
        <KxEmpty
          title="Nothing here yet."
          body="Nothing has been grouped yet. Run a scan and they will appear here."
        />
      )}

      <div className="kx-peoplegrid">
        {clusters.map((cluster) => {
          const cover = coverFor(cluster);
          const named = Boolean(cluster.label);
          return (
            <Link
              key={cluster.id}
              href={`/${category}/${cluster.id}`}
              className={`kx-personcard ${named ? "" : "unnamed"}`.trim()}
            >
              {cover ? (
                <img
                  src={cover.src}
                  alt=""
                  loading="lazy"
                  style={
                    cluster.cover_crop
                      ? { objectPosition: `${cluster.cover_crop.x}% ${cluster.cover_crop.y}%` }
                      : undefined
                  }
                />
              ) : (
                <span className="kx-personcard-fallback" aria-hidden="true">
                  ?
                </span>
              )}
              <span className="kx-personcard-name">
                {cluster.label || `Unnamed ${copy.singular}`}
              </span>
              <span className="kx-personcard-count">
                {fmt.format(cluster.photo_count)} photos{named ? "" : " · name them"}
              </span>
            </Link>
          );
        })}
      </div>

      {isFetchingNextPage && <KxSkeletonCards count={6} minWidth={150} round />}
      {hasNextPage && !isFetchingNextPage && (
        <div className="kx-loadmore">
          <button className="kx-button" onClick={() => void fetchNextPage()}>
            Load more
          </button>
        </div>
      )}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
    </main>
  );
}
