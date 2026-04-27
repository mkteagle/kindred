"use client";

import { useEffect } from "react";
import { DemoTopbar } from "./demo-topbar";

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /* Hide the real Topbar and SyncProgress rendered by the parent (main)/layout.tsx.
     We cannot modify the parent layout, so we hide the real topbar via DOM once the
     demo layout mounts. The real topbar is always the first <header class="nb"> in
     the document. Our DemoTopbar renders a second one. */
  useEffect(() => {
    const realTopbar = document.querySelector("header.nb");
    if (realTopbar) {
      (realTopbar as HTMLElement).style.display = "none";
    }
    /* Also hide the sync progress bar if present */
    const syncBar = document.querySelector(".sync-bar-link, [class*='sync-bar']");
    if (syncBar) {
      (syncBar as HTMLElement).style.display = "none";
    }
    return () => {
      /* Restore if navigating away from demo (unlikely in normal flow) */
      if (realTopbar) {
        (realTopbar as HTMLElement).style.display = "";
      }
      if (syncBar) {
        (syncBar as HTMLElement).style.display = "";
      }
    };
  }, []);

  return (
    <>
      <DemoTopbar />
      {children}
      {/* Demo mode indicator bar */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "8px 16px",
        background: "linear-gradient(90deg, #2f4a36, #4a6b4f)",
        color: "rgba(251, 244, 231, .92)",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "var(--mono)",
        letterSpacing: ".06em",
        textTransform: "uppercase",
        borderTop: "1px solid rgba(251, 244, 231, .15)",
        backdropFilter: "blur(12px)",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
        </svg>
        Demo mode
        <span style={{ opacity: 0.5, margin: "0 4px" }}>|</span>
        <span style={{ opacity: 0.6, fontWeight: 500, textTransform: "none", letterSpacing: "normal" }}>
          Mock data only. Everything resets on refresh.
        </span>
        <a href="/login" style={{ marginLeft: 12, color: "var(--gold-soft)", textDecoration: "none", fontWeight: 700 }}>
          Sign in &rarr;
        </a>
      </div>
    </>
  );
}
