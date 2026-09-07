"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { SIDEBAR_COLLAPSED, SIDEBAR_EXPANDED, SIDEBAR_KEY } from "./sidebar-script";

/** Grid zoom bounds from the spec: 105–360px in 45px steps. */
export const TILE_MIN = 105;
export const TILE_MAX = 360;
export const TILE_STEP = 45;
export const TILE_DEFAULT = 190;
const TILE_KEY = "kindred-tile";

export interface KxUiValue {
  /** Mosaic tile size in px, written to the shell as `--tile`. */
  tile: number;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Tight (4px) or loose (12px) mosaic gap, written as `--gap`. */
  loose: boolean;
  setLoose: (loose: boolean) => void;
  /** Multi-select mode on the library mosaic. */
  selecting: boolean;
  setSelecting: (on: boolean) => void;
  selected: ReadonlySet<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleSelected: (id: string) => void;
  /** Leaves select mode and drops the set. */
  exitSelect: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;
  /**
   * Desktop only: the rail is collapsed to its logo. Mirrored on
   * <html data-sidebar>, which is what the CSS keys off — below 900px the
   * sidebar is a drawer and this is ignored.
   */
  railCollapsed: boolean;
  toggleRail: () => void;
  /** True on the library screen, which is the only one with zoom and select. */
  isLibrary: boolean;
}

const KxUiContext = createContext<KxUiValue | null>(null);

export function useKxUi(): KxUiValue {
  const value = useContext(KxUiContext);
  if (!value) throw new Error("useKxUi must be used inside the Kindred app shell");
  return value;
}

export function KxUiProvider({
  isLibrary,
  children,
}: {
  isLibrary: boolean;
  children: React.ReactNode;
}) {
  const [tile, setTile] = useState(TILE_DEFAULT);
  const [loose, setLoose] = useState(false);
  const [selecting, setSelectingState] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  // Restored after mount so the server and first client render agree.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(TILE_KEY));
      if (saved >= TILE_MIN && saved <= TILE_MAX) setTile(saved);
    } catch {
      /* private mode */
    }
  }, []);

  // The boot script has already written <html data-sidebar> from localStorage,
  // so the rail is painted in the right shape before React runs; all this does
  // is bring the component state into line with what is already on screen.
  useEffect(() => {
    setRailCollapsed(document.documentElement.getAttribute("data-sidebar") === SIDEBAR_COLLAPSED);
  }, []);

  const toggleRail = useCallback(() => {
    const next = document.documentElement.getAttribute("data-sidebar") !== SIDEBAR_COLLAPSED;
    setRailCollapsed(next);
    document.documentElement.setAttribute("data-sidebar", next ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED);
    } catch {
      /* private mode — the rail still moves, it just will not persist */
    }
  }, []);

  const step = useCallback((delta: number) => {
    setTile((current) => {
      const next = Math.min(TILE_MAX, Math.max(TILE_MIN, current + delta));
      try {
        localStorage.setItem(TILE_KEY, String(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelectingState(false);
    setSelected(new Set());
  }, []);

  const setSelecting = useCallback(
    (on: boolean) => {
      setSelectingState(on);
      if (!on) setSelected(new Set());
    },
    [],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Selection belongs to the library mosaic; leaving the screen drops it.
  useEffect(() => {
    if (!isLibrary) exitSelect();
  }, [isLibrary, exitSelect]);

  const value = useMemo<KxUiValue>(
    () => ({
      tile,
      zoomIn: () => step(TILE_STEP),
      zoomOut: () => step(-TILE_STEP),
      loose,
      setLoose,
      selecting,
      setSelecting,
      selected,
      setSelected,
      toggleSelected,
      exitSelect,
      searchOpen,
      setSearchOpen,
      uploadOpen,
      setUploadOpen,
      railCollapsed,
      toggleRail,
      isLibrary,
    }),
    [
      tile,
      step,
      loose,
      selecting,
      setSelecting,
      selected,
      toggleSelected,
      exitSelect,
      searchOpen,
      uploadOpen,
      railCollapsed,
      toggleRail,
      isLibrary,
    ],
  );

  return <KxUiContext.Provider value={value}>{children}</KxUiContext.Provider>;
}
