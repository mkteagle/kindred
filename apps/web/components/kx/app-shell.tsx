"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@/types";
import { KxSidebar } from "./sidebar";
import { KxTopbar } from "./topbar";
import { KxUiProvider, useKxUi } from "./ui-state";

const API = "/api";

/** The library screen — the only one with tile zoom and multi-select. */
const LIBRARY_PATH = "/gallery";

/**
 * Routes that render without the shell: the auth screens have their own
 * full-page layouts, and the demo tour ships its own topbar.
 */
function isBareRoute(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/reset") ||
    pathname.startsWith("/demo")
  );
}

/** The grid, the chrome, and the shell-owned dialogs. */
function ShellFrame({ user, children }: { user: User | null; children: React.ReactNode }) {
  const { tile, loose, searchOpen, setSearchOpen, uploadOpen, setUploadOpen, exitSelect } = useKxUi();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

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

  // TODO(step 4/5): replace these route hops with the ⌘K overlay and the
  // upload dialog. The shell already owns both flags.
  useEffect(() => {
    if (searchOpen) {
      setSearchOpen(false);
      router.push("/search");
    }
  }, [searchOpen, setSearchOpen, router]);

  useEffect(() => {
    if (uploadOpen) {
      setUploadOpen(false);
      router.push("/upload");
    }
  }, [uploadOpen, setUploadOpen, router]);

  return (
    <div
      className="kx kx-shell"
      style={{ ["--tile" as string]: `${tile}px`, ["--gap" as string]: loose ? "12px" : "4px" }}
    >
      <KxSidebar open={drawerOpen} onNavigate={() => setDrawerOpen(false)} />
      {drawerOpen && (
        <button className="kx-drawer-scrim" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
      )}
      <div className="kx-content">
        <KxTopbar user={user} onOpenDrawer={() => setDrawerOpen(true)} />
        {children}
      </div>
    </div>
  );
}

export function KxAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: user } = useQuery<User>({
    queryKey: ["auth-me"],
    queryFn: () => fetch(`${API}/auth/me`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  if (isBareRoute(pathname)) return <>{children}</>;

  return (
    <KxUiProvider isLibrary={pathname === LIBRARY_PATH}>
      <ShellFrame user={user?.loggedIn ? user : null}>{children}</ShellFrame>
    </KxUiProvider>
  );
}
