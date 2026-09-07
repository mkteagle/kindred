/**
 * Theme boot, kept out of the client module on purpose: the (main) layout is a
 * server component, and a value imported from a "use client" file reaches it as
 * a client reference rather than the string itself.
 */

/** Where the choice is remembered. Per browser profile, which is per user. */
export const THEME_KEY = "kindred-theme";

export const DEFAULT_THEME = "dark";

/**
 * Runs before the shell paints so the page never flashes the wrong ground.
 * Rendered as a plain inline script — it has to be synchronous, which rules
 * out doing this from an effect.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(t!=="light"&&t!=="dark")t=${JSON.stringify(
  DEFAULT_THEME,
)};document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme",${JSON.stringify(
  DEFAULT_THEME,
)});}})();`;
