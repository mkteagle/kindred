"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_THEME, THEME_KEY } from "./theme-script";

export type Theme = "dark" | "light";

const FALLBACK = DEFAULT_THEME as Theme;

function readTheme(): Theme {
  if (typeof document === "undefined") return FALLBACK;
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : FALLBACK;
}

const THEME_CHANGE = "kindred-theme-change";

function subscribeToTheme(callback: () => void) {
  window.addEventListener(THEME_CHANGE, callback);
  return () => window.removeEventListener(THEME_CHANGE, callback);
}

/** Theme shared by the app shell and Appearance settings. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => FALLBACK);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    window.dispatchEvent(new Event(THEME_CHANGE));
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode — the session still switches, it just will not persist */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(readTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggle };
}
