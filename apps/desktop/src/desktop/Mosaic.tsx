// The virtualised day-grouped mosaic.
//
// Six columns at 116px rows with 3px gaps, sticky day headers, and only the
// rows on screen in the DOM — the real library is over a million rows, so the
// grid is laid out arithmetically and rendered sparsely.
//
// Layout is computed once per section into explicit (column, row, span) cells
// rather than left to CSS grid auto-placement, because virtualisation needs to
// know which photos live on row N without asking the browser. That is also
// what lets the lead tile of each day span 2×2 and a landscape tile span 2×1,
// the way the mosaic reads in the design, without breaking the row maths.
//
// Selection is keyed by photo id and lives above this component, so it survives
// both virtualisation and a page of older months arriving.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { PhotoTile, type TilePhoto } from "./PhotoTile";
import type { Selection } from "../lib/selection";

const COLUMNS = 6;
const ROW_HEIGHT = 116;
const GAP = 3;
const HEADER_HEIGHT = 40;
const SECTION_GAP = 8;
/** Rows rendered above and below the viewport so a fast scroll is not blank. */
const OVERSCAN_ROWS = 3;

export type MosaicSection = {
  key: string;
  title: string;
  /** A member-named event or a reverse-geocoded place. Never invented. */
  subtitle?: string | null;
  photos: TilePhoto[];
};

type Cell = { photo: TilePhoto; column: number; row: number; columnSpan: number; rowSpan: number };

type LaidOutSection = {
  section: MosaicSection;
  cells: Cell[];
  rows: number;
  /** Distance from the top of the whole list to this section's header. */
  top: number;
  height: number;
};

/**
 * Greedy packer over a 6-wide occupancy grid.
 *
 * The lead photo of a day gets 2×2 and roughly every eleventh gets 2×1; the
 * rest are single cells dropped into the first free slot. Deterministic, so a
 * tile does not jump when its section re-renders.
 */
function layoutSection(photos: TilePhoto[]): { cells: Cell[]; rows: number } {
  const occupied: boolean[][] = [];
  const isFree = (row: number, column: number, columnSpan: number, rowSpan: number) => {
    if (column + columnSpan > COLUMNS) return false;
    for (let r = row; r < row + rowSpan; r += 1) {
      for (let c = column; c < column + columnSpan; c += 1) {
        if (occupied[r]?.[c]) return false;
      }
    }
    return true;
  };
  const occupy = (row: number, column: number, columnSpan: number, rowSpan: number) => {
    for (let r = row; r < row + rowSpan; r += 1) {
      occupied[r] = occupied[r] ?? [];
      for (let c = column; c < column + columnSpan; c += 1) occupied[r][c] = true;
    }
  };

  const cells: Cell[] = [];
  let rows = 0;
  photos.forEach((photo, index) => {
    const columnSpan = index === 0 ? 2 : index % 11 === 8 ? 2 : 1;
    const rowSpan = index === 0 ? 2 : 1;
    let placed = false;
    for (let row = 0; !placed; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        if (isFree(row, column, columnSpan, rowSpan)) {
          occupy(row, column, columnSpan, rowSpan);
          cells.push({ photo, column, row, columnSpan, rowSpan });
          rows = Math.max(rows, row + rowSpan);
          placed = true;
          break;
        }
      }
      // A span-2 tile can be blocked on every column of a row; the next row
      // always has space, so this terminates.
    }
  });
  return { cells, rows };
}

type Props = {
  sections: MosaicSection[];
  /** Every photo id in display order — what ⇧ ranges and arrow keys walk. */
  ordered: string[];
  selection: Selection;
  onOpen: (photoId: string) => void;
  onQuickLook: (photoId: string) => void;
  onReachEnd?: () => void;
  loadingMore?: boolean;
  empty?: ReactNode;
};

