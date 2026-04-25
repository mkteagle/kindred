"use client";

import React, { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "./ui";
import type { ClusterSummary } from "@/types";
import { fmt } from "@/lib/constants";

// ── ConfirmDialog ─────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  avatar?: string | null;
  confirmLabel?: string;
}

export const ConfirmDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  avatar,
  confirmLabel = "Dismiss",
}: ConfirmDialogProps): React.ReactNode => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="confirm-body">
        {avatar && <img className="confirm-avatar" src={avatar} alt="" />}
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      <div className="confirm-actions">
        <Button onClick={onClose} variant="ghost">Cancel</Button>
        <Button onClick={() => { onConfirm(); onClose(); }} variant="danger">
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
};

// ── MergeDialog (virtualized) ────────────────────────────────────────

interface MergeDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (targetId: string) => void;
  sourceCluster: ClusterSummary | null;
  clusters: ClusterSummary[];
}

export const MergeDialog = ({
  open,
  onClose,
  onSelect,
  sourceCluster,
  clusters,
}: MergeDialogProps): React.ReactNode => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setFilter("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const filtered = (clusters || [])
    .filter((c) => c.id !== sourceCluster?.id)
    .filter((c) => {
      if (!filter.trim()) return true;
      const name = (c.label || "unnamed").toLowerCase();
      return name.includes(filter.trim().toLowerCase());
    })
    .sort((a, b) => {
      const aN = a.label ? 0 : 1;
      const bN = b.label ? 0 : 1;
      if (aN !== bN) return aN - bN;
      return b.det_count - a.det_count;
    });

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  return (
    <dialog
      ref={dialogRef}
      className="confirm merge-dialog"
      onClose={onClose}
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="confirm-body">
        <h3>Merge {sourceCluster?.label || "unnamed"} into...</h3>
        <input
          ref={inputRef}
          className="merge-search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search by name..."
        />
        <div className="merge-list" ref={listRef}>
          {filtered.length === 0 && (
            <p style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
              No matching groups
            </p>
          )}
          {filtered.length > 0 && (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const c = filtered[virtualItem.index];
                return (
                  <button
                    key={c.id}
                    className="merge-option"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: virtualItem.size,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                    onClick={() => { onSelect(c.id); onClose(); }}
                  >
                    {c.avatar ? (
                      <img src={c.avatar} alt="" className="merge-option-avatar" />
                    ) : (
                      <span className="merge-option-avatar merge-option-fallback">?</span>
                    )}
                    <span className="merge-option-name">{c.label || "Unnamed"}</span>
                    <span className="merge-option-count">{fmt.format(c.det_count)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="confirm-actions">
        <Button onClick={onClose} variant="ghost">Cancel</Button>
      </div>
    </dialog>
  );
};
