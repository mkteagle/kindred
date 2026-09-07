"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_THEME, THEME_KEY } from "./theme-script";

export type Theme = "dark" | "light";

const FALLBACK = DEFAULT_THEME as Theme;

function readTheme(): Theme {
  if (typeof document === "undefined") return FALLBACK;
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : FALLBACK;
}

/**
 * The current theme plus a toggle. State is mirrored on <html data-theme>,
 * which is what the token blocks in globals.css key off, and persisted to
 * localStorage. The boot script has already set the attribute, so the first
 * client render agrees with the server-rendered markup.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(FALLBACK);

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
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
