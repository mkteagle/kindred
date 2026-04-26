"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Spinner } from "@/components/ui";
import type { User, SyncLog, Stats, SearchResult } from "@/types";
import { BACKEND, CATEGORIES, fmt, toBackendCategory } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

const API = "/api";

/* "More" dropdown items — everyone section */
const MORE_EVERYONE = [
  { href: "/events", label: "Events", icon: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7" },
  { href: "/together", label: "Together", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75 M9 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { href: "/colors", label: "Colors", icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485" },
  { href: "/objects", label: "Objects", icon: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12" },
  { href: "/landmarks", label: "Landmarks", icon: "M3 21l1.65-3.8a9 9 0 1114.7 0L21 21 M12 3v1m0 16v1m8.66-13.5l-.87.5M4.21 7.5l-.87.5m17.32 5l-.87-.5M4.21 12.5l-.87-.5" },
];
/* "More" dropdown items — admin-only section */
const MORE_ADMIN = [
  { href: "/duplicates", label: "Duplicates", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" },
];

/* Backward compat — used by old isExploreActive check */
const ALL_MORE_PATHS = [...MORE_EVERYONE, ...MORE_ADMIN].map((l) => l.href);

function NavIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d.split(" M").map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </svg>
  );
}

export function Topbar() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const qc = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/auth/me`)
      .then((r) => r.json())
      .then((d: User) => { if (d.loggedIn) setUser(d); setAuthLoading(false); })
      .catch(() => setAuthLoading(false));
  }, []);

  const pathname = usePathname();
  if (pathname === "/login" || pathname.startsWith("/join") || pathname.startsWith("/reset")) return null;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+K for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const { data: syncs } = useQuery<SyncLog[]>({
    queryKey: ["syncs"],
    queryFn: () => fetch(`${BACKEND}/syncs`).then((r) => r.json()),
    refetchInterval: 60000,
  });
  const { data: stats } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: () => fetch(`${BACKEND}/stats`).then((r) => r.json()),
  });

  interface ActiveJobData { job_id: string | null; status: string; progress?: number; total?: number; message?: string; counts?: { people: number; pets: number; vehicles: number } }
  const { data: activeJob } = useQuery<ActiveJobData>({
    queryKey: ["active-job"],
    queryFn: () => fetch(`${BACKEND}/jobs/active`).then((r) => r.json()),
    refetchInterval: (query) => query.state.data?.status === "running" ? 5000 : 60000,
  });

  const lastSync = syncs?.[0];

  interface NotifItem { id: number; type: string; title: string; message: string; metadata: Record<string, unknown>; read: boolean; created_at: string }
  interface NotifData { notifications: NotifItem[]; unread_count: number }
  const { data: notifData } = useQuery<NotifData>({
    queryKey: ["notifications"],
    queryFn: () => fetch(`${BACKEND}/notifications?limit=10`).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const markAllRead = async () => {
    await fetch(`${BACKEND}/notifications/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const [signOutOpen, setSignOutOpen] = useState(false);
  const signOutRef = useRef<HTMLDialogElement>(null);

  const openSignOut = () => {
    setSignOutOpen(true);
    setUserMenuOpen(false);
  };
  const closeSignOut = () => {
    setSignOutOpen(false);
    signOutRef.current?.close();
  };
  const confirmSignOut = async () => {
    await fetch(`${API}/auth/logout`, { method: "POST" });
    window.location.href = "/login";
  };

  useEffect(() => {
    if (signOutOpen && signOutRef.current && !signOutRef.current.open) {
      signOutRef.current.showModal();
    }
  }, [signOutOpen]);

  const startScan = async () => {
    setScanning(true);
    setUserMenuOpen(false);
    try {
      const resp = await fetch(`${API}/flickr/user/me/photos?all=true`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const photos = data.photos || [];
      if (!photos.length) { setScanning(false); return; }
      await fetch(`${API}/flickr/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos }),
      });
      // Immediately trigger sync progress bar to pick up the new job
      qc.invalidateQueries({ queryKey: ["active-job"] });
    } catch (e) {
      console.error("Scan failed:", e);
    }
    setScanning(false);
  };
  const [qrOpen, setQrOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const isMoreActive = ALL_MORE_PATHS.some((p) => pathname === p);
  const effectiveRole = user?.role || "member";
  // "View as member" support
  const viewingAsMember = typeof window !== "undefined" && effectiveRole === "admin" && (() => { try { return sessionStorage.getItem("viewAsRole") === "member"; } catch { return false; } })();
  const uiRole = viewingAsMember ? "member" : effectiveRole;

  if (authLoading) {
    return <header className="nb"><div className="nb-inner"><Spinner /></div></header>;
  }

  return (
    <>
      <header className="nb">
        <div className="nb-inner">
          {/* Brand */}
          <Link href="/" className="nb-brand">
            <img src="/kindred-wordmark.svg" alt="Kindred" className="nb-logo" />
          </Link>

          {/* Primary nav — only when library is connected */}
          {user && (
            <nav className="nb-nav" role="navigation">
              {CATEGORIES.map((cat) => {
                const active = pathname === `/${cat.id}` || pathname.startsWith(`/${cat.id}/`);
                const count = stats?.[toBackendCategory(cat.id)]?.groups || 0;
                return (
                  <Link key={cat.id} href={`/${cat.id}`} className={`nb-link ${active ? "is-active" : ""}`}>
                    {cat.label}
                    {count > 0 && <span className="nb-badge">{fmt.format(count)}</span>}
                  </Link>
                );
              })}

              {/* Timeline — promoted to top level */}
              <Link href="/timeline" className={`nb-link ${pathname === "/timeline" ? "is-active" : ""}`}>
                Timeline
              </Link>

              {/* Locations — promoted to top level */}
              <Link href="/locations" className={`nb-link ${pathname === "/locations" || pathname.startsWith("/locations/") ? "is-active" : ""}`}>
                Locations
              </Link>

              {/* More dropdown — replaces Explore */}
              <div className="nb-dropdown" ref={moreRef}>
                <button
                  className={`nb-link ${isMoreActive ? "is-active" : ""}`}
                  onClick={() => { setMoreOpen(!moreOpen); setUserMenuOpen(false); }}
                >
                  More
                  <svg className="nb-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: moreOpen ? "rotate(180deg)" : undefined }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {moreOpen && (
                  <div className="nb-popover">
                    <div className="nb-popover-grid">
                      {MORE_EVERYONE.map((link) => (
                        <Link key={link.href} href={link.href}
                          className={`nb-popover-item ${pathname === link.href ? "is-active" : ""}`}
                          onClick={() => setMoreOpen(false)}>
                          <span className="nb-popover-icon"><NavIcon d={link.icon} size={20} /></span>
                          <span>{link.label}</span>
                        </Link>
                      ))}
                      {uiRole === "admin" && (
                        <>
                          <div className="nb-popover-divider" />
                          <div className="nb-popover-section-label">ADMIN</div>
                          {MORE_ADMIN.map((link) => (
                            <Link key={link.href} href={link.href}
                              className={`nb-popover-item ${pathname === link.href ? "is-active" : ""}`}
                              onClick={() => setMoreOpen(false)}>
                              <span className="nb-popover-icon"><NavIcon d={link.icon} size={20} /></span>
                              <span>{link.label}</span>
                            </Link>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </nav>
          )}

          {/* Right actions */}
          <div className="nb-actions">
            {/* Admin tray — only for admins */}
            {user && uiRole === "admin" && (
              <div className="nb-admin-tray">
                <span className="nb-admin-label">ADMIN</span>
                <Link href="/upload" className="nb-admin-icon" aria-label="Upload photos" title="Upload photos">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </Link>
                <button className="nb-admin-icon" onClick={startScan} disabled={scanning} aria-label="Scan photos" title={scanning ? "Scanning..." : "Scan new photos"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={scanning ? { animation: "spin 1s linear infinite" } : undefined}>
                    <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                  </svg>
                </button>
              </div>
            )}

            {/* Divider between admin tray and everyone actions */}
            {user && uiRole === "admin" && <span className="nb-divider" />}

            {/* Notifications — only when connected */}
            {user && <div className="nb-dropdown" ref={notifRef}>
              <button className="nb-icon-btn" aria-label="Notifications"
                onClick={() => { setNotifOpen(!notifOpen); setUserMenuOpen(false); setMoreOpen(false); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
                </svg>
                {(notifData?.unread_count ?? 0) > 0 && (
                  <span className="nb-notif-badge">{(notifData?.unread_count ?? 0) > 9 ? "9+" : notifData?.unread_count}</span>
                )}
                {activeJob?.status === "running" && !(notifData?.unread_count) && <span className="nb-notif-dot" />}
              </button>
              {notifOpen && (
                <div className="nb-popover nb-popover-right nb-notif-panel">
                  <div className="nb-notif-header">
                    <strong>Notifications</strong>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {(notifData?.unread_count ?? 0) > 0 && (
                        <button className="nb-notif-markread" onClick={markAllRead}>Mark all read</button>
                      )}
                      <Link href="/sync" onClick={() => setNotifOpen(false)} className="nb-notif-viewall">
                        Sync history
                      </Link>
                    </div>
                  </div>
                  <div className="nb-popover-divider" />

                  {/* Active scan */}
                  {activeJob?.status === "running" && activeJob.total && (
                    <div className="nb-notif-item nb-notif-active">
                      <div className="nb-notif-icon nb-notif-icon-running">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                        </svg>
                      </div>
                      <div className="nb-notif-body">
                        <span className="nb-notif-title">Scanning photos...</span>
                        <span className="nb-notif-desc">
                          {fmt.format(activeJob.progress || 0)}/{fmt.format(activeJob.total)} &mdash;
                          {activeJob.counts && ` ${fmt.format(activeJob.counts.people)} faces`}
                        </span>
                        <div className="nb-notif-bar">
                          <div style={{ width: `${Math.round(((activeJob.progress || 0) / activeJob.total) * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Real notifications */}
                  {(notifData?.notifications || []).map((n: NotifItem) => (
                    <div key={n.id} className={`nb-notif-item ${!n.read ? "nb-notif-unread" : ""}`}>
                      <div className={`nb-notif-icon ${
                        n.type === "scan_complete" ? "nb-notif-icon-done" :
                        n.type === "photos_deleted" ? "nb-notif-icon-error" :
                        "nb-notif-icon-done"
                      }`}>
                        {n.type === "scan_complete" ? "✓" :
                         n.type === "photos_deleted" ? "✕" :
                         n.type === "photo_processed" ? "+" : "•"}
                      </div>
                      <div className="nb-notif-body">
                        <span className="nb-notif-title">{n.title}</span>
                        <span className="nb-notif-desc">
                          {n.message}
                          {n.created_at && ` · ${new Date(n.created_at).toLocaleDateString()}`}
                        </span>
                      </div>
                    </div>
                  ))}

                  {(!notifData?.notifications?.length) && activeJob?.status !== "running" && (
                    <div className="nb-notif-empty">No notifications yet</div>
                  )}
                </div>
              )}
            </div>}

            {/* Search trigger — only when connected */}
            {user && (
              <button className="nb-icon-btn" onClick={() => setSearchOpen(true)}
                aria-label="Search photos" title="Search (Cmd+K)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </button>
            )}

            {/* User avatar */}
            {user ? (
              <div className="nb-dropdown" ref={userRef}>
                <button
                  className="nb-avatar"
                  style={{ background: uiRole === "admin" ? "linear-gradient(135deg,#c9551c,#e9b85d)" : "linear-gradient(135deg,#2f4a36,#4a6b4f)" }}
                  onClick={() => { setUserMenuOpen(!userMenuOpen); setMoreOpen(false); }}>
                  {(user.display_name || user.fullname || user.username || "?").charAt(0).toUpperCase()}
                </button>
                {userMenuOpen && (
                  <div className="nb-popover nb-popover-right" style={{ minWidth: 220 }}>
                    <div className="nb-user-header">
                      <div className="nb-avatar nb-avatar-lg" style={{ background: uiRole === "admin" ? "linear-gradient(135deg,#c9551c,#e9b85d)" : "linear-gradient(135deg,#2f4a36,#4a6b4f)" }}>
                        {(user.display_name || user.fullname || user.username || "?").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <strong>{user.display_name || user.fullname || user.username}</strong>
                        <span>@{user.username}</span>
                      </div>
                    </div>
                    <div className="nb-popover-divider" />
                    <Link href="/settings" className="nb-popover-action" onClick={() => setUserMenuOpen(false)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                      Account settings
                    </Link>
                    {user.role === "admin" && (
                      <button className="nb-popover-action" onClick={() => { setQrOpen(true); setUserMenuOpen(false); }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/>
                          <rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="4" height="4"/>
                          <line x1="22" y1="14" x2="22" y2="18"/><line x1="18" y1="22" x2="22" y2="22"/>
                        </svg>
                        Mobile setup
                      </button>
                    )}
                    {/* View as member toggle — admin only */}
                    {user.role === "admin" && (
                      <>
                        <div className="nb-popover-divider" />
                        <button className="nb-popover-action" onClick={() => {
                          try {
                            const current = sessionStorage.getItem("viewAsRole");
                            if (current === "member") { sessionStorage.removeItem("viewAsRole"); }
                            else { sessionStorage.setItem("viewAsRole", "member"); }
                            window.location.reload();
                          } catch { /* no-op */ }
                        }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>
                          </svg>
                          {viewingAsMember ? "Back to admin view" : "View as member"}
                        </button>
                      </>
                    )}
                    <div className="nb-popover-divider" />
                    <button className="nb-popover-action" onClick={openSignOut}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                        <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                      </svg>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link href={`${API}/auth/flickr`} className="nb-connect">Connect library</Link>
            )}
          </div>
        </div>
      </header>

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
      {qrOpen && <MobileSetupDialog onClose={() => setQrOpen(false)} />}

      {/* Sign-out confirmation dialog */}
      {signOutOpen && (
        <dialog
          ref={signOutRef}
          className="signout-confirm"
          onClose={closeSignOut}
          onClick={(e) => { if (e.target === e.currentTarget) closeSignOut(); }}
        >
          <div className="signout-body">
            <div className="signout-avatar">
              {user?.display_name?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || "?"}
            </div>
            <h3>Sign out, <strong>{user?.display_name?.split(" ")[0] || user?.username || "there"}</strong>?</h3>
            <p>You&apos;ll need your password to sign back in. Pending uploads will be saved on this device.</p>
          </div>
          <div className="signout-actions">
            <button className="button ghost" onClick={closeSignOut}>Stay signed in</button>
            <button className="button dark" onClick={confirmSignOut}>Sign out</button>
          </div>
        </dialog>
      )}
    </>
  );
}

/* ── Mobile Setup QR Dialog ────────────────────────────────────────── */

function MobileSetupDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [backendUrl, setBackendUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
    // Fetch the backend URL from the app-config endpoint
    fetch(`${BACKEND}/app-config`)
      .then((r) => r.json())
      .then((cfg) => {
        // The actual backend URL is the origin we're proxying to — use window location as the base
        setBackendUrl(cfg.backend_url || window.location.origin);
        setLoaded(true);
      })
      .catch(() => {
        setBackendUrl(window.location.origin);
        setLoaded(true);
      });
  }, []);

  const configPayload = JSON.stringify({
    kindred: true,
    url: backendUrl,
    key: apiKey || undefined,
  });

  return (
    <dialog ref={dialogRef} className="confirm qr-dialog"
      onClose={onClose}
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}>
      <div className="confirm-body">
        <h3>Mobile Setup</h3>
        <p>Scan this QR code with the Kindred iOS app to connect to your server.</p>

        <div className="qr-fields">
          <label className="qr-field">
            <span>Backend URL</span>
            <input
              type="url"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="https://api.your-domain.com"
            />
          </label>
          <label className="qr-field">
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key"
            />
          </label>
        </div>

        {backendUrl && (
          <div className="qr-code-wrap">
            <QRCodeSVG
              value={configPayload}
              size={200}
              bgColor="#fffdf8"
              fgColor="#2a201b"
              level="M"
              marginSize={2}
            />
          </div>
        )}

        {!loaded && <Spinner />}
      </div>
      <div className="confirm-actions">
        <button className="button ghost" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}

/* ── Search Overlay ─────────────────────────────────────────────────── */

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { openLightbox: openLB } = useLightbox();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => { dialogRef.current?.showModal(); setTimeout(() => inputRef.current?.focus(), 50); }, []);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const tryClose = () => {
    if (query.trim()) {
      if (window.confirm("Discard your search?")) {
        setQuery("");
        onClose();
      }
    } else {
      onClose();
    }
  };

  const { data: results, isLoading } = useQuery<SearchResult[]>({
    queryKey: ["global-search", debounced],
    queryFn: () => fetch(`${BACKEND}/search?q=${encodeURIComponent(debounced)}&limit=12`).then((r) => r.json()),
    enabled: debounced.length > 2,
  });

  // Build a map of person name → first matching cluster info for linking
  const personClusterMap = new Map<string, { clusterId: string; category: string }>();
  if (results) {
    for (const r of results) {
      if (r.match_type === "person" && r.match_name && r.match_cluster_id && !personClusterMap.has(r.match_name)) {
        personClusterMap.set(r.match_name, { clusterId: r.match_cluster_id, category: r.match_category || "people" });
      }
    }
  }

  return (
    <dialog ref={dialogRef} className="so"
      onClose={tryClose}
      onClick={(e) => { if (e.target === dialogRef.current) tryClose(); }}>
      <div className="so-search">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--mist)"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people, places, or things..."
          onKeyDown={(e) => { if (e.key === "Escape") tryClose(); }} />
        {query && (
          <button className="so-clear" onClick={() => setQuery("")} aria-label="Clear">&times;</button>
        )}
        <kbd className="so-kbd">esc</kbd>
      </div>

      <div className="so-body">
        {debounced.length <= 2 && (
          <p className="so-hint">
            Try &ldquo;beach&rdquo;, &ldquo;birthday party&rdquo;, or &ldquo;mountains&rdquo;
          </p>
        )}
        {isLoading && <div className="so-hint"><Spinner /></div>}
        {!isLoading && results && results.length === 0 && debounced.length > 2 && (
          <p className="so-hint">Nothing found for &ldquo;{debounced}&rdquo;</p>
        )}
        {!isLoading && results && results.length > 0 && (() => {
          const personResults = results.filter((r) => r.match_type === "person");
          const personNames = [...new Set(personResults.map((r) => r.match_name).filter(Boolean))];
          return <>
            {personNames.length > 0 && (
              <div className="so-people">
                {personNames.map((name) => {
                  const info = personClusterMap.get(name!);
                  const href = info ? `/${info.category}/${info.clusterId}` : "/people";
                  return (
                    <Link key={name} href={href} onClick={onClose} className="so-person-chip">
                      <span className="so-person-name">{name}</span>
                      <span className="so-person-count">{personResults.filter((r) => r.match_name === name).length} photos</span>
                    </Link>
                  );
                })}
              </div>
            )}
            <div className="so-grid">
              {(() => {
                const lbPhotos: LightboxPhoto[] = results.map((p) => ({
                  photo_id: p.photo_id,
                  thumb_url: p.thumb_url || p.photo_url,
                  flickr_url: p.flickr_url,
                  photo_url: p.photo_url,
                  photo_title: p.photo_title,
                }));
                return results.map((r) => (
                  <button key={r.photo_id}
                    className="so-card"
                    onClick={() => { onClose(); openLB(r.photo_id, lbPhotos); }}
                    style={{ border: "none", padding: 0, cursor: "pointer" }}
                  >
                    <img src={r.thumb_url || r.photo_url} alt={r.photo_title || ""} />
                    <div className="so-card-info">
                      <span>{r.photo_title || "Untitled"}</span>
                      {r.match_type === "person" ? (
                        <span className="so-match" style={{ color: "var(--pine)" }}>{r.match_name}</span>
                      ) : (
                        <span className="so-match">{Math.round((1 - r.distance) * 100)}%</span>
                      )}
                    </div>
                  </button>
                ));
              })()}
            </div>
            <Link href={`/search?q=${encodeURIComponent(debounced)}`} onClick={onClose}
              className="so-viewall">
              See all results &rarr;
            </Link>
          </>;
        })()}
      </div>
    </dialog>
  );
}
