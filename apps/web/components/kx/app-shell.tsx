"use client";

import { SyncProgress } from "@/components/sync-progress";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@/lib/use-user";
import type { User } from "@/types";
import { KxSearchOverlay } from "./search-overlay";
import { KxSidebar } from "./sidebar";
import { KxTopbar } from "./topbar";
import { KxUiProvider, useKxUi } from "./ui-state";
import { KxUploadDialog } from "./upload-dialog";
import { LiveLibraryUpdates } from "./live-library-updates";

const API = "/api";

/** The library screen — the only one with tile zoom and multi-select. */
const LIBRARY_PATH = "/gallery";

/**
 * Routes that render without the shell: the auth screens have their own
 * full-page layouts, and the demo tour ships its own topbar.
 */
function isBareRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/reset") ||
    pathname.startsWith("/demo")
  );
}

/** The grid, the chrome, and the shell-owned dialogs. */
function ShellFrame({ user, children }: { user: User | null; children: React.ReactNode }) {
  const { tile, loose, railCollapsed, searchOpen, setSearchOpen, uploadOpen, setUploadOpen, exitSelect } = useKxUi();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // ⌘/Ctrl+K from anywhere; Esc leaves select mode and closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "Escape") {
        setDrawerOpen(false);
        exitSelect();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setSearchOpen, exitSelect]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const mobile = window.matchMedia("(width <= 640px)");
    const closeDrawer = () => { if (!mobile.matches) setDrawerOpen(false); };
    mobile.addEventListener("change", closeDrawer);
    return () => mobile.removeEventListener("change", closeDrawer);
  }, []);

  return (
    <div
      className={`kx kx-shell${railCollapsed ? " is-compact" : ""}`}
      style={{ ["--tile" as string]: `${tile}px`, ["--gap" as string]: loose ? "12px" : "8px" }}
    >
      <LiveLibraryUpdates enabled={!!user?.loggedIn} />
      <KxSidebar user={user} open={drawerOpen} onNavigate={() => setDrawerOpen(false)} />
      {drawerOpen && (
        <button className="kx-drawer-scrim" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
      )}
      <div className="kx-content">
        <KxTopbar user={user} drawerOpen={drawerOpen} onOpenDrawer={() => setDrawerOpen(true)} />
        <SyncProgress />
        {children}
      </div>
      <KxSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      {uploadOpen && <KxUploadDialog onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

export function KxAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();

  if (isBareRoute(pathname)) return <>{children}</>;

  return (
    <KxUiProvider isLibrary={pathname === LIBRARY_PATH || pathname === "/timeline"}>
      <ShellFrame user={user?.loggedIn ? user : null}>{children}</ShellFrame>
    </KxUiProvider>
  );
}
