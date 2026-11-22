"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BACKEND, fmt, toBackendCategory } from "@/lib/constants";
import type { ClusterSummary, ClustersSummaryResponse } from "@/types";
import { LIBRARY_ICON_PATHS, NavIcon, SearchIcon } from "./icons";
import { KxEmpty, KxErrorBanner, KxSkeletonCards } from "./states";

const PAGE_SIZE = 60;

/** Heading copy per category. The people wording is the handoff's own. */
const COPY: Record<string, { title: string; lede: string; singular: string; plural: string }> = {
  people: {
    title: "People",
    lede: "",
    singular: "person",
    plural: "people",
  },
  animals: {
    title: "Animals",
    lede: "Pets get their own profiles — name one and every photo of them follows.",
    singular: "animal",
    plural: "animals",
  },
  vehicles: {
    title: "Vehicles",
    lede: "The van, the truck, the car that lasted nine summers.",
    singular: "vehicle",
    plural: "vehicles",
  },
};

/** A data URI is a detection chip, not a real cover photo. */
function coverFor(cluster: ClusterSummary): { src: string; round: boolean } | null {
  if (cluster.avatar && !cluster.cover_crop) return { src: cluster.avatar, round: true };
  const cover = cluster.thumb_url || cluster.photo_url;
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
  // People are faces; animals and vehicles are shapes a circle would crop away.
  const round = category === "people";
  const [tab, setTab] = useState<"named" | "unnamed">("named");
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setName(input.trim()), 220);
    return () => clearTimeout(timer);
  }, [input]);
  const nameState = round ? tab : null;

  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery<ClustersSummaryResponse>({
      queryKey: ["kx-cluster-browse", backendCat, nameState, name],
      initialPageParam: 0,
      staleTime: 30_000,
      retry: false,
      queryFn: async ({ pageParam, signal }) => {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam), compact: "true" });
        if (nameState) params.set("name_state", nameState);
        if (nameState === "named" && name) params.set("q", name);
        const requestSignal = typeof AbortSignal.any === "function"
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : signal;
        const response = await fetch(`${BACKEND}/clusters/${backendCat}/summary?${params}`, { signal: requestSignal });
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
  const firstPage = data?.pages[0];
  const named = firstPage?.named_total ?? Object.values(firstPage?.labels ?? {}).filter(Boolean).length;
  const unnamed = Math.max(0, (firstPage?.total ?? 0) - named);
  const loading = isPending || isFetchingNextPage;
  const placeholderCount = isPending ? 12 : 6;

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
    <main className={`kx-page${round ? " kx-people-page" : ""}`}>
      <div className="kx-pagehead">
        <div className="kx-pagehead-copy">
          <h1 className="kx-title">{copy.title}</h1>
          {copy.lede && <p className="kx-lede">{copy.lede}</p>}
        </div>
        <div className="kx-pagehead-pills">
          <button className="kx-button" onClick={onManage}>
            Manage
          </button>
          {round && <label className="kx-people-search">
            <SearchIcon size={20} />
            <input value={input} maxLength={120} onChange={event => {
              setInput(event.target.value);
              setTab("named");
            }} placeholder="Find a person" aria-label="Find a person" />
            {input && <button type="button" className="kx-iconbutton" aria-label="Clear name" onClick={() => { setInput(""); setName(""); }}>×</button>}
          </label>}
        </div>
      </div>

      {(round || unnamed > 0) && (
        <div className="kx-reviewbanner">
          <NavIcon d={LIBRARY_ICON_PATHS.people} size={24} />
          <span className="kx-reviewbanner-copy">
            <strong>{round ? "People to review" : `${fmt.format(unnamed)} ${copy.plural} to review`}</strong>
            {round && unnamed > 0 && <span>{fmt.format(unnamed)} need a name</span>}
          </span>
          <Link className="kx-button primary" href={`/review?category=${category}`}>Review</Link>
        </div>
      )}

      {round && <div className="kx-chiprow kx-people-tabs" role="group" aria-label="People by name">
        <button className={`kx-chip ${tab === "named" ? "is-active" : ""}`} aria-pressed={tab === "named"} onClick={() => setTab("named")}>Named</button>
        <button className={`kx-chip ${tab === "unnamed" ? "is-active" : ""}`} aria-pressed={tab === "unnamed"} onClick={() => {
          setInput("");
          setName("");
          setTab("unnamed");
        }}>Needs a name</button>
      </div>}

      {!round && isPending && <KxSkeletonCards count={placeholderCount} height={220} />}
      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
      {!isPending && !error && clusters.length === 0 && (
        <KxEmpty
          title={round ? input ? "No matching people" : tab === "named" ? "No named people yet" : "Everyone has a name" : "No groups yet"}
          body={round ? input ? "Try another name." : tab === "named" ? "Open Needs a name or start a review to name someone." : "New faces will appear here when they are grouped." : "Run a scan to find groups."}
        />
      )}

      <div className={round ? "kx-peoplegrid" : "kx-covergrid"} aria-busy={loading}>
        {clusters.map((cluster) => {
          const cover = coverFor(cluster);
          const named = Boolean(cluster.label);
          const crop = cluster.cover_crop
            ? { objectPosition: `${cluster.cover_crop.x}% ${cluster.cover_crop.y}%` }
            : undefined;
          const name = cluster.label || `Unnamed ${copy.singular}`;

          // People are faces, so their covers are circles. An animal or a
          // vehicle is a shape, and a circle crops the shape away.
          if (round) {
            return (
              <Link
                key={cluster.id}
                href={`/${category}/${cluster.id}`}
                // Sixty cards on screen means sixty prefetched routes, each
                // pulling a group the reader has not asked for. Hover still
                // prefetches the one they are actually heading to.
                prefetch={false}
                className={`kx-personcard ${named ? "" : "unnamed"}`.trim()}
              >
                {cover ? (
                  <img src={cover.src} alt="" loading="lazy" style={crop} />
                ) : (
                  <span className="kx-personcard-fallback" aria-hidden="true">
                    ?
                  </span>
                )}
                <span className="kx-personcard-name">{name}</span>
                <span className="kx-personcard-count">
                  {fmt.format(cluster.photo_count)} photos{named ? "" : " · name them"}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={cluster.id}
              href={`/${category}/${cluster.id}`}
              // Sixty cards on screen means sixty prefetched routes, each
              // pulling a group the reader has not asked for. Hover still
              // prefetches the one they are actually heading to.
              prefetch={false}
              className={`kx-card-lift kx-covercard ${named ? "" : "unnamed"}`.trim()}
            >
              <span className="kx-covercard-media">
                {cover ? (
                  <img src={cover.src} alt="" loading="lazy" style={crop} />
                ) : (
                  <span className="kx-covercard-fallback" aria-hidden="true">
                    ?
                  </span>
                )}
                <span className="kx-coverbadge">
                  {fmt.format(cluster.photo_count)} photos
                </span>
              </span>
              <span className="kx-covercard-body">
                <strong>{name}</strong>
                {/* TODO: the design's provenance line — "dog · named March
                    2019" — needs the group's subtype and the date its name was
                    set. The summary endpoint returns neither; subtype lives on
                    the detections and `clusters` records no timestamp. Until
                    then the line says only what is known. */}
                <span className="kx-cardmeta">
                  {named ? `${copy.singular} · named` : "name them"}
                </span>
              </span>
            </Link>
          );
        })}
        {round && loading && Array.from({ length: placeholderCount }, (_, index) => (
          <div key={`placeholder-${index}`} className="kx-personcard kx-person-placeholder" aria-hidden="true">
            <span className="kx-skel round" />
            <span className="kx-skel kx-person-placeholder-name" />
            <span className="kx-skel kx-person-placeholder-count" />
          </div>
        ))}
      </div>

      {!round && isFetchingNextPage && <KxSkeletonCards count={placeholderCount} height={220} />}
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
