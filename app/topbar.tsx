"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Spinner } from "@/components/ui";
import type { User, SyncLog, Stats, SearchResult } from "@/types";
import { BACKEND, CATEGORIES, fmt, toBackendCategory } from "@/lib/constants";

const API = "/api";

const EXPLORE_LINKS = [
  { href: "/timeline", label: "Timeline", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { href: "/locations", label: "Locations", icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" },
  { href: "/landmarks", label: "Landmarks", icon: "M3 21l1.65-3.8a9 9 0 1114.7 0L21 21 M12 3v1m0 16v1m8.66-13.5l-.87.5M4.21 7.5l-.87.5m17.32 5l-.87-.5M4.21 12.5l-.87-.5" },
  { href: "/duplicates", label: "Duplicates", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" },
  { href: "/colors", label: "Colors", icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485" },
  { href: "/objects", label: "Objects", icon: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12" },
  { href: "/together", label: "Together", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75 M9 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { href: "/events", label: "Events", icon: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7" },
];

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
  const [exploreOpen, setExploreOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const exploreRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/auth/me`)
      .then((r) => r.json())
      .then((d: User) => { if (d.loggedIn) setUser(d); setAuthLoading(false); })
      .catch(() => setAuthLoading(false));
  }, []);

  const pathname = usePathname();
  if (pathname === "/login") return null;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (exploreRef.current && !exploreRef.current.contains(e.target as Node)) setExploreOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
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
  const logout = async () => { await fetch(`${API}/auth/logout`); window.location.href = "/login"; };

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
  const isExploreActive = EXPLORE_LINKS.some((l) => pathname === l.href);

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

          {/* Primary nav */}
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

            {/* Explore dropdown */}
            <div className="nb-dropdown" ref={exploreRef}>
              <button
                className={`nb-link ${isExploreActive ? "is-active" : ""}`}
                onClick={() => { setExploreOpen(!exploreOpen); setUserMenuOpen(false); }}
              >
                Explore
                <svg className="nb-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: exploreOpen ? "rotate(180deg)" : undefined }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {exploreOpen && (
                <div className="nb-popover">
                  <div className="nb-popover-grid">
                    {EXPLORE_LINKS.map((link) => (
                      <Link key={link.href} href={link.href}
                        className={`nb-popover-item ${pathname === link.href ? "is-active" : ""}`}
                        onClick={() => setExploreOpen(false)}>
                        <span className="nb-popover-icon"><NavIcon d={link.icon} size={20} /></span>
                        <span>{link.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </nav>

          {/* Right actions */}
          <div className="nb-actions">
            {/* Notifications */}
            <div className="nb-dropdown" ref={notifRef}>
              <button className="nb-icon-btn" aria-label="Notifications"
                onClick={() => { setNotifOpen(!notifOpen); setExploreOpen(false); setUserMenuOpen(false); }}>
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
            </div>

            {/* Upload trigger */}
            <Link href="/upload" className="nb-icon-btn" aria-label="Upload photos" title="Upload photos">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </Link>

            {/* Search trigger */}
            <button className="nb-icon-btn" onClick={() => setSearchOpen(true)}
              aria-label="Search photos" title="Search (Cmd+K)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>

            {/* User */}
            {user ? (
              <div className="nb-dropdown" ref={userRef}>
                <button className="nb-avatar"
                  onClick={() => { setUserMenuOpen(!userMenuOpen); setExploreOpen(false); }}>
                  {(user.fullname || user.username || "?").charAt(0).toUpperCase()}
                </button>
                {userMenuOpen && (
                  <div className="nb-popover nb-popover-right" style={{ minWidth: 200 }}>
                    <div className="nb-user-header">
                      <div className="nb-avatar nb-avatar-lg">
                        {(user.fullname || user.username || "?").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <strong>{user.fullname || user.username}</strong>
                        <span>@{user.username}</span>
                      </div>
                    </div>
                    <div className="nb-popover-divider" />
                    <button className="nb-popover-action" onClick={startScan} disabled={scanning}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                      </svg>
                      {scanning ? "Scanning..." : "Scan new photos"}
                    </button>
                    <button className="nb-popover-action" onClick={logout}>
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
    </>
  );
}

/* ── Search Overlay ─────────────────────────────────────────────────── */

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
              {results.map((r) => (
                <a key={r.photo_id} href={r.flickr_url} target="_blank" rel="noopener noreferrer"
                  className="so-card">
                  <img src={r.thumb_url || r.photo_url} alt={r.photo_title || ""} />
                  <div className="so-card-info">
                    <span>{r.photo_title || "Untitled"}</span>
                    {r.match_type === "person" ? (
                      <span className="so-match" style={{ color: "var(--pine)" }}>{r.match_name}</span>
                    ) : (
                      <span className="so-match">{Math.round((1 - r.distance) * 100)}%</span>
                    )}
                  </div>
                </a>
              ))}
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
