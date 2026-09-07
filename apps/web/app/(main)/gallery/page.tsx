"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import { LibraryCounts } from "@/components/library-counts";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";

type Page = { photos: LightboxPhoto[]; next_cursor: string | null };

export default function GalleryPage() {
  const [sort, setSort] = useState("newest");
  const sentinel = useRef<HTMLDivElement>(null);
  const { openLightbox } = useLightbox();
  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = useInfiniteQuery<Page>({
    queryKey: ["gallery", sort],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      // Keyset paging: page N costs the same as page 1, however deep the scroll.
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : "";
      const response = await fetch(`${BACKEND}/library/photos?sort=${sort}&limit=48${cursor}`);
      if (!response.ok) throw new Error("The gallery could not be loaded.");
      const page: Page = await response.json();
      return { ...page, photos: page.photos.map(p => ({ ...p,
        thumb_url: `${BACKEND}/photos/${p.photo_id}/image?size=n`,
      })) };
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const photos = useMemo(() => Array.from(new Map(
    (data?.pages.flatMap(p => p.photos) ?? []).map(p => [p.photo_id, p]),
  ).values()), [data]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasNextPage || isFetchingNextPage || error) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void fetchNextPage();
    }, { rootMargin: "600px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, error, photos.length]);

  return <div className="app-shell"><main className="page">
    <div className="content-head">
      <div><h2>Gallery</h2><p>All your photos, in one place.</p></div>
      <label>Sort photos <select value={sort} onChange={e => setSort(e.target.value)}>
        <option value="newest">Newest taken</option><option value="oldest">Oldest taken</option>
        <option value="added">Recently added</option><option value="name">Name A–Z</option>
      </select></label>
    </div>
    <LibraryCounts />
    {isPending && <p role="status">Loading photos…</p>}
    {!isPending && !error && photos.length === 0 && <p>No photos have been added yet.</p>}
    <div className="clip-results-grid">
      {photos.map(photo => <button key={photo.photo_id} className="clip-result-card"
        onClick={() => openLightbox(photo.photo_id, photos)}
        style={{ border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}>
        <img src={photo.thumb_url} alt={photo.photo_title || "Photo"} loading="lazy" />
        <div className="clip-result-info"><span className="clip-result-title">{photo.photo_title || "Untitled"}</span></div>
      </button>)}
    </div>
    {error && <p role="alert">{error.message} <button onClick={() => { void (photos.length ? fetchNextPage() : refetch()); }}>Retry</button></p>}
    {isFetchingNextPage && <p role="status">Loading photos…</p>}
    {hasNextPage && !isFetchingNextPage && (
      <div className="load-more">
        <button className="button" onClick={() => void fetchNextPage()}>Load more photos</button>
      </div>
    )}
    {!hasNextPage && photos.length > 0 && <p className="load-more-end">That&rsquo;s everything.</p>}
    <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
  </main></div>;
}
