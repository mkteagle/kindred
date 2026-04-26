"use client";

import React, { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  useNotifications,
  groupByDay,
  relativeTime,
  getGlyphStyle,
  GLYPH_STYLES,
  NotifGlyphIcon,
  CheckIcon,
  BookmarkIcon,
  BellOffIcon,
  CogIcon,
} from "@/components/notifications";
import { Spinner } from "@/components/ui";

type InboxFilter = "all" | "photos" | "household" | "admin" | "muted";

function filterMatch(type: string, filter: InboxFilter): boolean {
  if (filter === "all") return true;
  if (filter === "photos") return type.startsWith("photos.") || type === "scan_complete" || type === "photo_processed";
  if (filter === "household") return type.startsWith("household.");
  if (filter === "admin") return type.startsWith("admin.") || type === "photos_deleted";
  return true;
}

const SIDEBAR_FILTERS: { id: InboxFilter; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
  { id: "photos", label: "Photos", icon: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M12 13a3 3 0 100-6 3 3 0 000 6z" },
  { id: "household", label: "Household", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2 M9 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { id: "admin", label: "Admin", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
];

function SidebarIcon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ opacity: 0.7 }}>
      {d.split(" M").map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </svg>
  );
}

export default function InboxPage() {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const { notifications, unreadCount, isLoading, markAllRead, markRead } = useNotifications(100);

  const filtered = notifications.filter((n) => filterMatch(n.type, filter));
  const groups = groupByDay(filtered);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "j") setFocusedIdx((i) => Math.min(i + 1, filtered.length - 1));
      if (e.key === "k") setFocusedIdx((i) => Math.max(i - 1, 0));
      if (e.key === "r" && focusedIdx >= 0 && filtered[focusedIdx]) {
        markRead(filtered[focusedIdx].id);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [focusedIdx, filtered, markRead]);

  const countFor = useCallback((f: InboxFilter) => {
    return notifications.filter((n) => !n.read && filterMatch(n.type, f)).length;
  }, [notifications]);

  // Flatten for index tracking
  let flatIdx = 0;

  return (
    <div className="inbox-layout">
      {/* Left sidebar / filter rail */}
      <aside className="inbox-side">
        <h4 className="inbox-side-head">Filter</h4>
        {SIDEBAR_FILTERS.map((f) => {
          const c = countFor(f.id);
          return (
            <button
              key={f.id}
              className={`inbox-filter-row ${filter === f.id ? "inbox-filter-active" : ""}`}
              onClick={() => { setFilter(f.id); setFocusedIdx(-1); }}
            >
              <SidebarIcon d={f.icon} />
              <span>{f.label}</span>
              {c > 0 && <span className="inbox-filter-count">{c}</span>}
            </button>
          );
        })}

        <div className="inbox-side-divider" />

        <h4 className="inbox-side-head">Quiet hours</h4>
        <div className="inbox-quiet">
          <span>Pausing push 10p&ndash;7a</span>
          <Link href="/settings/notifications" className="inbox-quiet-link">edit</Link>
        </div>
      </aside>

      {/* Main column */}
      <main className="inbox-main">
        <div className="inbox-header">
          <div>
            <h2 className="inbox-h2">Notifications</h2>
            <span className="inbox-meta">
              {unreadCount} new &middot; last 30 days
            </span>
          </div>
        </div>

        {/* Toolbar */}
        <div className="inbox-toolbar">
          <button className="inbox-tb-btn inbox-tb-primary" onClick={markAllRead}>
            <CheckIcon size={13} /> Mark all read
          </button>
          <span className="inbox-tb-sep" />
          <Link href="/settings/notifications" className="inbox-tb-btn">
            <CogIcon size={13} /> Preferences
          </Link>
        </div>

        {/* List */}
        <div className="inbox-list">
          {isLoading && (
            <div className="inbox-empty"><Spinner /></div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="inbox-empty">
              <strong>
                {filter === "muted" ? "Nothing's muted right now." : "Nothing here."}
              </strong>
              <span>Items will show up the moment they happen.</span>
            </div>
          )}

          {groups.map((group) => (
            <React.Fragment key={group.label}>
              <div className="inbox-grouphead">{group.label}</div>
              {group.items.map((n) => {
                const idx = flatIdx++;
                const gs = getGlyphStyle(n.type);
                const style = GLYPH_STYLES[gs] || GLYPH_STYLES.sync;
                const isFocused = idx === focusedIdx;
                return (
                  <div
                    key={n.id}
                    className={`inbox-row ${!n.read ? "inbox-row-unread" : ""} ${isFocused ? "inbox-row-focus" : ""}`}
                    tabIndex={0}
                    onClick={() => markRead(n.id)}
                  >
                    <div
                      className="inbox-glyph"
                      style={{
                        background: style.gradient || style.bg,
                        color: style.color,
                      }}
                    >
                      <NotifGlyphIcon glyphStyle={gs} size={16} />
                    </div>
                    <div className="inbox-body">
                      <span className="inbox-row-title">{n.title}</span>
                      <span className="inbox-row-sub">{n.message}</span>
                      {n.type.startsWith("admin.") && (
                        <span className="inbox-admin-tag">ADMIN</span>
                      )}
                    </div>
                    <span className="inbox-row-time">{relativeTime(n.created_at)}</span>
                    <div className="inbox-row-actions">
                      <button className="inbox-action-btn" onClick={(e) => { e.stopPropagation(); markRead(n.id); }} title="Mark read">
                        <CheckIcon size={13} />
                      </button>
                      <button className="inbox-action-btn" title="Star" onClick={(e) => e.stopPropagation()}>
                        <BookmarkIcon size={13} />
                      </button>
                      <button className="inbox-action-btn" title="Mute" onClick={(e) => e.stopPropagation()}>
                        <BellOffIcon size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </main>
    </div>
  );
}
