"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  NOTIF_CATALOG,
  SECTIONS,
  CHANNEL_COLORS,
  WebToggle,
  ChevronRight,
} from "@/components/notifications";
import type { NotifTypeDef, ChannelId } from "@/components/notifications";

interface TypeSettings {
  push: boolean;
  inbox: boolean;
  frequency: "realtime" | "daily" | "weekly";
  mutedUntil: string | null;
}

type AllSettings = Record<string, TypeSettings>;

/** Build default settings from catalog */
function defaultSettings(): AllSettings {
  const s: AllSettings = {};
  for (const t of NOTIF_CATALOG) {
    s[t.id] = {
      push: t.pushDefault,
      inbox: t.inboxDefault,
      frequency: t.frequency,
      mutedUntil: null,
    };
  }
  return s;
}

/** Settings left nav items */
const SETTINGS_NAV = [
  { href: "/settings", label: "Profile" },
  { href: "/settings/notifications", label: "Notifications" },
];

function ChannelPip({ channel, on }: { channel: ChannelId; on: boolean }) {
  const color = CHANNEL_COLORS[channel];
  return (
    <div className="ns-pip-wrap">
      <div
        className={`ns-pip ${on ? "ns-pip-on" : "ns-pip-off"}`}
        style={on ? { background: color } : undefined}
      >
        {on && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
            stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
    </div>
  );
}

function CatalogRow({ type, settings, onToggle }: {
  type: NotifTypeDef;
  settings: TypeSettings;
  onToggle: (typeId: string, channel: ChannelId, val: boolean) => void;
}) {
  return (
    <Link href={`/settings/notifications/${type.id}`} className="ns-cat-row">
      <div className="ns-cat-info">
        <span className="ns-cat-title">{type.title}</span>
        <span className="ns-cat-sub">{type.description}</span>
      </div>
      <div className="ns-pip-row">
        <ChannelPip channel="push" on={settings.push} />
        <ChannelPip channel="inbox" on={settings.inbox} />
      </div>
      <span className="ns-cat-chev">
        <ChevronRight size={14} />
      </span>
    </Link>
  );
}

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<AllSettings>(defaultSettings);
  const [quietHours, setQuietHours] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("admin");

  // Load user role
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.loggedIn) setUserRole(d.role || "member");
      })
      .catch(() => {});
  }, []);

  const handleToggle = (typeId: string, channel: ChannelId, val: boolean) => {
    setSettings((prev) => ({
      ...prev,
      [typeId]: { ...prev[typeId], [channel]: val },
    }));
    // Auto-save visual feedback
    setSaved(`Saved \u00b7 ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`);
    setTimeout(() => setSaved(null), 2000);
  };

  const isAdmin = userRole === "admin";

  return (
    <div className="ns-layout">
      {/* Left rail */}
      <aside className="ns-side">
        <h4 className="ns-side-head">Settings</h4>
        {SETTINGS_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`ns-side-link ${item.href === "/settings/notifications" ? "ns-side-active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </aside>

      {/* Main */}
      <main className="ns-main">
        <h2 className="ns-h2">Notifications</h2>
        <p className="ns-lede">
          Choose what we tell you and how. Everything syncs to your iPhone, your iPad, and the web &mdash; change it once.
        </p>

        {saved && <div className="ns-saved">{saved}</div>}

        {/* Legend card */}
        <div className="ns-legend">
          <div className="ns-legend-left">
            <span className="ns-legend-title">How we tell you</span>
            <span className="ns-legend-meta">Two channels, one toggle each</span>
          </div>
          <div className="ns-legend-pips">
            <div className="ns-legend-pip">
              <div className="ns-pip ns-pip-on" style={{ background: CHANNEL_COLORS.push }} />
              <span>PUSH</span>
            </div>
            <div className="ns-legend-pip">
              <div className="ns-pip ns-pip-on" style={{ background: CHANNEL_COLORS.inbox }} />
              <span>INBOX</span>
            </div>
          </div>
        </div>

        {/* Quiet hours section */}
        <div className="ns-section">
          <div className="ns-eyebrow">Quiet hours</div>
          <div className="ns-card">
            <div className="ns-quiet-row">
              <div className="ns-cat-info">
                <span className="ns-cat-title">Pause overnight</span>
                <span className="ns-cat-sub">10pm &mdash; 7am, every day. Items still arrive in the inbox.</span>
              </div>
              <WebToggle on={quietHours} onChange={setQuietHours} />
            </div>
          </div>
        </div>

        {/* Type sections */}
        {SECTIONS.filter((s) => s.id !== "quiet_hours").map((section) => {
          if (section.adminOnly && !isAdmin) return null;
          const types = NOTIF_CATALOG.filter((t) => t.section === section.id);
          if (types.length === 0) return null;

          return (
            <div className="ns-section" key={section.id}>
              <div className="ns-eyebrow-row">
                <span className="ns-eyebrow">{section.label}</span>
                {section.adminOnly && <span className="ns-admin-pill">ADMIN</span>}
              </div>
              <div className="ns-card">
                {types.map((type) => (
                  <CatalogRow
                    key={type.id}
                    type={type}
                    settings={settings[type.id]}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
