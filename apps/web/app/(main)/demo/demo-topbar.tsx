"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DEMO_CATEGORIES, DEMO_STATS, DEMO_USER, searchDemoPhotos } from "./demo-data";

const fmt = new Intl.NumberFormat();

/* "More" dropdown items — same set as real topbar, prefixed to /demo */
const MORE_ITEMS = [
  { href: "/demo/together", label: "Together", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75 M9 7a4 4 0 11-8 0 4 4 0 018 0z" },
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

export function DemoTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  const isMoreActive = MORE_ITEMS.some((p) => pathname === p.href);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Cmd+K shortcut
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

  /* Category map: frontend "pets" -> backend stats key "pets" */
  const catStatsKey: Record<string, string> = { people: "people", pets: "pets", vehicles: "vehicles" };

  return (
    <>
      <header className="nb">
        <div className="nb-inner">
          {/* Brand */}
          <Link href="/demo" className="nb-brand">
            <img src="/kindred-wordmark.svg" alt="Kindred" className="nb-logo" />
          </Link>

          {/* Primary nav */}
          <nav className="nb-nav" role="navigation">
            {DEMO_CATEGORIES.map((cat) => {
              const catPath = `/demo/${cat.id}`;
              const active = pathname === catPath || pathname.startsWith(`${catPath}/`);
              const statsKey = catStatsKey[cat.id] || cat.id;
              const count = (DEMO_STATS as Record<string, { groups: number }>)[statsKey]?.groups || 0;
              return (
                <Link key={cat.id} href={catPath} className={`nb-link ${active ? "is-active" : ""}`}>
                  {cat.label}
                  {count > 0 && <span className="nb-badge">{fmt.format(count)}</span>}
                </Link>
              );
            })}

            {/* Timeline */}
            <Link href="/demo" className={`nb-link ${pathname === "/demo/timeline" ? "is-active" : ""}`}>
              Timeline
            </Link>

            {/* Locations */}
            <Link href="/demo" className={`nb-link ${pathname === "/demo/locations" ? "is-active" : ""}`}>
              Locations
            </Link>

            {/* More dropdown */}
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
                    {MORE_ITEMS.map((link) => (
                      <Link key={link.href} href={link.href}
                        className={`nb-popover-item ${pathname === link.href ? "is-active" : ""}`}
                        onClick={() => setMoreOpen(false)}>
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
            {/* Search trigger */}
            <button className="nb-icon-btn" onClick={() => setSearchOpen(true)}
              aria-label="Search photos" title="Search (Cmd+K)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>

            {/* Notifications bell (static) */}
            <button className="nb-icon-btn" aria-label="Notifications" title="Notifications">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
            </button>

            {/* User avatar */}
            <div className="nb-dropdown" ref={userRef}>
              <button
                className="nb-avatar"
                style={{ background: "linear-gradient(135deg,#2f4a36,#4a6b4f)" }}
                onClick={() => { setUserMenuOpen(!userMenuOpen); setMoreOpen(false); }}>
                {DEMO_USER.display_name.charAt(0).toUpperCase()}
              </button>
              {userMenuOpen && (
                <div className="nb-popover nb-popover-right" style={{ minWidth: 220 }}>
                  <div className="nb-user-header">
                    <div className="nb-avatar nb-avatar-lg" style={{ background: "linear-gradient(135deg,#2f4a36,#4a6b4f)" }}>
                      {DEMO_USER.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <strong>{DEMO_USER.display_name}</strong>
                      <span>@{DEMO_USER.username}</span>
                    </div>
                  </div>
                  <div className="nb-popover-divider" />
                  <Link href="/demo/settings" className="nb-popover-action" onClick={() => setUserMenuOpen(false)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                    Account settings
                  </Link>
                  <div className="nb-popover-divider" />
                  <Link href="/login" className="nb-popover-action" onClick={() => setUserMenuOpen(false)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign in (exit demo)
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {searchOpen && <DemoSearchOverlay onClose={() => setSearchOpen(false)} />}
    </>
  );
}

/* ── Demo Search Overlay ─────────────────────────────────────────── */

function DemoSearchOverlay({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => { dialogRef.current?.showModal(); setTimeout(() => inputRef.current?.focus(), 50); }, []);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const tryClose = () => {
    if (query.trim()) {
      setQuery("");
    }
    onClose();
  };

  const results = debounced.length > 2 ? searchDemoPhotos(debounced) : null;

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
          onKeyDown={(e) => {
            if (e.key === "Escape") tryClose();
            if (e.key === "Enter" && debounced.length > 2) {
              onClose();
              router.push(`/demo/search?q=${encodeURIComponent(debounced)}`);
            }
          }} />
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
        {results && results.photos.length > 0 && (
          <>
            <div className="so-grid">
              {results.photos.slice(0, 8).map((photo, i) => (
                <div key={i} className="so-card">
                  <img src={photo} alt="" />
                  <div className="so-card-info">
                    <span>{results.label}</span>
                    <span className="so-match">{85 + i}%</span>
                  </div>
                </div>
              ))}
            </div>
            <Link href={`/demo/search?q=${encodeURIComponent(debounced)}`} onClick={onClose}
              className="so-viewall">
              See all results &rarr;
            </Link>
          </>
        )}
        {debounced.length > 2 && (!results || results.photos.length === 0) && (
          <p className="so-hint">Nothing found for &ldquo;{debounced}&rdquo;</p>
        )}
      </div>
    </dialog>
  );
}
