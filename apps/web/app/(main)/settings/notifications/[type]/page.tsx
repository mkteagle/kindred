"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  NOTIF_CATALOG,
  GLYPH_STYLES,
  CHANNEL_COLORS,
  WebToggle,
  NotifGlyphIcon,
  getGlyphStyle,
} from "@/components/notifications";
import type { Frequency } from "@/components/notifications";

const FREQ_OPTIONS: { id: Frequency; title: string; sub: string }[] = [
  { id: "realtime", title: "Real-time", sub: "As ready" },
  { id: "daily", title: "Daily", sub: "9 AM bundle" },
  { id: "weekly", title: "Weekly", sub: "Sat 9 AM" },
];

const MUTE_OPTIONS = [
  "1 hour",
  "4 hours",
  "Until tomorrow",
  "Until I turn back on",
];

export default function NotifTypeDetailPage() {
  const params = useParams();
  const typeId = params.type as string;

  const typeDef = useMemo(() => NOTIF_CATALOG.find((t) => t.id === typeId), [typeId]);

  const [pushOn, setPushOn] = useState(typeDef?.pushDefault ?? false);
  const [inboxOn, setInboxOn] = useState(typeDef?.inboxDefault ?? true);
  const [frequency, setFrequency] = useState<Frequency>(typeDef?.frequency ?? "realtime");
  const [muteOpen, setMuteOpen] = useState(false);
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);

  if (!typeDef) {
    return (
      <div className="ntd-layout">
        <main className="ntd-main" style={{ padding: "48px 32px" }}>
          <h2>Notification type not found</h2>
          <p>The type &ldquo;{typeId}&rdquo; doesn&rsquo;t exist in the catalog.</p>
          <Link href="/settings/notifications" style={{ color: "var(--ember)", fontWeight: 700 }}>
            &larr; Back to notifications
          </Link>
        </main>
      </div>
    );
  }

  const gs = getGlyphStyle(typeDef.id);
  const glyphStyle = GLYPH_STYLES[gs] || GLYPH_STYLES.sync;

  return (
    <div className="ntd-layout">
      <main className="ntd-main">
        {/* Breadcrumb */}
        <nav className="ntd-crumb">
          <Link href="/settings" className="ntd-crumb-link">Settings</Link>
          <span className="ntd-crumb-sep">/</span>
          <Link href="/settings/notifications" className="ntd-crumb-link">Notifications</Link>
          <span className="ntd-crumb-sep">/</span>
          <span className="ntd-crumb-current">{typeDef.title}</span>
        </nav>

        <div className="ntd-grid">
          {/* Left column - controls */}
          <div className="ntd-controls">
            <h2 className="ntd-h2">{typeDef.title}</h2>
            <p className="ntd-lede">{typeDef.description}. {typeDef.triggers}.</p>

            {/* Send via */}
            <div className="ntd-section-head">Send via</div>
            <div className="ntd-chan-card">
              {/* Push row */}
              <div className="ntd-chan-row">
                <div className="ntd-chan-sw" style={{ background: CHANNEL_COLORS.push }} />
                <div className="ntd-chan-info">
                  <span className="ntd-chan-title">Push notification</span>
                  <span className="ntd-chan-sub">Browser or OS-level alert</span>
                </div>
                <WebToggle on={pushOn} onChange={setPushOn} color={CHANNEL_COLORS.push} />
              </div>

              {/* Inbox row */}
              <div className="ntd-chan-row">
                <div className="ntd-chan-sw" style={{ background: CHANNEL_COLORS.inbox }} />
                <div className="ntd-chan-info">
                  <span className="ntd-chan-title">In-app inbox</span>
                  <span className="ntd-chan-sub">Always visible in your notifications feed</span>
                </div>
                {typeDef.inboxLocked ? (
                  <span className="ntd-always-pill">ALWAYS</span>
                ) : (
                  <WebToggle on={inboxOn} onChange={setInboxOn} color={CHANNEL_COLORS.inbox} />
                )}
              </div>
            </div>

            {/* How often */}
            <div className="ntd-section-head">How often</div>
            <div className="ntd-freq-grid">
              {FREQ_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className={`ntd-freq-card ${frequency === opt.id ? "ntd-freq-on" : ""}`}
                  onClick={() => setFrequency(opt.id)}
                >
                  <span className="ntd-freq-title">{opt.title}</span>
                  <span className="ntd-freq-sub">{opt.sub}</span>
                </button>
              ))}
            </div>

            {/* Mute row */}
            <div className="ntd-mute-row">
              <div className="ntd-mute-info">
                <span className="ntd-chan-title">Mute this type for&hellip;</span>
                <span className="ntd-chan-sub">Pauses push only. Items still arrive in your inbox.</span>
              </div>
              <div className="ntd-mute-control">
                {mutedUntil ? (
                  <button className="ntd-mute-link" onClick={() => setMutedUntil(null)}>
                    Unmute
                  </button>
                ) : (
                  <div style={{ position: "relative" }}>
                    <button className="ntd-mute-link" onClick={() => setMuteOpen(!muteOpen)}>
                      Choose duration &#9662;
                    </button>
                    {muteOpen && (
                      <div className="ntd-mute-menu">
                        {MUTE_OPTIONS.map((opt) => (
                          <button
                            key={opt}
                            className="ntd-mute-option"
                            onClick={() => { setMutedUntil(opt); setMuteOpen(false); }}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column - preview */}
          <div className="ntd-preview">
            <div className="ntd-preview-card">
              <span className="ntd-preview-label">What you&rsquo;ll see</span>

              <div className="ntd-preview-cluster">
                {/* Browser push preview */}
                {pushOn && (
                  <div className="ntd-mini-push">
                    <div
                      className="ntd-mini-icon"
                      style={{ background: glyphStyle.gradient || glyphStyle.bg, color: glyphStyle.color }}
                    >
                      <NotifGlyphIcon glyphStyle={gs} size={16} />
                    </div>
                    <div className="ntd-mini-body">
                      <div className="ntd-mini-source">
                        <span>Kindred</span>
                        <span className="ntd-mini-time">now</span>
                      </div>
                      <span className="ntd-mini-title">{typeDef.title}</span>
                      <span className="ntd-mini-sub">{typeDef.description}</span>
                    </div>
                  </div>
                )}

                {/* In-app toast preview */}
                <div className="ntd-mini-toast">
                  <div
                    className="ntd-toast-icon"
                    style={{ background: glyphStyle.gradient || glyphStyle.bg, color: glyphStyle.color }}
                  >
                    <NotifGlyphIcon glyphStyle={gs} size={16} />
                  </div>
                  <div className="ntd-toast-body">
                    <span className="ntd-toast-title">{typeDef.title}</span>
                    <span className="ntd-toast-sub">{typeDef.description}</span>
                    <span className="ntd-toast-view">View &rarr;</span>
                  </div>
                </div>

                {/* Inbox row preview */}
                {(typeDef.inboxLocked || inboxOn) && (
                  <div className="ntd-mini-inbox">
                    <div
                      className="ntd-inbox-icon"
                      style={{ background: glyphStyle.gradient || glyphStyle.bg, color: glyphStyle.color }}
                    >
                      <NotifGlyphIcon glyphStyle={gs} size={12} />
                    </div>
                    <div className="ntd-inbox-body">
                      <span className="ntd-inbox-title">{typeDef.title}</span>
                      <span className="ntd-inbox-sub">{typeDef.description}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Sync confirmation */}
              <div className="ntd-sync-strip">
                <span className="ntd-sync-eye">Synced across devices</span>
                <span className="ntd-sync-body">
                  Changes save instantly to your iPhone and iPad. Push will silence on iOS too.
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
