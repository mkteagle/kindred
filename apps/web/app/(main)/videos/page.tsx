"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";

interface VideoItem extends LightboxPhoto {
  duration_seconds: number | null;
}

type Page = { photos: VideoItem[]; next_cursor: string | null };

/** Duration badge: 9:05, or 1:02:33 once it runs past an hour. */
function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/**
 * One tile. The poster frame is a plain <img> so the grid paints immediately;
 * the looping clip is only fetched on hover (preload="none"), which keeps a
 * long scroll from pulling down a video per tile.
 */
function VideoTile({ video, onOpen }: { video: VideoItem; onOpen: () => void }) {
  const [hovering, setHovering] = useState(false);
  const clipRef = useRef<HTMLVideoElement>(null);
  const duration = formatDuration(video.duration_seconds);

  useEffect(() => {
    const clip = clipRef.current;
    if (!clip) return;
    if (hovering) {
      void clip.play().catch(() => {
        // Autoplay refusal is not worth surfacing; the poster still shows.
      });
    } else {
      clip.pause();
      clip.currentTime = 0;
    }
  }, [hovering]);

  return (
    <button
      className="video-card"
      onClick={onOpen}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      aria-label={`Play ${video.photo_title || "video"}${duration ? `, ${duration}` : ""}`}
    >
      <span className="video-card-frame">
        <img src={video.thumb_url} alt="" loading="lazy" />
        {hovering && (
          <video
            ref={clipRef}
            className="video-card-clip"
            src={`${BACKEND}/photos/${video.photo_id}/local?variant=clip`}
            muted
            loop
            playsInline
            preload="none"
          />
        )}
        <span className="video-card-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        {duration && <span className="video-card-duration">{duration}</span>}
      </span>
      <span className="video-card-title">{video.photo_title || "Untitled"}</span>
    </button>
  );
}

export default function VideosPage() {
  const [sort, setSort] = useState("newest");
  const sentinel = useRef<HTMLDivElement>(null);
  const { openLightbox } = useLightbox();

  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery<Page>({
      queryKey: ["videos", sort],
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam }) => {
        const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : "";
        const response = await fetch(
          `${BACKEND}/library/photos?media=video&sort=${sort}&limit=48${cursor}`,
        );
        if (!response.ok) throw new Error("Your videos could not be loaded.");
        const page: Page = await response.json();
        return {
          ...page,
          photos: page.photos.map((video) => ({
            ...video,
            thumb_url: `${BACKEND}/photos/${video.photo_id}/local?variant=thumb`,
          })),
        };
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

  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasNextPage || isFetchingNextPage || error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, loadMore, error, videos.length]);

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head">
          <div>
            <h2>Videos</h2>
            <p>Every video in your library. Hover a tile to preview it.</p>
          </div>
          <label>
            Sort videos{" "}
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">Newest taken</option>
              <option value="oldest">Oldest taken</option>
              <option value="added">Recently added</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
        </div>

        {isPending && <p role="status">Loading videos…</p>}
        {!isPending && !error && videos.length === 0 && (
          <p>No videos yet. Anything you upload in a video format will appear here.</p>
        )}

        <div className="video-grid">
          {videos.map((video) => (
            <VideoTile
              key={video.photo_id}
              video={video}
              onOpen={() =>
                openLightbox(
                  video.photo_id,
                  videos.map((v) => ({ ...v, media_kind: "video" as const })),
                )
              }
            />
          ))}
        </div>

        {error && (
          <p role="alert">
            {(error as Error).message}{" "}
            <button onClick={() => void (videos.length ? fetchNextPage() : refetch())}>Retry</button>
          </p>
        )}
        {isFetchingNextPage && <p role="status">Loading more videos…</p>}
        {/* Explicit control as well as the observer: infinite scroll fails
            silently if the sentinel never enters the viewport. */}
        {hasNextPage && !isFetchingNextPage && (
          <div className="load-more">
            <button className="button" onClick={() => void fetchNextPage()}>
              Load more videos
            </button>
          </div>
        )}
        {!hasNextPage && videos.length > 0 && (
          <p className="load-more-end">That&rsquo;s everything.</p>
        )}
        <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      </main>
    </div>
  );
}
