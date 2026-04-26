"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { BellIcon, NotifGlyphIcon } from "./icons";
import { useNotifications, groupByDay, shortTime } from "./use-notifications";
import { getGlyphStyle, GLYPH_STYLES } from "./catalog";

const FILTERS = ["All", "Photos", "Household", "Admin"] as const;
type Filter = typeof FILTERS[number];

function filterMatch(type: string, filter: Filter): boolean {
  if (filter === "All") return true;
  if (filter === "Photos") return type.startsWith("photos.") || type === "scan_complete" || type === "photo_processed";
  if (filter === "Household") return type.startsWith("household.") || type === "household.member_joined";
  if (filter === "Admin") return type.startsWith("admin.") || type === "photos_deleted";
  return true;
}

export function NotifBell({ isAdmin = false }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");
  const ref = useRef<HTMLDivElement>(null);
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications(20);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // G then N shortcut
  useEffect(() => {
    let waitingForN = false;
    let timer: ReturnType<typeof setTimeout>;
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "g" || e.key === "G") {
        waitingForN = true;
        timer = setTimeout(() => { waitingForN = false; }, 800);
      } else if ((e.key === "n" || e.key === "N") && waitingForN) {
        waitingForN = false;
        clearTimeout(timer);
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => { document.removeEventListener("keydown", handler); clearTimeout(timer); };
  }, []);

  const filtered = notifications.filter((n) => filterMatch(n.type, filter));
  const groups = groupByDay(filtered.slice(0, 6));
  const visibleFilters = isAdmin ? FILTERS : FILTERS.filter((f) => f !== "Admin");

  // Count per filter
  const countFor = useCallback((f: Filter) => {
    return notifications.filter((n) => !n.read && filterMatch(n.type, f)).length;
  }, [notifications]);

  const handleRowClick = (id: number) => {
    markRead(id);
    setOpen(false);
  };

  return (
    <div className="nbell" ref={ref}>
      <button
        className={`nbell-btn ${open ? "nbell-btn-active" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
      >
        <BellIcon size={18} />
        {unreadCount > 0 && (
          <span className="nbell-badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="nbell-dd" role="dialog" aria-modal="false">
          <div className="nbell-arrow" />

          {/* Header */}
          <div className="nbell-head">
            <div>
              <h3 className="nbell-title">Notifications</h3>
              <span className="nbell-meta">
                {unreadCount} new
              </span>
            </div>
            {unreadCount > 0 && (
              <button className="nbell-markall" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="nbell-tabs">
            {visibleFilters.map((f) => {
              const c = countFor(f);
              return (
                <button
                  key={f}
                  className={`nbell-tab ${filter === f ? "nbell-tab-active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                  {c > 0 && <span className="nbell-tab-count">{c}</span>}
                </button>
              );
            })}
          </div>

          {/* Notification rows */}
          <div className="nbell-list">
            {groups.length === 0 && (
              <div className="nbell-empty">
                <strong>All caught up.</strong>
                <span>Nothing new since you last looked.</span>
              </div>
            )}
            {groups.map((group) => (
              <React.Fragment key={group.label}>
                <div className="nbell-group">{group.label}</div>
                {group.items.map((n) => {
                  const gs = getGlyphStyle(n.type);
                  const style = GLYPH_STYLES[gs] || GLYPH_STYLES.sync;
                  return (
                    <button
                      key={n.id}
                      className={`nbell-row ${!n.read ? "nbell-row-unread" : ""}`}
                      onClick={() => handleRowClick(n.id)}
                    >
                      <div
                        className="nbell-glyph"
                        style={{
                          background: style.gradient || style.bg,
                          color: style.color,
                        }}
                      >
                        <NotifGlyphIcon glyphStyle={gs} size={16} />
                      </div>
                      <div className="nbell-body">
                        <span className="nbell-row-title">{n.title}</span>
                        <span className="nbell-row-sub">{n.message}</span>
                      </div>
                      <span className="nbell-time">{shortTime(n.created_at)}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>

          {/* Footer */}
          <div className="nbell-foot">
            <Link href="/inbox" className="nbell-foot-link" onClick={() => setOpen(false)}>
              Open inbox &rarr;
            </Link>
            <span className="nbell-foot-hint">&#8984; , for prefs</span>
          </div>
        </div>
      )}
    </div>
  );
}
