"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  tiles: { photo: LibraryPhoto; span: number }[];
}

/** Virtualize rows rather than entire days: a single day can contain 50,000 items. */
export function VirtualPhotoRows({ sections, selected, selecting, onSelectDay, onTileClick, registerTile,
  dayLabels, hasNextPage, fetching, error, fetchNextPage, onActiveYear,
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
  onActiveYear: (year: number | null) => void;
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
  const height = Math.max(110, Math.min(270, (box.width - (columns - 1) * 8) / columns * 1.12));
  const rows = useMemo(() => {
    const result: PhotoRow[] = [];
    for (const section of sections) {
      result.push({ key: `header-${section.key}`, section, header: true, tiles: [] });
      let tiles: PhotoRow["tiles"] = [];
      let used = 0;
      for (let index = 0; index < section.photos.length; index++) {
        const photo = section.photos[index];
        const span = columns >= 4 && (index === 0 || index % 7 === 6) && used <= columns - 2 ? 2 : 1;
        tiles.push({ photo, span });
        used += span;
        if (used === columns || index === section.photos.length - 1) {
          result.push({ key: `photos-${tiles[0].photo.photo_id}`, section, header: false, tiles });
          tiles = [];
          used = 0;
        }
      }
    }
    return result;
  }, [sections, columns]);

  const virtualizer = useVirtualizer({
    getScrollElement: () => container.current?.closest<HTMLElement>(".kx-content") ?? null,
    count: rows.length,
    estimateSize: index => rows[index].header ? 72 : height + 8,
    getItemKey: index => rows[index].key,
    overscan: 4,
    scrollMargin: box.top,
  });
  useEffect(() => { virtualizer.measure(); }, [height, columns, virtualizer]);
  const items = virtualizer.getVirtualItems();
  const last = items[items.length - 1]?.index ?? -1;
  useEffect(() => {
    if (last >= rows.length - 5 && hasNextPage && !fetching && !error) fetchNextPage();
  }, [last, rows.length, hasNextPage, fetching, error, fetchNextPage]);
  const firstVisible = items.find(item => item.end > (virtualizer.scrollOffset ?? 0));
  const visibleYear = firstVisible ? rows[firstVisible.index]?.section.year || null : null;
  useEffect(() => { onActiveYear(visibleYear); }, [visibleYear, onActiveYear]);

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
            {row.tiles.map(({ photo, span }) => <button key={photo.photo_id}
              ref={node => registerTile(photo.photo_id, node)} data-photo-id={photo.photo_id}
              className={`kx-tile ${selected.has(photo.photo_id) ? "is-selected" : ""}`}
              style={{ gridColumn: `span ${span}` }}
              aria-pressed={selecting ? selected.has(photo.photo_id) : undefined}
              aria-label={photo.photo_title || (photo.media_kind === "video" ? "Open video" : "Open photo")}
              onClick={() => onTileClick(photo)}>
              <OptimizedPhoto photoId={photo.photo_id} video={photo.media_kind === "video"} />
              {selected.has(photo.photo_id) && <span className="kx-selected-mark" aria-hidden="true">✓</span>}
              {photo.media_kind === "video" && <span className="kx-tile-video"><PlayIcon size={9} />{formatDuration(photo.duration_seconds) ?? "Video"}</span>}
            </button>)}
          </div>}
      </div>;
    })}
  </div>;
}
