"use client";

import type { User } from "@/types";
import { MenuIcon, SearchIcon, ZoomInIcon, ZoomOutIcon } from "./icons";
import { useTheme } from "./theme";
import { useKxUi, TILE_MAX, TILE_MIN } from "./ui-state";
import { KxUserMenu } from "./user-menu";

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  // The label names the theme you would switch to, not the one you are in.
  const next = theme === "dark" ? "Light" : "Dark";
  return (
    <button className="kx-themetoggle" onClick={toggle} title="Light or dark" aria-label={`Switch to ${next.toLowerCase()} theme`}>
      {next}
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
