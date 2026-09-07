// 218px sidebar: the inverse lockup, LIBRARY, WAYS IN, and the local-cache
// card pinned to the bottom.

import { Lockup } from "./Chrome";
import { formatBytes, formatCount } from "../lib/format";
import type { SidebarCounts } from "../lib/library";
import type { CacheStats } from "../lib/desktop";

export type ViewId =
  | "all"
  | "people"
  | "animals"
  | "vehicles"
  | "videos"
  | "timeline"
  | "locations"
  | "favorites"
  | "shared"
  | "events"
  | "together"
  | "colors"
  | "objects"
  | "duplicates";

type Row = { id: ViewId; label: string; count?: number | null };

export const VIEW_TITLES: Record<ViewId, string> = {
  all: "All photos",
  people: "People",
  animals: "Animals",
  vehicles: "Vehicles",
  videos: "Videos",
  timeline: "Timeline",
  locations: "Locations",
  favorites: "Favorites",
  shared: "Shared",
  events: "Events",
  together: "Together",
  colors: "Colors",
  objects: "Objects",
  duplicates: "Duplicates",
};

export function Sidebar({
  current,
  onNavigate,
  counts,
  cache,
  onOpenCacheSettings,
}: {
  current: ViewId;
  onNavigate: (view: ViewId) => void;
  counts: SidebarCounts | null;
  cache: CacheStats | null;
  onOpenCacheSettings: () => void;
}) {
  const libraryRows: Row[] = [
    { id: "all", label: "All photos", count: counts?.allPhotos },
    { id: "people", label: "People", count: counts?.people },
    { id: "animals", label: "Animals", count: counts?.animals },
    { id: "vehicles", label: "Vehicles", count: counts?.vehicles },
    { id: "videos", label: "Videos", count: counts?.videos },
    { id: "timeline", label: "Timeline" },
    { id: "locations", label: "Locations" },
    { id: "favorites", label: "Favorites", count: counts?.favorites },
    { id: "shared", label: "Shared", count: counts?.shared },
  ];
  const waysIn: Row[] = [
    { id: "events", label: "Events" },
    { id: "together", label: "Together" },
    { id: "colors", label: "Colors" },
    { id: "objects", label: "Objects" },
    { id: "duplicates", label: "Duplicates" },
  ];

  return (
    <nav
      aria-label="Library"
      style={{
        width: 218,
        flex: "none",
        borderRight: "1px solid var(--k-line)",
        padding: "14px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        overflow: "hidden",
      }}
    >
      <Lockup />
      <Group label="Library" rows={libraryRows} current={current} onNavigate={onNavigate} />
      <Group label="Ways in" rows={waysIn} current={current} onNavigate={onNavigate} />
      <CacheCard cache={cache} onOpen={onOpenCacheSettings} />
    </nav>
  );
}

function Group({
  label,
  rows,
  current,
  onNavigate,
}: {
  label: string;
  rows: Row[];
  current: ViewId;
  onNavigate: (view: ViewId) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span className="k-eyebrow" style={{ padding: "0 8px 7px" }}>
        {label}
      </span>
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className="k-row"
          aria-current={current === row.id}
          onClick={() => onNavigate(row.id)}
        >
          {row.label}
          {row.count !== undefined ? (
            <span className="k-row-count">
              {row.count === null ? "—" : formatCount(row.count)}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * The pinned cache card.
 *
 * The design's copy is "42 GB of 1.2 TB kept offline", where 1.2 TB is the size
 * of the whole library. Nothing on the backend reports that today — /library/counts
 * counts files, not bytes — so this shows the local allowance instead, which is
 * the number the member can actually act on.
 *
 * TODO: show the library's own size once an endpoint reports it. `GET
 * /library/counts` returning a `total_bytes` (SUM of the originals' sizes)
 * would close this.
 */
function CacheCard({ cache, onOpen }: { cache: CacheStats | null; onOpen: () => void }) {
  const used = cache?.used_bytes ?? 0;
  const limit = cache?.limit_bytes ?? 0;
  const fraction = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="k-card"
      style={{
        marginTop: "auto",
        padding: "11px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 7,
        textAlign: "left",
        color: "inherit",
      }}
    >
      <span className="k-eyebrow-quiet">Local cache</span>
      <span style={{ fontSize: 12, color: "var(--k-ink-2)" }}>
        {cache ? `${formatBytes(used)} of ${formatBytes(limit)} kept offline` : "Reading cache…"}
      </span>
      <span className="k-meter">
        <span className="k-meter-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </span>
    </button>
  );
}
