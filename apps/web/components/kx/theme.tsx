"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

/** Where the choice is remembered. Per browser profile, which is per user. */
export const THEME_KEY = "kindred-theme";
const DEFAULT_THEME: Theme = "dark";

/**
 * Runs before the shell paints so the page never flashes the wrong ground.
 * Rendered as a plain inline script by the (main) layout — it has to be
 * synchronous, which rules out doing this from an effect.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(t!=="light"&&t!=="dark")t=${JSON.stringify(
  DEFAULT_THEME,
)};document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme",${JSON.stringify(
  DEFAULT_THEME,
)});}})();`;

function readTheme(): Theme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : DEFAULT_THEME;
}

/**
 * The current theme plus a toggle. State is mirrored on <html data-theme>,
 * which is what the token blocks in globals.css key off, and persisted to
 * localStorage. The boot script has already set the attribute, so the first
 * client render agrees with the server-rendered markup.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

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
