"use client";

import { OptimizedPhoto } from "@/components/optimized-photo";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { HeartIcon, PlayIcon } from "@/components/kx/icons";
import { useFavorites } from "@/components/kx/favorites";
import { KxEmpty, KxErrorBanner, KxSkeletonGrid } from "@/components/kx/states";
import { formatDuration, thumbUrl, tileSpan, type LibraryPhoto } from "@/components/kx/photos";

type Page = { photos: LibraryPhoto[]; next_cursor: string | null };

/**
 * The member's own favourites, in the library's mosaic. Paged exactly like
 * /library/photos — the endpoint is the same query with one extra clause, so
 * a household with tens of thousands of favourites costs no more per page.
 */
export default function FavoritesPage() {
  const { openLightbox } = useLightbox();
  const { count, seed } = useFavorites();
  const sentinel = useRef<HTMLDivElement>(null);

  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery<Page>({
      queryKey: ["favorites-mosaic"],
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam }) => {
        const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : "";
        const response = await fetch(`${BACKEND}/favorites?sort=newest&media=all&limit=96${cursor}`);
        if (!response.ok) throw new Error("Your favourites could not be loaded.");
        return response.json();
      },
      getNextPageParam: (page) => page.next_cursor ?? undefined,
    });

  const photos = useMemo(
    () =>
      Array.from(
        new Map((data?.pages.flatMap((p) => p.photos) ?? []).map((p) => [p.photo_id, p])).values(),
      ),
    [data],
  );

  // Every id here is favourited by definition, so the shell's set learns from
  // this page and the hearts elsewhere come up filled.
  useEffect(() => {
    seed(photos.map((photo) => photo.photo_id));
  }, [photos, seed]);

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      photos.map((photo) => ({
        photo_id: photo.photo_id,
        thumb_url: thumbUrl(photo),
        photo_title: photo.photo_title,
        date_taken: photo.date_taken,
        media_kind: photo.media_kind,
        duration_seconds: photo.duration_seconds,
        flickr_url: photo.flickr_url,
      })),
    [photos],
  );

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasNextPage || isFetchingNextPage || error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchNextPage();
      },
      { rootMargin: "800px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, error, photos.length]);

  return (
    <main className="kx-page">
      <div className="kx-pagehead">
        <div className="kx-pagehead-copy">
          <span className="kx-eyebrow">Favorites</span>
          <h1 className="kx-title">The ones you keep coming back to.</h1>
          <p className="kx-lede">
            Yours alone — every member of the household keeps their own.
          </p>
        </div>
        {count !== null && count > 0 && (
          <div className="kx-pagehead-pills">
            <span className="kx-pill">{fmt.format(count)} photos</span>
          </div>
        )}
      </div>

      {isPending && <KxSkeletonGrid count={12} />}
      {error && (
        <KxErrorBanner
          detail={(error as Error).message}
          onRetry={() => void (photos.length ? fetchNextPage() : refetch())}
        />
      )}
      {!isPending && !error && photos.length === 0 && (
        <KxEmpty
          title="Nothing here yet."
          body="Open a photo and tap the heart. What you keep is yours alone — nobody else in the household sees this list."
          action={{ label: "Browse the library", href: "/gallery", primary: true }}
        />
      )}

      {photos.length > 0 && (
        <div className="kx-daygrid">
          {photos.map((photo, index) => {
            const duration = formatDuration(photo.duration_seconds);
            return (
              <button
                key={photo.photo_id}
                className={`kx-tile ${tileSpan(index)}`.trim()}
                aria-label={photo.photo_title || "Untitled"}
                onClick={() => openLightbox(photo.photo_id, lightboxPhotos)}
              >
                <OptimizedPhoto photoId={photo.photo_id} video={photo.media_kind === "video"} />
                {/* The hero tile carries the heart; repeating it on every tile
                    would say the same thing 96 times. */}
                {index === 0 && (
                  <span className="kx-tile-heart" aria-hidden="true">
                    <HeartIcon size={17} filled />
                  </span>
                )}
                {photo.media_kind === "video" && (
                  <span className="kx-tile-video">
                    <PlayIcon size={9} />
                    {duration ?? "Video"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {isFetchingNextPage && <KxSkeletonGrid count={6} />}
      {hasNextPage && !isFetchingNextPage && (
        <div className="kx-loadmore">
          <button className="kx-button" onClick={() => void fetchNextPage()}>
            Load more photos
          </button>
        </div>
      )}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
    </main>
  );
}
