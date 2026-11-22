/**
 * Sidebar-collapse boot, kept out of the client module for the same reason the
 * theme boot is: the (main) layout is a server component, and a value imported
 * from a "use client" file reaches it as a client reference rather than the
 * string itself.
 */

/** Where the rail's collapsed state is remembered. Per browser profile. */
export const SIDEBAR_KEY = "kindred-sidebar";
export const SIDEBAR_WIDTH_KEY = "kindred-sidebar-width";
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_DEFAULT_WIDTH = 250;
export const SIDEBAR_MAX_WIDTH = 380;

/** The only two values ever written. Anything else is treated as expanded. */
export const SIDEBAR_COLLAPSED = "collapsed";
export const SIDEBAR_EXPANDED = "expanded";

/**
 * Runs before the shell paints so a rail that was left collapsed never snaps
 * open and back again on load. Same shape as the theme boot: synchronous,
 * inline, and it writes the attribute the CSS keys off rather than waiting for
 * React — which means the collapsed layout is correct on the very first frame
 * even though hydration has not happened yet.
 */
export const SIDEBAR_BOOT_SCRIPT = `(function () {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem(${JSON.stringify(SIDEBAR_KEY)});
    root.dataset.sidebar = saved === ${JSON.stringify(SIDEBAR_COLLAPSED)}
      ? ${JSON.stringify(SIDEBAR_COLLAPSED)} : ${JSON.stringify(SIDEBAR_EXPANDED)};
    const width = Number(localStorage.getItem(${JSON.stringify(SIDEBAR_WIDTH_KEY)}));
    if (width >= ${SIDEBAR_MIN_WIDTH} && width <= ${SIDEBAR_MAX_WIDTH}) {
      root.style.setProperty("--kindred-sidebar-width", Math.round(width) + "px");
    }
  } catch {
    root.dataset.sidebar = ${JSON.stringify(SIDEBAR_EXPANDED)};
  }
})();`;
