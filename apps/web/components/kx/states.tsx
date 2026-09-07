"use client";

import React, { useEffect, useState } from "react";
import { AlertIcon } from "./icons";
import { tileSpan } from "./photos";

/**
 * The four states every grid and panel in the redesign needs, in one place so
 * the screens agree with each other:
 *
 *   1. `KxSkeletonGrid`  — tiles in the grid's own geometry. Never a spinner
 *                          on a grid: a spinner throws the layout away and
 *                          then throws it back.
 *   2. `KxEmpty`         — a card that says what is missing and offers the one
 *                          thing that would fix it.
 *   3. `KxErrorBanner`   — the server is unreachable; says when it last worked
 *                          and when it will try again.
 *   4. `KxProgressRow`   — work is running in the background, with a count, an
 *                          estimate and a way to stop it.
 */

/* ── 1. Loading ──────────────────────────────────────────────────────── */

/**
 * Skeleton tiles in the mosaic's shape. By default it inherits `--tile` and
 * `--gap` from the shell, so the placeholder is the same size as the photos
 * that replace it and nothing jumps when they land.
 */
export function KxSkeletonGrid({
  count = 12,
  tile,
  gap,
  className = "",
}: {
  count?: number;
  /** Overrides the mosaic tile size — for grids with their own scale. */
  tile?: number;
  gap?: number;
  className?: string;
}) {
  const style: React.CSSProperties = {};
  if (tile !== undefined) (style as Record<string, string>)["--tile"] = `${tile}px`;
  if (gap !== undefined) (style as Record<string, string>)["--gap"] = `${gap}px`;

  return (
    <div className={`kx-skelgrid ${className}`.trim()} style={style} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={`kx-skel ${tileSpan(index)} ${index % 3 === 1 ? "deep" : ""}`.trim()}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton blocks for the card grids — people circles, event cards, object
 * covers. `minWidth` and `height` mirror the real grid's track sizing.
 */
export function KxSkeletonCards({
  count = 8,
  minWidth = 240,
  height = 168,
  round = false,
}: {
  count?: number;
  minWidth?: number;
  height?: number;
  round?: boolean;
}) {
  return (
    <div
      className="kx-skelcards"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={`kx-skel ${round ? "round" : "card"} ${index % 3 === 1 ? "deep" : ""}`.trim()}
          style={round ? undefined : { height }}
        />
      ))}
    </div>
  );
}

/** Skeleton rows for list panels — places, shares, duplicate pairs. */
export function KxSkeletonRows({ count = 5, height = 52 }: { count?: number; height?: number }) {
  return (
    <div className="kx-skelrows" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="kx-skel row" style={{ height }} />
      ))}
    </div>
  );
}

/* ── 2. Empty ────────────────────────────────────────────────────────── */

/**
 * An empty card. `eyebrow` is only for the reference screen, where several
 * empties sit side by side and have to be told apart; product screens leave
 * it off.
 */
export function KxEmpty({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  action?: { label: string; onClick?: () => void; href?: string; primary?: boolean };
}) {
  return (
    <div className="kx-emptycard">
      {eyebrow && <span className="kx-eyebrow quiet">{eyebrow}</span>}
      <strong>{title}</strong>
      <p>{body}</p>
      {action &&
        (action.href ? (
          <a
            className={`kx-button ${action.primary ? "primary" : ""}`.trim()}
            href={action.href}
          >
            {action.label}
          </a>
        ) : (
          <button
            className={`kx-button ${action.primary ? "primary" : ""}`.trim()}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}

/** Nothing has ever synced. The one useful action is connecting the library. */
export function KxEmptyLibrary({ eyebrow }: { eyebrow?: string }) {
  return (
    <KxEmpty
      eyebrow={eyebrow}
      title="Nothing here yet."
      body="Connect your Flickr library and the first sync will fill this in."
      action={{ label: "Connect library", href: "/settings", primary: true }}
    />
  );
}

/** A search or a filter set that matched nothing. */
export function KxEmptyResults({
  eyebrow,
  onClear,
}: {
  eyebrow?: string;
  onClear?: () => void;
}) {
  return (
    <KxEmpty
      eyebrow={eyebrow}
      title="No matches."
      body="Nothing matched those filters. Try widening the dates, or clearing a filter."
      action={onClear ? { label: "Clear filters", onClick: onClear } : undefined}
    />
  );
}

/* ── 3. Error ────────────────────────────────────────────────────────── */

/**
 * The server is unreachable. It says when the library was last in step and
 * counts down to the next attempt, so waiting is a decision rather than a
 * guess. Passing `retryAfter` starts the countdown; it fires `onRetry` at
 * zero and starts again.
 */
export function KxErrorBanner({
  title = "Can't reach your server",
  detail,
  lastSync,
  retryAfter,
  onRetry,
}: {
  title?: string;
  /** Overrides the composed "Last successful sync … · retrying in …" line. */
  detail?: string;
  lastSync?: string | null;
  retryAfter?: number;
  onRetry?: () => void;
}) {
  const [seconds, setSeconds] = useState(retryAfter ?? 0);

  useEffect(() => {
    if (!retryAfter || !onRetry) return;
    setSeconds(retryAfter);
    const timer = setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          onRetry();
          return retryAfter;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter, onRetry]);

  const composed =
    detail ??
    [
      lastSync ? `Last successful sync ${lastSync}` : null,
      retryAfter ? `retrying in ${seconds}s` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="kx-banner danger" role="alert">
      <AlertIcon />
      <span className="kx-banner-copy">
        <strong>{title}</strong>
        {composed && <span className="kx-mono">{composed}</span>}
      </span>
      {onRetry && (
        <button className="kx-button" onClick={onRetry}>
          Retry now
        </button>
      )}
    </div>
  );
}

/* ── 4. In progress ──────────────────────────────────────────────────── */

/** Background analysis: what it is working through, how long is left, Pause. */
export function KxProgressRow({
  title,
  detail,
  onPause,
}: {
  title: string;
  detail?: string;
  onPause?: () => void;
}) {
  return (
    <div className="kx-banner" role="status">
      <span className="kx-spinner-ring" aria-hidden="true" />
      <span className="kx-banner-copy">
        <strong>{title}</strong>
        {detail && <span className="kx-mono">{detail}</span>}
      </span>
      {onPause && (
        <button className="kx-button" onClick={onPause}>
          Pause
        </button>
      )}
    </div>
  );
}

/** "about 6 minutes left" — the ETA phrasing the progress row uses. */
export function formatEta(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 90) return "under a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"} left`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"} left`;
}
