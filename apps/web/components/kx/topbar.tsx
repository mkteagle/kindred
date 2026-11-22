"use client";

import { usePathname } from "next/navigation";
import type { Ref } from "react";
import type { User } from "@/types";
import { MenuIcon, MoonIcon, SearchIcon, SunIcon } from "./icons";
import { useTheme } from "./theme";
import { useKxUi } from "./ui-state";
import { KxUserMenu } from "./user-menu";
import { useKxSearch } from "./search-state";

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  // The glyph shows the theme you would switch to, not the one you are in — a
  // sun offers daylight. With no text label the button needs an explicit name.
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="kx-iconbtn kx-themetoggle"
      onClick={toggle}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export function KxTopbar({
  user,
  drawerOpen,
  drawerTrigger,
  onOpenDrawer,
}: {
  user: User | null;
  drawerOpen: boolean;
  drawerTrigger: Ref<HTMLButtonElement>;
  onOpenDrawer: () => void;
}) {
  const pathname = usePathname();
  const { setSearchOpen, setUploadOpen } = useKxUi();
  const pageOwnsHeader = ["/gallery", "/gallery/junk", "/people", "/search", "/timeline", "/settings"].includes(pathname)
    || pathname.startsWith("/settings/") || pathname.startsWith("/albums/");
  const { query } = useKxSearch();
  const term = query.trim();

  return (
    <header className={`kx-topbar${pageOwnsHeader ? " kx-drawer-bar" : ""}`}>
      <button
        ref={drawerTrigger}
        type="button"
        className="kx-iconbutton kx-drawer-toggle"
        onClick={onOpenDrawer}
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        aria-controls="kx-sidebar"
      >
        <MenuIcon />
      </button>

      {!pageOwnsHeader && <><button className={`kx-searchtrigger${term ? " has-query" : ""}`} onClick={() => setSearchOpen(true)} aria-label={term ? `Search photos for ${term}` : "Search photos"}>
        <SearchIcon size={17} />
        <span>{term || "Search people, places, moments…"}</span>
        <kbd className="kx-kbd">⌘K</kbd>
      </button>

      <div className="kx-topbar-actions">
        <ThemeToggle />

        <button className="kx-button primary" onClick={() => setUploadOpen(true)}>
          Add photos
        </button>

      </div></>}
      <span className="kx-mobile-account"><KxUserMenu user={user} /></span>
    </header>
  );
}
