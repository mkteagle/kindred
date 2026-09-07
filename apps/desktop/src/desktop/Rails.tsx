// The two rails that flank the mosaic, and the strip beneath it: the 42px year
// scrubber, the status bar with its live shortcut legend, and the banner that
// appears when the household server stops answering.

import { Button, KbdHint, AlertIcon } from "./Chrome";
import { formatAgo } from "../lib/format";
import type { ServerStatus } from "../lib/desktop";

/* ── Year scrubber ────────────────────────────────────────────────────── */

export function YearScrubber({
  years,
  active,
  onPick,
}: {
  years: { year: number; count: number }[];
  active: number | null;
  onPick: (year: number) => void;
}) {
  if (years.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Jump to year"
      aria-orientation="vertical"
      className="k-scroll"
      style={{
        width: 42,
        flex: "none",
        borderLeft: "1px solid var(--k-line)",
        padding: "12px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
      }}
    >
      {years.map((entry) => {
        const isActive = entry.year === active;
        return (
          <button
            key={entry.year}
            type="button"
            onClick={() => onPick(entry.year)}
            aria-pressed={isActive}
            title={`${entry.count.toLocaleString()} in ${entry.year}`}
            className="k-mono"
            style={{
              padding: "3px 5px",
              borderRadius: 5,
              border: "none",
              background: isActive ? "var(--k-terracotta)" : "transparent",
              color: isActive ? "var(--k-on-accent)" : "var(--k-ink-4)",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {entry.year}
          </button>
        );
      })}
    </div>
  );
}

/* ── Status bar ───────────────────────────────────────────────────────── */

export function StatusBar({
  selectedCount,
  onShare,
  onAddToAlbum,
  onDragOut,
  dragOutBusy,
}: {
  selectedCount: number;
  onShare: () => void;
  onAddToAlbum: () => void;
  onDragOut: () => void;
  dragOutBusy: boolean;
}) {
  const none = selectedCount === 0;
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "8px 16px",
        borderTop: "1px solid var(--k-line)",
      }}
    >
      <span className="k-mono" aria-live="polite">
        {none ? "Nothing selected" : `${selectedCount.toLocaleString()} selected`}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <KbdHint keys={["⌘A"]} label="select all" />
        <KbdHint keys={["⇧"]} label="range" />
        <KbdHint keys={["Space"]} label="quick look" />
        <KbdHint keys={["⌘⌫"]} label="remove" />
      </span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <Button disabled={none} onClick={onShare}>
          Share
        </Button>
        <Button disabled={none} onClick={onAddToAlbum}>
          Add to album
        </Button>
        <Button disabled={none || dragOutBusy} onClick={onDragOut}>
          {dragOutBusy ? "Preparing…" : "Drag out to Finder"}
        </Button>
      </span>
    </div>
  );
}

/* ── Server unreachable ───────────────────────────────────────────────── */

/**
 * The offline state. It says what is still true — the local cache is being
 * shown — rather than only what has failed, because with a working cache the
 * app is genuinely still usable.
 */
export function ServerBanner({
  status,
  retryInSeconds,
  onRetry,
}: {
  status: ServerStatus;
  retryInSeconds: number | null;
  onRetry: () => void;
}) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: "var(--k-radius)",
        border: "1px solid var(--k-danger-line)",
        background: "var(--k-danger-fill)",
      }}
    >
      <span style={{ color: "var(--k-danger-ink)", display: "flex" }}>
        <AlertIcon size={17} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <strong style={{ fontSize: 13, color: "var(--k-danger-ink)" }}>
          {status.configured ? "Server unreachable" : "This Mac is not paired yet"}
        </strong>
        <span className="k-mono">
          {status.configured
            ? `Showing the local cache · last sync ${formatAgo(status.last_ok)}${
                retryInSeconds !== null ? ` · retrying in ${retryInSeconds}s` : ""
              }`
            : "Add your household server address in Settings → Server"}
        </span>
      </span>
      <span style={{ marginLeft: "auto" }}>
        <Button onClick={onRetry}>{status.configured ? "Retry now" : "Open Settings"}</Button>
      </span>
    </div>
  );
}
