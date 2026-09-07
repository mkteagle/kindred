"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { PlayIcon } from "@/components/kx/icons";
import { useLibraryCounts } from "@/components/kx/use-library";
import { KxPeoplePicker } from "@/components/kx/people-picker";
import { formatDuration, thumbUrl, type LibraryPhoto } from "@/components/kx/photos";
import { KxEmpty, KxEmptyResults, KxErrorBanner, KxSkeletonCards } from "@/components/kx/states";

type Page = { photos: LibraryPhoto[]; next_cursor: string | null };

type Span = "all" | "year" | "long";

const SPANS: { id: Span; label: string }[] = [
  { id: "all", label: "All" },
  { id: "year", label: "This year" },
  { id: "long", label: "Over a minute" },
];

/** Videos over a minute, in seconds. */
const LONG_VIDEO = 60;

const DATE_BADGE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });

function badgeDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? "" : DATE_BADGE.format(date).toUpperCase();
}

/** The first card runs 2×2 and every seventh runs wide, as in the design. */
function cardSpan(index: number): "" | "wide" | "big" {
  if (index === 0) return "big";
  if (index % 7 === 6) return "wide";
  return "";
}

export default function VideosPage() {
  const [span, setSpan] = useState<Span>("all");
  const [people, setPeople] = useState<Set<string>>(() => new Set());
  const sentinel = useRef<HTMLDivElement>(null);
  const { openLightbox } = useLightbox();
  const { data: counts } = useLibraryCounts();

  const personIds = useMemo(() => Array.from(people), [people]);
  const byPerson = personIds.length > 0;

  // The chips narrow the catalog, not the current page: /library/photos takes
  // date_from and min_duration, so "over a minute" reaches a clip on page 90
  // that has never been scrolled to.
  const facets = useMemo(() => {
    const params = new URLSearchParams({ media: "video", sort: "newest", limit: "48" });
    if (span === "year") params.set("date_from", `${new Date().getFullYear()}-01-01`);
    if (span === "long") params.set("min_duration", String(LONG_VIDEO));
    return params;
  }, [span]);

  const catalog = useInfiniteQuery<Page>({
    queryKey: ["videos-grid", facets.toString()],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : "";
      const response = await fetch(`${BACKEND}/library/photos?${facets}${cursor}`);
      if (!response.ok) throw new Error("Your videos could not be loaded.");
      return response.json();
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: !byPerson,
  });

  /**
   * With people picked the source changes: /search is the endpoint that knows
   * about clusters, and it answers one person at a time, so "photos with all
   * of them" is the intersection of one browse per person.
   *
   * TODO: a `cluster_id` facet on /library/photos (or a media facet on
   * /photos/together) would make this one paged request instead of N capped
   * ones — the cap is /search's own limit of 200.
   */
  const personQueries = useQueries({
    queries: personIds.map((id) => ({
      queryKey: ["videos-by-person", id, span],
      queryFn: async () => {
        const params = new URLSearchParams({
          media: "video",
          cluster_id: id,
          category: "people",
          limit: "200",
        });
        if (span === "year") params.set("date_from", `${new Date().getFullYear()}-01-01`);
        const response = await fetch(`${BACKEND}/search?${params}`);
        if (!response.ok) throw new Error("Those videos could not be loaded.");
        const data: { results: LibraryPhoto[] } = await response.json();
        return data.results ?? [];
      },
      staleTime: 60 * 1000,
    })),
  });

  const catalogVideos = useMemo(
    () =>
      Array.from(
        new Map((catalog.data?.pages.flatMap((p) => p.photos) ?? []).map((v) => [v.photo_id, v])).values(),
      ),
    [catalog.data],
  );

  const personVideos = useMemo(() => {
    if (!byPerson) return [];
    if (personQueries.some((query) => !query.data)) return [];
    const [first, ...rest] = personQueries.map((query) => query.data ?? []);
    const shared = rest.reduce<LibraryPhoto[]>((acc, list) => {
      const ids = new Set(list.map((row) => row.photo_id));
      return acc.filter((row) => ids.has(row.photo_id));
    }, first ?? []);
    // /search has no duration facet, so this one chip is applied here.
    return span === "long"
      ? shared.filter((row) => (row.duration_seconds ?? 0) >= LONG_VIDEO)
      : shared;
  }, [byPerson, personQueries, span]);

  const videos = byPerson ? personVideos : catalogVideos;
  const loading = byPerson ? personQueries.some((query) => query.isPending) : catalog.isPending;
  const failure = byPerson
    ? (personQueries.find((query) => query.error)?.error as Error | undefined)
    : (catalog.error as Error | null);

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      videos.map((video) => ({
        photo_id: video.photo_id,
        thumb_url: thumbUrl({ photo_id: video.photo_id, media_kind: "video" }),
        photo_title: video.photo_title,
        date_taken: video.date_taken,
        media_kind: "video" as const,
        duration_seconds: video.duration_seconds,
        flickr_url: video.flickr_url,
      })),
    [videos],
  );

  // Destructured because the query object is a new reference every render,
  // and depending on it would rebuild the observer each time.
  const { hasNextPage, isFetchingNextPage, fetchNextPage, error: catalogError } = catalog;

  useEffect(() => {
    const target = sentinel.current;
    if (byPerson) return;
    if (!target || !hasNextPage || isFetchingNextPage || catalogError) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchNextPage();
      },
      { rootMargin: "600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [byPerson, hasNextPage, isFetchingNextPage, fetchNextPage, catalogError, catalogVideos.length]);

  const clearFilters = () => {
    setSpan("all");
    setPeople(new Set());
  };

  const total = counts?.videos ?? 0;

  return (
    <main className="kx-page">
      <span className="kx-eyebrow">Videos</span>
      <h1 className="kx-title">The ones that move.</h1>
      <p className="kx-lede">
        {total > 0 ? `${fmt.format(total)} clips, newest first.` : "Newest first."} Posters come off
        the first clear frame.
      </p>

      <div className="kx-chiprow" role="group" aria-label="Filter videos">
        {SPANS.map((option) => (
          <button
            key={option.id}
            className={`kx-chip ${span === option.id ? "is-active" : ""}`}
            aria-pressed={span === option.id}
            onClick={() => setSpan(option.id)}
          >
            {option.label}
          </button>
        ))}

        <KxPeoplePicker selected={people} onChange={setPeople} />

        {/* Per-member playback tracking is out of scope for this release. The
            dashed, inert chip is how the app already treats a future filter —
            it says the idea exists without pretending it works. */}
        <span
          className="kx-chip deferred"
          title="Needs per-member playback tracking — not in this release"
        >
          Never watched — later
        </span>
      </div>

      {loading && <KxSkeletonCards count={8} minWidth={260} height={190} />}

      {!loading && !failure && videos.length === 0 &&
        (span === "all" && !byPerson ? (
          <KxEmpty
            title="Nothing here yet."
            body="No videos yet. Anything you upload in a video format will appear here."
          />
        ) : (
          <KxEmptyResults onClear={clearFilters} />
        ))}

      {videos.length > 0 && (
        <div className="kx-videogrid">
          {videos.map((video, index) => {
            const duration = formatDuration(video.duration_seconds);
            return (
              <button
                key={video.photo_id}
                className={`kx-videocard ${cardSpan(index)}`.trim()}
                onClick={() => openLightbox(video.photo_id, lightboxPhotos)}
                aria-label={`Play ${video.photo_title || "video"}${duration ? `, ${duration}` : ""}`}
              >
                <img
                  src={thumbUrl({ photo_id: video.photo_id, media_kind: "video" })}
                  alt=""
                  loading="lazy"
                />
                <span className="kx-videocard-scrim" />
                <span className="kx-videocard-play">
                  <PlayIcon />
                </span>
                <span className="kx-videocard-date">{badgeDate(video.date_taken)}</span>
                <span className="kx-videocard-foot">
                  <span className="kx-videocard-title">{video.photo_title || "Untitled"}</span>
                  {duration && <span className="kx-videocard-duration">{duration}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {failure && (
        <KxErrorBanner
          detail={failure.message}
          onRetry={() => {
            if (byPerson) personQueries.forEach((query) => void query.refetch());
            else void (catalogVideos.length ? catalog.fetchNextPage() : catalog.refetch());
          }}
        />
      )}

      {!byPerson && (
        <>
          {catalog.isFetchingNextPage && <KxSkeletonCards count={4} minWidth={260} height={190} />}
          {catalog.hasNextPage && !catalog.isFetchingNextPage && (
            <div className="kx-loadmore">
              <button className="kx-button" onClick={() => void catalog.fetchNextPage()}>
                Load more videos
              </button>
            </div>
          )}
          {!catalog.hasNextPage && catalogVideos.length > 0 && (
            <p className="kx-status">That&rsquo;s everything.</p>
          )}
          <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
        </>
      )}
    </main>
  );
}
