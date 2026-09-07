"use client";

import type { User } from "@/types";
import { MenuIcon, MoonIcon, SearchIcon, SunIcon, ZoomInIcon, ZoomOutIcon } from "./icons";
import { useTheme } from "./theme";
import { useKxUi, TILE_MAX, TILE_MIN } from "./ui-state";
import { KxUserMenu } from "./user-menu";

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
  onOpenDrawer,
}: {
  user: User | null;
  onOpenDrawer: () => void;
}) {
  const { tile, zoomIn, zoomOut, selecting, setSelecting, isLibrary, setSearchOpen, setUploadOpen } = useKxUi();

  return (
    <header className="kx-topbar">
      <button
        className="kx-iconbutton kx-drawer-toggle"
        onClick={onOpenDrawer}
        aria-label="Open navigation"
        aria-controls="kx-sidebar"
      >
        <MenuIcon />
      </button>

      <button className="kx-searchtrigger" onClick={() => setSearchOpen(true)} aria-label="Search photos">
        <SearchIcon size={17} />
        <span>Search the way you remember it</span>
        <kbd className="kx-kbd">⌘K</kbd>
      </button>

      <div className="kx-topbar-actions">
        <ThemeToggle />

        {isLibrary && (
          <>
            <button
              className="kx-iconbutton"
              onClick={zoomOut}
              disabled={tile <= TILE_MIN}
              title="Smaller tiles"
              aria-label="Smaller tiles"
            >
              <ZoomOutIcon />
            </button>
            <button
              className="kx-iconbutton"
              onClick={zoomIn}
              disabled={tile >= TILE_MAX}
              title="Bigger tiles"
              aria-label="Bigger tiles"
            >
              <ZoomInIcon />
            </button>
            <button
              className="kx-button"
              onClick={() => setSelecting(!selecting)}
              aria-pressed={selecting}
            >
              {selecting ? "Cancel" : "Select"}
            </button>
          </>
        )}

        <button className="kx-button primary" onClick={() => setUploadOpen(true)}>
          Upload
        </button>

        <KxUserMenu user={user} />
      </div>
    </header>
  );
}
