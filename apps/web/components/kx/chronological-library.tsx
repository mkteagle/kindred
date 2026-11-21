"use client";

import Link from "next/link";
import { VirtualPhotoRows } from "./virtual-photo-rows";
import { DiscoveryProgress } from "./discovery-progress";

import { useCallback, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { useKxUi } from "@/components/kx/ui-state";
import { useLibraryCounts } from "@/components/kx/use-library";
import { KxEmptyLibrary, KxErrorBanner, KxSkeletonGrid } from "@/components/kx/states";
import { KxSelectBar } from "@/components/kx/select-bar";
import { useLibraryDayLabels } from "@/components/kx/day-labels";
import { formatDuration, groupByDay, thumbUrl, type LibraryPhoto } from "@/components/kx/photos";

type Page = { photos: LibraryPhoto[]; next_cursor: string | null };

/** Movement in px before a mouse-down turns into a marquee sweep. */
const DRAG_THRESHOLD = 8;

interface Marquee {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ChronologicalLibrary({ timeline = false, albumId }: { timeline?: boolean; albumId?: string }) {
  const { selecting, setSelecting, selected, setSelected, toggleSelected } = useKxUi();
  const { openLightbox } = useLightbox();
  const { data: counts } = useLibraryCounts();



  const columnRef = useRef<HTMLDivElement>(null);
  const scrollToTop = useCallback(() => {
    columnRef.current?.closest<HTMLElement>(".kx-content")?.scrollTo({ top: 0, behavior: "auto" });
  }, []);
  /** Live tile nodes, keyed by photo id — the marquee hit-tests against these. */
  const tileNodes = useRef(new Map<string, HTMLElement>());

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
  const [media, setMedia] = useState("all");
  const [grain, setGrain] = useState<"days" | "months" | "years">(timeline ? "months" : "days");
  const [dateTo, setDateTo] = useState("");
  const [dateOpen, setDateOpen] = useState(false);

  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery<Page>({
      queryKey: ["library-mosaic", media, seekYear, dateTo, albumId],
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam, signal }) => {
        const params = new URLSearchParams({ sort: "newest", media, limit: "96" });
        if (pageParam) params.set("cursor", pageParam as string);
        if (albumId) params.set("album_id", albumId);
        if (dateTo || seekYear) params.set("date_to", dateTo || `${seekYear}-12-31`);
        const response = await fetch(`${BACKEND}/library/photos?${params}`, { signal });
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

  const sections = useMemo(() => {
    const days = groupByDay(photos);
    if (grain === "days") return days;
    const groups: ReturnType<typeof groupByDay> = [];
    for (const day of days) {
      const key = day.key === "undated" ? day.key : day.key.slice(0, grain === "years" ? 4 : 7);
      const last = groups[groups.length - 1];
      if (last?.key === key) last.photos.push(...day.photos);
      else groups.push({ ...day, key, photos: [...day.photos], label: key === "undated" ? "Undated" : grain === "years" ? key : new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${key}-01T12:00:00`)) });
    }
    return groups;
  }, [photos, grain]);

  const dated = photos.filter(photo => photo.date_taken);
  const dayLabels = useLibraryDayLabels(dated[dated.length - 1]?.date_taken?.slice(0, 10), dated[0]?.date_taken?.slice(0, 10));

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

  // The whole span up front. Deriving it from the pages fetched so far would
  // give a scrubber that grows as you scroll, which is the one thing a
  // scrubber exists to avoid; /library/years answers it in a single group-by.
  const { data: yearRows } = useQuery<{ years: { year: number; count: number }[] }>({
    queryKey: ["library-years", media],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/library/years?media=${media}`);
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

  const seekToYear = useCallback((year: number) => {
    setDateTo("");
    setSeekYear(year);
    setActiveYear(year);
    scrollToTop();
  }, [scrollToTop]);

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

  const album = useQuery<{ name: string; photo_count: number }>({
    queryKey: ["album", albumId], enabled: !!albumId,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${BACKEND}/albums/${encodeURIComponent(albumId!)}`, { signal });
      if (!response.ok) throw new Error("This album could not be loaded");
      return response.json();
    },
  });
  const totalItems = albumId ? album.data?.photo_count : media === "photo" ? counts?.photos : media === "video" ? counts?.videos : counts?.total_files;

  return (
    <main className="kx-page kx-library-page">
      {!albumId && <DiscoveryProgress />}
      <div className="kx-pagehead">
        <div className="kx-pagehead-copy">
          {albumId && <Link href="/albums" className="kx-connection-help">← Albums</Link>}
          <h1 className="kx-title">{albumId ? album.data?.name || "Your album." : timeline ? "A little time travel." : "Your library."}</h1>
          <p className="kx-lede">{albumId ? "A few moments that belong together." : timeline ? "Big milestones. Ordinary Tuesdays. Every moment in between." : "Every little moment. Right where it belongs."}</p>
        </div>
        <span className="kx-library-total">{totalItems === undefined ? "Your moments, together" : `${fmt.format(totalItems)} items`} · Newest first</span>
      </div>
      <div className="kx-library-filters">
        <div className="kx-chiprow" role="group" aria-label="Media type">
          {[["all", "All media"], ["photo", "Photos"], ["video", "Videos"]].map(([value, label]) => (
            <button key={value} className={`kx-chip ${media === value ? "is-active" : ""}`} aria-pressed={media === value} onClick={() => { setMedia(value); scrollToTop(); }}>{label}</button>
          ))}
          <Link className="kx-chip" href="/people">People</Link>
          <button className={`kx-chip ${dateTo ? "is-active" : ""}`} aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}>Date{dateTo ? ` · ${dateTo}` : ""}</button>
          <Link className="kx-chip" href="/search">More filters</Link>
        </div>
        {timeline && <div className="kx-grain" role="group" aria-label="Group timeline">
          {(["years", "months", "days"] as const).map(value => <button key={value} className={grain === value ? "is-active" : ""} aria-pressed={grain === value} onClick={() => setGrain(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>}
      </div>
      {dateOpen && <div className="kx-date-filter">
        <label>Jump to date <input className="kx-input" type="date" value={dateTo} onChange={e => { setSeekYear(null); setActiveYear(null); setDateTo(e.target.value); scrollToTop(); }} /></label>
        {(dateTo || seekYear) && <button className="kx-button" onClick={() => { setDateTo(""); setSeekYear(null); setActiveYear(null); }}>Show all dates</button>}
      </div>}
      {counts && counts.pending_index > 0 && <p className="kx-index-note">Your library is ready to browse. Search keeps getting better as indexing finishes. <Link href="/pipelines">View progress →</Link></p>}

      <div className="kx-library-body">
        <div className="kx-mosaic-column" ref={columnRef} onMouseDown={onColumnMouseDown}>
          <VirtualPhotoRows sections={sections} selected={selected} selecting={selecting}
            onSelectDay={selectDay} onTileClick={onTileClick} registerTile={registerTile}
            dayLabels={grain === "days" ? dayLabels : undefined}
            hasNextPage={hasNextPage} fetching={isFetchingNextPage} error={Boolean(error)}
            fetchNextPage={() => void fetchNextPage()} onActiveYear={setActiveYear}
          />

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

        </div>

        <nav className="kx-scrubber" aria-label="Jump to year">
          {(seekYear !== null || dateTo) && (
            <button
              className="kx-scrubber-all"
              onClick={() => {
                setSeekYear(null);
                setDateTo("");
                setActiveYear(null);
                scrollToTop();
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
