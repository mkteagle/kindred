"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@/types";
import { KxUserMenu, displayNameOf } from "./user-menu";
import { useStorageStatus } from "./use-library";
import { BrandMark, BrandWordmark } from "@/components/brand-mark";
import { LIBRARY_ICON_PATHS, NavIcon, SidebarIcon } from "./icons";
import { useKxUi } from "./ui-state";

const LIBRARY_ROWS = [
  { href: "/gallery", label: "Library", icon: LIBRARY_ICON_PATHS.allPhotos },
  { href: "/search", label: "Search", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
  { href: "/people", label: "People", icon: LIBRARY_ICON_PATHS.people },
  { href: "/albums", label: "Albums", icon: "M3 7h7l2 2h9v11H3z M3 7V4h7l2 3" },
  { href: "/favorites", label: "Favorites", icon: LIBRARY_ICON_PATHS.favorites },
  { href: "/videos", label: "Videos", icon: LIBRARY_ICON_PATHS.videos },
  { href: "/settings", label: "Settings", icon: "M4 6h16M4 12h16M4 18h16 M9 4v4m6 2v4m-6 2v4" },
];

const WAYS_IN_ROWS = [
  { href: "/timeline", label: "Timeline", icon: LIBRARY_ICON_PATHS.timeline },
  { href: "/animals", label: "Animals", icon: LIBRARY_ICON_PATHS.animals },
  { href: "/vehicles", label: "Vehicles", icon: LIBRARY_ICON_PATHS.vehicles },
  { href: "/locations", label: "Locations", icon: LIBRARY_ICON_PATHS.locations },
  { href: "/shares", label: "Shared", icon: LIBRARY_ICON_PATHS.shared },
  { href: "/activity", label: "Activity", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  { href: "/events", label: "Events", icon: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7" },
  { href: "/together", label: "Together", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75 M9 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { href: "/colors", label: "Colors", icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485" },
  { href: "/objects", label: "Objects", icon: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12" },
  { href: "/landmarks", label: "Landmarks", icon: "M3 21l1.65-3.8a9 9 0 1114.7 0L21 21 M12 3v1m0 16v1m8.66-13.5l-.87.5M4.21 7.5l-.87.5m17.32 5l-.87-.5M4.21 12.5l-.87-.5" },
  { href: "/duplicates", label: "Duplicates", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" },
];

/** Where the rail tooltip should be drawn, in viewport coordinates. */
interface RailTip {
  label: string;
  top: number;
  left: number;
}

function BrandLockup() {
  return (
    <Link href="/gallery" className="kx-brand" aria-label="Kindred, home" prefetch={false}>
      <span className="kx-brand-mark"><BrandMark size={36} className="kx-mark" /></span>
      <span className="kx-brand-word"><BrandWordmark className="kx-wordmark" alt="" /></span>
    </Link>
  );
}

function RailToggle() {
  const { railCollapsed, toggleRail } = useKxUi();
  const label = railCollapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      className="kx-railtoggle"
      onClick={toggleRail}
      aria-label={label}
      aria-expanded={!railCollapsed}
      aria-controls="kx-sidebar"
    >
      <span className="kx-railtoggle-brand" aria-hidden="true">
        <BrandMark size={36} className="kx-mark" />
      </span>
      <span className="kx-railtoggle-glyph" aria-hidden="true">
        <SidebarIcon direction={railCollapsed ? "right" : "left"} />
      </span>
    </button>
  );
}

function NavRow({
  href,
  label,
  icon,
  active,
  wide,
  collapsed,
  onNavigate,
  onShowTip,
  onHideTip,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  /** WAYS IN rows sit a shade lighter than LIBRARY rows, per the handoff. */
  wide: boolean;
  collapsed: boolean;
  onNavigate: () => void;
  onShowTip: (label: string, el: HTMLElement) => void;
  onHideTip: () => void;
}) {
  const ref = useRef<HTMLAnchorElement | null>(null);

  const reveal = useCallback(() => {
    if (collapsed && ref.current) onShowTip(label, ref.current);
  }, [collapsed, label, onShowTip]);

  // Focus only counts when the browser would have drawn a ring for it, so a
  // mouse click on a row does not leave its tooltip hanging after the pointer
  // has gone.
  const revealOnFocus = useCallback(() => {
    if (ref.current?.matches(":focus-visible")) reveal();
  }, [reveal]);

  return (
    <Link
      ref={ref}
      href={href}
      // The rail is on every screen, so viewport prefetching pulls the whole
      // app down on every load -- twenty-odd routes, several requests each,
      // ahead of the data the page actually needs. Next still prefetches on
      // hover, which is the intent that matters.
      prefetch={false}
      className={`kx-navrow ${wide ? "with-icon" : ""} ${active ? "is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onPointerEnter={reveal}
      onPointerLeave={onHideTip}
      onFocus={revealOnFocus}
      onBlur={onHideTip}
      onClick={() => {
        onHideTip();
        onNavigate();
      }}
    >
      <NavIcon d={icon} />
      <span className="kx-navlabel">{label}</span>

    </Link>
  );
}

export function KxSidebar({ user, open, onNavigate }: { user: User | null; open: boolean; onNavigate: () => void }) {
  const { data: storage } = useStorageStatus(false);
  const pathname = usePathname();
  const { railCollapsed } = useKxUi();
  const [tip, setTip] = useState<RailTip | null>(null);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`) ||
    (href === "/settings" && pathname === "/storage");

  const hideTip = useCallback(() => setTip(null), []);

  // Measured off the row itself rather than assumed from the 64px rail, so the
  // tooltip stays put if the rail's metrics ever change.
  const showTip = useCallback((label: string, el: HTMLElement) => {
    if (!window.matchMedia("(width > 640px)").matches) return;
    const rect = el.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
  }, []);

  // Expanding the rail (or opening the drawer) has to take the tooltip with it.
  useEffect(() => {
    setTip(null);
  }, [railCollapsed, open, pathname]);

  return (
    <aside
      className={`kx-sidebar ${open ? "is-open" : ""}`}
      id="kx-sidebar"
      onScroll={hideTip}
    >
      <div className="kx-brandbar">
        <BrandLockup />
        <RailToggle />
      </div>

      <div className="kx-sidebar-scroll">
      <nav className="kx-navgroup" aria-label="Library">
        {LIBRARY_ROWS.map((row) => (
          <NavRow
            key={row.href}
            href={row.href}
            label={row.label}
            icon={row.icon}
            active={isActive(row.href)}
            wide={false}
            collapsed={railCollapsed}
            onNavigate={onNavigate}
            onShowTip={showTip}
            onHideTip={hideTip}
          />
        ))}
      </nav>

      <details className="kx-more-nav" open={WAYS_IN_ROWS.some(row => isActive(row.href)) || undefined}>
      <summary>Explore more</summary>
      <nav className="kx-navgroup" aria-label="Explore more">
        {WAYS_IN_ROWS.map((row) => (
          <NavRow
            key={row.href}
            href={row.href}
            label={row.label}
            icon={row.icon}
            active={isActive(row.href)}
            wide
            collapsed={railCollapsed}
            onNavigate={onNavigate}
            onShowTip={showTip}
            onHideTip={hideTip}
          />
        ))}
      </nav>

      </details>
      </div>
      <div className="kx-sidebar-account">
        <div className="kx-account-row"><KxUserMenu user={user} placement="sidebar" />
          <div className="kx-account-copy"><strong>{storage?.household_name || "Household"}</strong>
            {user && <span>{displayNameOf(user)}</span>}
          </div>
        </div>
      </div>

      {/* Not a `title`: that waits half a second, cannot be styled, and never
          appears for keyboard focus. It is `position: fixed` so the rail's own
          overflow cannot clip it, and `aria-hidden` because the row it names
          already carries that name as its own `aria-label`. */}
      {tip && (
        <div className="kx-navtip" style={{ top: tip.top, left: tip.left }} aria-hidden="true">
          {tip.label}
        </div>
      )}
    </aside>
  );
}
