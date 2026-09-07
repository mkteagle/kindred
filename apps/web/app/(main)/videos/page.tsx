"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { PlayIcon } from "@/components/kx/icons";
import { useLibraryCounts } from "@/components/kx/use-library";
import { formatDuration, thumbUrl, type LibraryPhoto } from "@/components/kx/photos";
import { KxEmpty, KxEmptyResults, KxErrorBanner, KxSkeletonCards } from "@/components/kx/states";

type Page = { photos: LibraryPhoto[]; next_cursor: string | null };

type Filter = "all" | "year" | "long" | "unwatched";

const FILTERS: { id: Filter; label: string; enabled: boolean }[] = [
  { id: "all", label: "All", enabled: true },
  { id: "year", label: "This year", enabled: true },
  { id: "long", label: "Over a minute", enabled: true },
  // Nothing records playback, so "never watched" has nothing to filter on.
  // TODO: needs a per-user watched flag on the backend before it can work.
  { id: "unwatched", label: "Never watched", enabled: false },
];

const DATE_BADGE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });

function badgeDate(value: string): string {
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
  const [filter, setFilter] = useState<Filter>("all");
  const sentinel = useRef<HTMLDivElement>(null);
  const { openLightbox } = useLightbox();
  const { data: counts } = useLibraryCounts();

  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery<Page>({
      queryKey: ["videos-grid"],
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam }) => {
        const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : "";
        const response = await fetch(`${BACKEND}/library/photos?media=video&sort=newest&limit=48${cursor}`);
        if (!response.ok) throw new Error("Your videos could not be loaded.");
        return response.json();
      },
      getNextPageParam: (page) => page.next_cursor ?? undefined,
    });

  const videos = useMemo(
    () =>
      Array.from(
        new Map((data?.pages.flatMap((p) => p.photos) ?? []).map((v) => [v.photo_id, v])).values(),
      ),
    [data],
  );

  // "This year" and "Over a minute" narrow what has been paged in — the
  // library endpoint takes no date or duration facet.
  const visible = useMemo(() => {
    if (filter === "year") {
      const thisYear = String(new Date().getFullYear());
      return videos.filter((video) => video.date_taken?.startsWith(thisYear));
    }
    if (filter === "long") return videos.filter((video) => (video.duration_seconds ?? 0) > 60);
    return videos;
  }, [videos, filter]);

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      visible.map((video) => ({
        photo_id: video.photo_id,
        thumb_url: thumbUrl(video),
        photo_title: video.photo_title,
        date_taken: video.date_taken,
        media_kind: "video" as const,
        duration_seconds: video.duration_seconds,
        flickr_url: video.flickr_url,
      })),
    [visible],
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
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, error, videos.length]);

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
        {FILTERS.map((option) => (
          <button
            key={option.id}
            className={`kx-chip ${filter === option.id ? "is-active" : ""}`}
            aria-pressed={filter === option.id}
            disabled={!option.enabled}
            title={option.enabled ? undefined : "Nothing records what you have watched yet"}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {isPending && <KxSkeletonCards count={8} minWidth={260} height={190} />}
      {!isPending && !error && visible.length === 0 &&
        (videos.length === 0 ? (
          <KxEmpty
            title="Nothing here yet."
            body="No videos yet. Anything you upload in a video format will appear here."
          />
        ) : (
          <KxEmptyResults onClear={() => setFilter("all")} />
        ))}

      <div className="kx-videogrid">
        {visible.map((video, index) => {
          const duration = formatDuration(video.duration_seconds);
          return (
            <button
              key={video.photo_id}
              className={`kx-videocard ${cardSpan(index)}`.trim()}
              onClick={() => openLightbox(video.photo_id, lightboxPhotos)}
              aria-label={`Play ${video.photo_title || "video"}${duration ? `, ${duration}` : ""}`}
            >
              <img src={thumbUrl(video)} alt="" loading="lazy" />
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

      {error && (
        <KxErrorBanner
          detail={(error as Error).message}
          onRetry={() => void (videos.length ? fetchNextPage() : refetch())}
        />
      )}
      {isFetchingNextPage && <KxSkeletonCards count={4} minWidth={260} height={190} />}
      {hasNextPage && !isFetchingNextPage && (
        <div className="kx-loadmore">
          <button className="kx-button" onClick={() => void fetchNextPage()}>
            Load more videos
          </button>
        </div>
      )}
      {!hasNextPage && videos.length > 0 && <p className="kx-status">That&rsquo;s everything.</p>}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
    </main>
  );
}