export function Mosaic({
  sections,
  ordered,
  selection,
  onOpen,
  onQuickLook,
  onReachEnd,
  loadingMore,
  empty,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);

  // Measure rather than assume: the sidebar and the scrubber both take width,
  // and the window is resizable.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setViewport({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  const laidOut = useMemo(() => {
    let top = 0;
    const out: LaidOutSection[] = sections.map((section) => {
      const { cells, rows } = layoutSection(section.photos);
      const height = HEADER_HEIGHT + rows * (ROW_HEIGHT + GAP) + SECTION_GAP;
      const entry: LaidOutSection = { section, cells, rows, top, height };
      top += height;
      return entry;
    });
    return { list: out, total: top };
  }, [sections]);

  const columnWidth = viewport.width > 0 ? (viewport.width - GAP * (COLUMNS - 1)) / COLUMNS : 0;

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      setScrollTop(element.scrollTop);
      if (
        onReachEnd &&
        element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT * 4
      ) {
        onReachEnd();
      }
    },
    [onReachEnd],
  );

  /** Scroll a photo into view even when its row is not currently rendered. */
  const revealPhoto = useCallback(
    (photoId: string) => {
      const element = scrollRef.current;
      if (!element) return;
      for (const entry of laidOut.list) {
        const cell = entry.cells.find((c) => c.photo.photo_id === photoId);
        if (!cell) continue;
        const cellTop = entry.top + HEADER_HEIGHT + cell.row * (ROW_HEIGHT + GAP);
        const cellBottom = cellTop + cell.rowSpan * ROW_HEIGHT;
        if (cellTop < element.scrollTop + HEADER_HEIGHT) {
          element.scrollTop = Math.max(0, cellTop - HEADER_HEIGHT);
        } else if (cellBottom > element.scrollTop + element.clientHeight) {
          element.scrollTop = cellBottom - element.clientHeight;
        }
        return;
      }
    },
    [laidOut],
  );

  // Move DOM focus after the tile has been rendered by the virtualiser.
  useEffect(() => {
    if (!pendingFocus.current) return;
    const id = pendingFocus.current;
    const element = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-photo-id="${CSS.escape(id)}"]`,
    );
    if (element) {
      element.focus();
      pendingFocus.current = null;
    }
  });

  const moveFocus = useCallback(
    (photoId: string) => {
      setFocusedId(photoId);
      pendingFocus.current = photoId;
      revealPhoto(photoId);
    },
    [revealPhoto],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, photoId: string) => {
      const index = ordered.indexOf(photoId);
      const step = (delta: number) => {
        const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))];
        if (!next || next === photoId) return;
        event.preventDefault();
        moveFocus(next);
        if (event.shiftKey) selection.selectRange(next, ordered);
        else selection.selectOnly(next);
      };
      switch (event.key) {
        case "ArrowRight":
          step(1);
          break;
        case "ArrowLeft":
          step(-1);
          break;
        case "ArrowDown":
          step(COLUMNS);
          break;
        case "ArrowUp":
          step(-COLUMNS);
          break;
        case "Home":
          step(-index);
          break;
        case "End":
          step(ordered.length - 1 - index);
          break;
        case "Enter":
          event.preventDefault();
          onOpen(photoId);
          break;
        case " ":
          event.preventDefault();
          onQuickLook(photoId);
          break;
        default:
          break;
      }
    },
    [ordered, moveFocus, selection, onOpen, onQuickLook],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, photoId: string) => {
      setFocusedId(photoId);
      if (event.shiftKey) selection.selectRange(photoId, ordered);
      else if (event.metaKey || event.ctrlKey) selection.toggle(photoId);
      else selection.selectOnly(photoId);
    },
    [ordered, selection],
  );

  // A tile is only focusable when it is the roving one; if that photo has gone
  // (a filter changed), hand the tab stop to the first tile so the grid never
  // becomes unreachable by keyboard.
  const rovingId = focusedId && ordered.includes(focusedId) ? focusedId : ordered[0] ?? null;

  const visibleTop = scrollTop - OVERSCAN_ROWS * (ROW_HEIGHT + GAP);
  const visibleBottom = scrollTop + viewport.height + OVERSCAN_ROWS * (ROW_HEIGHT + GAP);

  if (sections.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="k-scroll"
        style={{ flex: "1 1 auto", minWidth: 0, display: "grid", placeItems: "center" }}
      >
        {empty}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="k-scroll"
      onScroll={onScroll}
      style={{ flex: "1 1 auto", minWidth: 0, position: "relative", padding: "0 4px" }}
    >
      <div style={{ height: laidOut.total, position: "relative" }}>
        {laidOut.list.map((entry) => {
          if (entry.top + entry.height < visibleTop || entry.top > visibleBottom) return null;
          return (
            <section
              key={entry.section.key}
              style={{ position: "absolute", top: entry.top, left: 0, right: 0, height: entry.height }}
              aria-label={entry.section.title}
            >
              <SectionHeader
                section={entry.section}
                onSelectAll={() =>
                  selection.addAll(entry.section.photos.map((p) => p.photo_id))
                }
              />
              <div style={{ position: "relative", height: entry.rows * (ROW_HEIGHT + GAP) }}>
                {entry.cells.map((cell) => {
                  const cellTop = cell.row * (ROW_HEIGHT + GAP);
                  const absoluteTop = entry.top + HEADER_HEIGHT + cellTop;
                  const cellHeight = cell.rowSpan * ROW_HEIGHT + (cell.rowSpan - 1) * GAP;
                  if (
                    absoluteTop + cellHeight < visibleTop ||
                    absoluteTop > visibleBottom
                  ) {
                    return null;
                  }
                  const inViewport =
                    absoluteTop + cellHeight >= scrollTop &&
                    absoluteTop <= scrollTop + viewport.height;
                  return (
                    <div
                      key={cell.photo.photo_id}
                      style={{
                        position: "absolute",
                        top: cellTop,
                        left: cell.column * (columnWidth + GAP),
                        width: cell.columnSpan * columnWidth + (cell.columnSpan - 1) * GAP,
                        height: cellHeight,
                      }}
                    >
                      <PhotoTile
                        photo={cell.photo}
                        selected={selection.isSelected(cell.photo.photo_id)}
                        focused={rovingId === cell.photo.photo_id}
                        visible={inViewport}
                        onClick={(event) => handleClick(event, cell.photo.photo_id)}
                        onDoubleClick={() => onOpen(cell.photo.photo_id)}
                        onKeyDown={(event) => handleKeyDown(event, cell.photo.photo_id)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {loadingMore ? (
        <div style={{ padding: "14px 12px" }} className="k-mono">
          Loading more…
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({
  section,
  onSelectAll,
}: {
  section: MosaicSection;
  onSelectAll: () => void;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        height: HEADER_HEIGHT,
        padding: "12px 12px 8px",
        background:
          "linear-gradient(180deg, var(--k-bg) 60%, rgba(12,14,12,0) 100%)",
      }}
    >
      <strong style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>
        {section.title}
      </strong>
      <span className="k-mono">
        {section.subtitle ? `${section.subtitle} · ` : ""}
        {section.photos.length.toLocaleString()}{" "}
        {section.photos.length === 1 ? "photo" : "photos"}
      </span>
      <button
        type="button"
        onClick={onSelectAll}
        className="k-mono"
        style={{
          marginLeft: "auto",
          padding: "3px 9px",
          borderRadius: 999,
          border: "1px solid var(--k-line-3)",
          background: "transparent",
          color: "var(--k-ink-2)",
        }}
      >
        Select all {section.photos.length}
      </button>
    </div>
  );
}
