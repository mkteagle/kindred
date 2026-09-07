"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { fmt } from "@/lib/constants";
import { NavIcon, SidebarIcon } from "./icons";
import { useFavorites } from "./favorites";
import { useKxUi } from "./ui-state";
import { useLatestSync, useLibraryCounts, useShareCount, useStats, relativeTime } from "./use-library";

/** LIBRARY group — label, route, and where its count comes from. */
const LIBRARY_ROWS = [
  { href: "/gallery", label: "All photos", count: "photos" as const },
  { href: "/people", label: "People", count: "people" as const },
  { href: "/animals", label: "Animals", count: "pets" as const },
  { href: "/vehicles", label: "Vehicles", count: "vehicles" as const },
  { href: "/videos", label: "Videos", count: "videos" as const },
  { href: "/timeline", label: "Timeline", count: null },
  { href: "/locations", label: "Locations", count: null },
  { href: "/shares", label: "Shared", count: "shares" as const },
  { href: "/favorites", label: "Favorites", count: "favorites" as const },
];

/**
 * WAYS IN group. The icon paths are the repo's own 24×24 outlines, lifted from
 * the previous topbar's MORE_EVERYONE / MORE_ADMIN lists so the two navs stay
 * in step.
 */
const WAYS_IN_ROWS = [
  { href: "/events", label: "Events", icon: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7" },
  { href: "/together", label: "Together", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75 M9 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { href: "/colors", label: "Colors", icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485" },
  { href: "/objects", label: "Objects", icon: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12" },
  { href: "/landmarks", label: "Landmarks", icon: "M3 21l1.65-3.8a9 9 0 1114.7 0L21 21 M12 3v1m0 16v1m8.66-13.5l-.87.5M4.21 7.5l-.87.5m17.32 5l-.87-.5M4.21 12.5l-.87-.5" },
  { href: "/duplicates", label: "Duplicates", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" },
];

function BrandLockup() {
  return (
    <Link href="/gallery" className="kx-brand" aria-label="Kindred, home">
      <img src="/logo.svg" alt="" className="kx-mark" data-mark-theme="light" />
      <img src="/logo-light.svg" alt="" className="kx-mark" data-mark-theme="dark" />
      <img src="/wordmark.svg" alt="Kindred" className="kx-wordmark" data-mark-theme="light" />
      <img src="/wordmark-light.svg" alt="Kindred" className="kx-wordmark" data-mark-theme="dark" />
    </Link>
  );
}

/**
 * Collapse and expand are the same control in the same place — under the logo
 * — so whichever state you are in, the way back is where you last left it.
 * It stays out of the way until the brand area is hovered or something inside
 * it takes focus: `opacity` alone, never `visibility`, so the button keeps its
 * place in the tab order and shows itself the moment it is focused.
 */
function RailToggle() {
  const { railCollapsed, toggleRail } = useKxUi();
  const label = railCollapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      className="kx-railtoggle"
      onClick={toggleRail}
      title={label}
      aria-label={label}
      aria-expanded={!railCollapsed}
      aria-controls="kx-sidebar"
    >
      <SidebarIcon direction={railCollapsed ? "right" : "left"} />
    </button>
  );
}

function SyncCard() {
  const { data: sync } = useLatestSync();
  const when = relativeTime(sync?.finished_at ?? sync?.started_at);
  const running = sync?.status === "running";
  const caption = !sync
    ? "No sync has run yet"
    : running
      ? `Scanning ${fmt.format(sync.total_photos || 0)} photos${when ? ` · started ${when}` : ""}`
      : `Flickr library up to date${when ? ` · ${when}` : ""}`;

  return (
    <div className="kx-sync">
      <span className="kx-sync-label">Sync</span>
      <span className="kx-sync-caption">{caption}</span>
      {/* The states reference hangs off the sync card, where someone already
          looking at whether the library is healthy will find it. */}
      <Link href="/states" className="kx-sync-link">
        Empty · loading · error
      </Link>
      <div className="kx-sync-bar">
        <span style={{ width: running ? "40%" : "100%" }} />
      </div>
    </div>
  );
}

export function KxSidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  const { data: counts } = useLibraryCounts();
  const { data: stats } = useStats();
  const { data: shares } = useShareCount();
  const { count: favorites } = useFavorites();

  const countFor = (key: (typeof LIBRARY_ROWS)[number]["count"]): number | null => {
    switch (key) {
      case "photos":
        return counts?.total_files ?? null;
      case "videos":
        return counts?.videos ?? null;
      case "shares":
        return shares ?? null;
      case "favorites":
        return favorites;
      case "people":
      case "pets":
      case "vehicles":
        return stats?.[key]?.groups ?? null;
      default:
        return null;
    }
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className={`kx-sidebar ${open ? "is-open" : ""}`} id="kx-sidebar">
      {/* The one part of the rail that survives collapsing. Everything below is
          hidden with `visibility` so it leaves the tab order with the pixels. */}
      <div className="kx-brandbar">
        <BrandLockup />
        <RailToggle />
      </div>

      <nav className="kx-navgroup" aria-label="Library">
        <span className="kx-eyebrow">Library</span>
        {LIBRARY_ROWS.map((row) => {
          const count = countFor(row.count);
          return (
            <Link
              key={row.href}
              href={row.href}
              className={`kx-navrow ${isActive(row.href) ? "is-active" : ""}`}
              aria-current={isActive(row.href) ? "page" : undefined}
              onClick={onNavigate}
            >
              <span>{row.label}</span>
              {count !== null && count > 0 && <span className="kx-navcount">{fmt.format(count)}</span>}
            </Link>
          );
        })}
      </nav>

      <nav className="kx-navgroup" aria-label="Ways in">
        <span className="kx-eyebrow">Ways in</span>
        {WAYS_IN_ROWS.map((row) => (
          <Link
            key={row.href}
            href={row.href}
            className={`kx-navrow with-icon ${isActive(row.href) ? "is-active" : ""}`}
            aria-current={isActive(row.href) ? "page" : undefined}
            onClick={onNavigate}
          >
            <NavIcon d={row.icon} />
            <span>{row.label}</span>
          </Link>
        ))}
      </nav>

      <SyncCard />
    </aside>
  );
}
