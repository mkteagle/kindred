"use client";

import { OptimizedPhoto } from "@/components/optimized-photo";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { PlayIcon } from "@/components/kx/icons";
import { useKxUi } from "@/components/kx/ui-state";
import { useLibraryCounts, useStats } from "@/components/kx/use-library";
import { KxEmptyLibrary, KxErrorBanner, KxSkeletonGrid } from "@/components/kx/states";
import { KxSelectBar } from "@/components/kx/select-bar";
import { KxDayHeader } from "@/components/kx/day-header";
import { useDayLabels } from "@/components/kx/day-labels";
import { formatDuration, groupByDay, thumbUrl, tileSpan, type LibraryPhoto } from "@/components/kx/photos";

type Page = { photos: LibraryPhoto[]; next_cursor: string | null };

/** Movement in px before a mouse-down turns into a marquee sweep. */
const DRAG_THRESHOLD = 8;

interface Marquee {
  left: number;
  top: number;
  width: number;
  height: number;
}

export default function LibraryPage() {
  const { selecting, setSelecting, selected, setSelected, toggleSelected } = useKxUi();
  const { openLightbox } = useLightbox();
  const { data: counts } = useLibraryCounts();
  const { data: stats } = useStats();
  const dayLabels = useDayLabels();

  const sentinel = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  /** Live tile nodes, keyed by photo id — the marquee hit-tests against these. */
  const tileNodes = useRef(new Map<string, HTMLElement>());
  const sectionNodes = useRef(new Map<string, HTMLElement>());
  /** Set while a drag is finishing so the trailing click does not open a photo. */
  const draggedRef = useRef(false);

  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [activeYear, setActiveYear] = useState<number | null>(null);
  /**
   * The year the scrubber has seeked to, or null for the whole library.
   *
   * The list is newest-first, so seeking is a matter of starting the query at
   * the end of that year and letting the keyset cursor carry on backwards.
   * Paging forward until the year turned up — the previous approach — meant
   * roughly 250 sequential requests to reach 2003 in a library this size,
   * which reads as the scrubber simply not working.
   */
  const [seekYear, setSeekYear] = useState<number | null>(null);

  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery<Page>({
      queryKey: ["library-mosaic", seekYear],
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam }) => {
        // Keyset paging: page N costs the same as page 1, however deep the scroll.
        const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : "";
        const from = seekYear ? `&date_to=${seekYear}-12-31` : "";
        const response = await fetch(
          `${BACKEND}/library/photos?sort=newest&media=all&limit=96${from}${cursor}`,
        );
        if (!response.ok) throw new Error("The library could not be loaded.");
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

  const sections = useMemo(() => groupByDay(photos), [photos]);

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

  /* ── Paging ──────────────────────────────────────────────────────── */

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

  /* ── Year scrubber ───────────────────────────────────────────────── */

  // The whole span up front. Deriving it from the pages fetched so far would
  // give a scrubber that grows as you scroll, which is the one thing a
  // scrubber exists to avoid; /library/years answers it in a single group-by.
  const { data: yearRows } = useQuery<{ years: { year: number; count: number }[] }>({
    queryKey: ["library-years"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/library/years?media=all`);
      if (!response.ok) throw new Error("The year list could not be loaded.");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const years = useMemo(() => {
    if (yearRows?.years?.length) return yearRows.years.map((row) => row.year);
    // Until it lands, the years already on screen are better than none.
    const seen: number[] = [];
    for (const section of sections) {
      if (section.year && !seen.includes(section.year)) seen.push(section.year);
    }
    return seen;
  }, [yearRows, sections]);

  // Highlight the year of the topmost day header under the topbar.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number((entry.target as HTMLElement).dataset.year))
          .filter((year) => !Number.isNaN(year));
        if (visible.length) setActiveYear(visible[0]);
      },
      { rootMargin: "-70px 0px -75% 0px" },
    );
    sectionNodes.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [sections]);

  // Seeking refetches from the chosen year, so the first page already contains
  // it. Scroll to the top of the new list rather than hunting for a section
  // that is now the very first thing rendered.
  const seekToYear = useCallback(
    (year: number) => {
      const loaded = sections.find((section) => section.year === year);
      if (loaded) {
        // Already on screen — no refetch needed, just go there.
        sectionNodes.current.get(loaded.key)?.scrollIntoView({ block: "start", behavior: "smooth" });
        setActiveYear(year);
        return;
      }
      setSeekYear(year);
      setActiveYear(year);
      window.scrollTo({ top: 0, behavior: "auto" });
    },
    [sections],
  );

  /* ── Selection ───────────────────────────────────────────────────── */

  const selectDay = useCallback(
    (ids: string[]) => {
      setSelecting(true);
      setSelected((current) => {
        const next = new Set(current);
        const allOn = ids.every((id) => next.has(id));
        for (const id of ids) {
          if (allOn) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    },
    [setSelected, setSelecting],
  );

  /**
   * Drag-to-sweep. Starting on an already-selected tile sweeps the selection
   * off again; anything else adds. The threshold keeps a plain click from
   * being read as a one-pixel drag.
   */
  const onColumnMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-selectday]")) return;

      const startTile = target.closest<HTMLElement>("[data-photo-id]");
      const startId = startTile?.dataset.photoId;
      const mode: "add" | "remove" = startId && selected.has(startId) ? "remove" : "add";
      const base = new Set(selected);
      const x0 = event.clientX;
      const y0 = event.clientY;
      let live = false;

      const move = (moveEvent: MouseEvent) => {
        if (!live && Math.abs(moveEvent.clientX - x0) + Math.abs(moveEvent.clientY - y0) < DRAG_THRESHOLD) {
          return;
        }
        if (!live) {
          live = true;
          draggedRef.current = true;
          setSelecting(true);
        }

        const left = Math.min(x0, moveEvent.clientX);
        const right = Math.max(x0, moveEvent.clientX);
        const top = Math.min(y0, moveEvent.clientY);
        const bottom = Math.max(y0, moveEvent.clientY);

        const column = columnRef.current?.getBoundingClientRect();
        if (column) {
          setMarquee({
            left: left - column.left,
            top: top - column.top,
            width: right - left,
            height: bottom - top,
          });
        }

        const next = new Set(base);
        tileNodes.current.forEach((node, id) => {
          const box = node.getBoundingClientRect();
          const hit = box.right >= left && box.left <= right && box.bottom >= top && box.top <= bottom;
          if (!hit) return;
          if (mode === "add") next.add(id);
          else next.delete(id);
        });
        setSelected(next);
      };

      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        setMarquee(null);
        // Cleared after the click event that follows mouseup has been swallowed.
        if (live) setTimeout(() => (draggedRef.current = false), 0);
      };

      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [selected, setSelected, setSelecting],
  );

  const onTileClick = useCallback(
    (photo: LibraryPhoto) => {
      if (draggedRef.current) return;
      if (selecting) {
        toggleSelected(photo.photo_id);
        return;
      }
      openLightbox(photo.photo_id, lightboxPhotos);
    },
    [selecting, toggleSelected, openLightbox, lightboxPhotos],
  );

  const registerTile = useCallback((id: string, node: HTMLElement | null) => {
    if (node) tileNodes.current.set(id, node);
    else tileNodes.current.delete(id);
  }, []);

  const totalPhotos = counts?.total_files ?? 0;
  const totalPeople = stats?.people?.groups ?? 0;

  return (
    <main className="kx-page">
      <div className="kx-pagehead">
        <div className="kx-pagehead-copy">
          <span className="kx-eyebrow">Household library</span>
          <h1 className="kx-title">Everything, in order.</h1>
          <p className="kx-lede">
            A million photos, held one afternoon at a time. Scroll by year on the right, or jump
            straight to a person.
          </p>
        </div>
        <div className="kx-pagehead-pills">
          {totalPhotos > 0 && <span className="kx-pill">{fmt.format(totalPhotos)} photos</span>}
          {totalPeople > 0 && <span className="kx-pill">{fmt.format(totalPeople)} people</span>}
        </div>
      </div>

      <div className="kx-library-body">
        <div className="kx-mosaic-column" ref={columnRef} onMouseDown={onColumnMouseDown}>
          {sections.map((section) => {
            const ids = section.photos.map((photo) => photo.photo_id);
            const allSelected = ids.every((id) => selected.has(id));
            return (
              <section key={section.key}>
                <KxDayHeader
                  label={section.label}
                  count={section.photos.length}
                  day={dayLabels.get(section.key) ?? null}
                  allSelected={allSelected}
                  onSelectDay={() => selectDay(ids)}
                  year={section.year}
                  headerRef={(node) => {
                    if (node) sectionNodes.current.set(section.key, node);
                    else sectionNodes.current.delete(section.key);
                  }}
                />

                <div className="kx-daygrid">
                  {section.photos.map((photo, index) => {
                    const duration = formatDuration(photo.duration_seconds);
                    const isSelected = selected.has(photo.photo_id);
                    return (
                      <button
                        key={photo.photo_id}
                        ref={(node) => registerTile(photo.photo_id, node)}
                        data-photo-id={photo.photo_id}
                        className={`kx-tile ${tileSpan(index)} ${isSelected ? "is-selected" : ""}`.trim()}
                        aria-pressed={selecting ? isSelected : undefined}
                        aria-label={photo.photo_title || "Untitled"}
                        onClick={() => onTileClick(photo)}
                      >
                        <OptimizedPhoto photoId={photo.photo_id} video={photo.media_kind === "video"} />
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
              </section>
            );
          })}

          {marquee && (
            <div
              className="kx-marquee"
              style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
            />
          )}

          {isPending && <KxSkeletonGrid count={18} />}
          {!isPending && !error && photos.length === 0 && <KxEmptyLibrary />}
          {error && (
            <KxErrorBanner
              detail={(error as Error).message}
              onRetry={() => void (photos.length ? fetchNextPage() : refetch())}
            />
          )}
          {isFetchingNextPage && <KxSkeletonGrid count={6} />}
          {/* An explicit control as well as the observer: infinite scroll fails
              silently if the sentinel never enters the viewport. */}
          {hasNextPage && !isFetchingNextPage && (
            <div className="kx-loadmore">
              <button className="kx-button" onClick={() => void fetchNextPage()}>
                Load more photos
              </button>
            </div>
          )}
          {!hasNextPage && photos.length > 0 && <p className="kx-status">That&rsquo;s everything.</p>}
          <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
        </div>

        <nav className="kx-scrubber" aria-label="Jump to year">
          {seekYear !== null && (
            <button
              className="kx-scrubber-all"
              onClick={() => {
                setSeekYear(null);
                setActiveYear(null);
                window.scrollTo({ top: 0, behavior: "auto" });
              }}
              title="Show the whole library again"
            >
              All
            </button>
          )}
          {years.map((year) => (
            <button
              key={year}
              className={year === activeYear ? "is-active" : ""}
              aria-current={year === activeYear ? "true" : undefined}
              onClick={() => seekToYear(year)}
            >
              {year}
            </button>
          ))}
        </nav>
      </div>

      <KxSelectBar />

    </main>
  );
}
