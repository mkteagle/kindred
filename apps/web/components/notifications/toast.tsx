"use client";

import React from "react";
import { NotifGlyphIcon, XIcon } from "./icons";
import { getGlyphStyle, GLYPH_STYLES } from "./catalog";
import type { ToastItem } from "./use-notifications";

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string, ms: number) => void;
}

function Toast({ toast, onDismiss, onPause, onResume }: ToastProps) {
  const gs = getGlyphStyle(toast.type);
  const style = GLYPH_STYLES[gs] || GLYPH_STYLES.sync;

  return (
    <div
      className="ktoast"
      role="status"
      aria-live={toast.type.startsWith("admin.") ? "assertive" : "polite"}
      onMouseEnter={() => onPause(toast.id)}
      onMouseLeave={() => onResume(toast.id, 3000)}
    >
      <div
        className="ktoast-glyph"
        style={{
          background: style.gradient || style.bg,
          color: style.color,
        }}
      >
        <NotifGlyphIcon glyphStyle={gs} size={16} />
      </div>
      <div className="ktoast-body">
        <span className="ktoast-title">{toast.title}</span>
        <span className="ktoast-sub">{toast.message}</span>
        <div className="ktoast-actions">
          <button className="ktoast-view" onClick={() => onDismiss(toast.id)}>View</button>
          <button className="ktoast-later" onClick={() => onDismiss(toast.id)}>Later</button>
        </div>
      </div>
      <button className="ktoast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <XIcon size={14} />
      </button>
    </div>
  );
}

export function ToastContainer({
  toasts,
  onDismiss,
  onPause,
  onResume,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string, ms: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="ktoast-container">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} onPause={onPause} onResume={onResume} />
      ))}
    </div>
  );
}
