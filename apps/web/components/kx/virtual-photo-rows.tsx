"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { JUNK_LABELS } from "@/lib/library-junk";
import { OptimizedPhoto } from "@/components/optimized-photo";
import { KxDayHeader } from "./day-header";
import { PlayIcon } from "./icons";
import { useKxUi } from "./ui-state";
import { formatDuration, type DaySection, type LibraryPhoto } from "./photos";
import type { DayLabel } from "./day-labels";

interface PhotoRow {
  key: string;
  section: DaySection;
  header: boolean;
  tiles: LibraryPhoto[];
}

/** Virtualize rows rather than entire days: a single day can contain 50,000 items. */
export function VirtualPhotoRows({ sections, selected, selecting, onSelectDay, onTileClick, registerTile,
  dayLabels, hasNextPage, fetching, error, fetchNextPage, onVisibleYear,
}: {
  sections: DaySection[];
  selected: ReadonlySet<string>;
  selecting: boolean;
  onSelectDay: (ids: string[]) => void;
  onTileClick: (photo: LibraryPhoto) => void;
  registerTile: (id: string, node: HTMLElement | null) => void;
  dayLabels?: Map<string, DayLabel>;
  hasNextPage: boolean;
  fetching: boolean;
  error: boolean;
  fetchNextPage: () => void;
  onVisibleYear: (year: number | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { tile } = useKxUi();
  const [box, setBox] = useState({ width: 900, top: 0 });
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const scroller = node.closest<HTMLElement>(".kx-content");
      const next = { width: rect.width, top: rect.top - (scroller?.getBoundingClientRect().top ?? 0) + (scroller?.scrollTop ?? 0) };
      setBox(previous => previous.width === next.width && Math.abs(previous.top - next.top) < 1 ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // Filters, font loading, and shell banners can move the list without resizing it.
    if (node.parentElement) observer.observe(node.parentElement);
    const main = node.closest("main");
    if (main) observer.observe(main);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const columns = Math.max(2, Math.floor((box.width + 8) / (tile + 8)));
  const height = Math.max(110, Math.min(270, (box.width - (columns - 1) * 8) / columns));
  const rows = useMemo(() => {
    const result: PhotoRow[] = [];
    for (const section of sections) {
      result.push({ key: `header-${section.key}`, section, header: true, tiles: [] });
      for (let index = 0; index < section.photos.length; index += columns) {
        const tiles = section.photos.slice(index, index + columns);
        result.push({ key: `photos-${tiles[0].photo_id}`, section, header: false, tiles });
      }
    }
    return result;
  }, [sections, columns]);

  const virtualizer = useVirtualizer({
    getScrollElement: () => container.current?.closest<HTMLElement>(".kx-content") ?? null,
    count: rows.length,
    estimateSize: index => rows[index].header ? 54 : height + 8,
    getItemKey: index => rows[index].key,
    overscan: 4,
    scrollMargin: box.top,
  });
  useEffect(() => { virtualizer.measure(); }, [height, columns, virtualizer]);
  const items = virtualizer.getVirtualItems();
  // The range excludes overscan, so a pre-rendered row cannot select the rail's year early.
  const visibleYear = rows[virtualizer.range?.startIndex ?? 0]?.section.year || null;
  useEffect(() => { onVisibleYear(visibleYear); }, [onVisibleYear, visibleYear]);
  const last = items[items.length - 1]?.index ?? -1;
  useEffect(() => {
    if (last >= rows.length - 5 && hasNextPage && !fetching && !error) fetchNextPage();
  }, [last, rows.length, hasNextPage, fetching, error, fetchNextPage]);

  return <div ref={container} className="kx-virtual-photos" data-virtual-rows={rows.length}
    style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
    {items.map(item => {
      const row = rows[item.index];
      return <div key={item.key} data-virtual-row={item.index} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: item.size, transform: `translateY(${item.start - box.top}px)` }}>
        {row.header ? <KxDayHeader label={row.section.label} count={row.section.photos.length}
          day={dayLabels?.get(row.section.key) ?? null} year={row.section.year}
          allSelected={row.section.photos.every(photo => selected.has(photo.photo_id))}
          onSelectDay={() => onSelectDay(row.section.photos.map(photo => photo.photo_id))}
          headerRef={() => {}} loadedOnly /> :
          <div className="kx-virtual-photo-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, height }}>
            {row.tiles.map((photo) => <button key={photo.photo_id}
              ref={node => registerTile(photo.photo_id, node)} data-photo-id={photo.photo_id}
              className={`kx-tile ${selected.has(photo.photo_id) ? "is-selected" : ""}`}

              aria-pressed={selecting ? selected.has(photo.photo_id) : undefined}
              aria-label={photo.photo_title || (photo.media_kind === "video" ? "Open video" : "Open photo")}
              onClick={() => onTileClick(photo)}>
              <OptimizedPhoto photoId={photo.photo_id} video={photo.media_kind === "video"} thumbnailUrl={photo.thumbnail_url} />
              {selected.has(photo.photo_id) && <span className="kx-selected-mark" aria-hidden="true">✓</span>}
              {photo.junk_reason && <span className="kx-tile-video">{JUNK_LABELS[photo.junk_reason]}</span>}
              {photo.media_kind === "video" && <span className="kx-tile-video"><PlayIcon size={9} />{formatDuration(photo.duration_seconds) ?? "Video"}</span>}
            </button>)}
          </div>}
      </div>;
    })}
  </div>;
}
