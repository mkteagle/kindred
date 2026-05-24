import { clsx } from "clsx";
import type { ReactNode } from "react";

/* ── Kindred hexagonal mark ───────────────────────────────────── */

export function KindredMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2 L20 7 V17 L12 22 L4 17 V7 Z"
        stroke="var(--color-ember)"
        strokeWidth="1.6"
        fill="rgba(201, 85, 28, 0.08)"
      />
      <circle cx="12" cy="12" r="3.2" fill="var(--color-ember)" />
    </svg>
  );
}

/* ── Status pill (titlebar, status displays) ──────────────────── */

export type StatusTone = "forest" | "ember" | "gold" | "rosehip" | "muted";

export function StatusPill({
  tone,
  pulse = false,
  children,
}: {
  tone: StatusTone;
  pulse?: boolean;
  children: ReactNode;
}) {
  const toneClass: Record<StatusTone, string> = {
    forest: "pill-forest",
    ember: "pill-ember",
    gold: "pill-gold",
    rosehip: "pill-rosehip",
    muted: "pill-muted",
  };
  const dotColor: Record<StatusTone, string> = {
    forest: "var(--color-forest)",
    ember: "var(--color-ember)",
    gold: "var(--color-gold)",
    rosehip: "var(--color-rosehip)",
    muted: "var(--color-muted)",
  };
  return (
    <span className={clsx("pill", toneClass[tone])}>
      <span
        className={clsx(
          "inline-block w-1.5 h-1.5 rounded-full",
          pulse && (tone === "forest" ? "pulse-dot" : "pulse-dot-ember"),
        )}
        style={{ background: dotColor[tone] }}
      />
      {children}
    </span>
  );
}

/* ── Stat card (mini metric tile) ─────────────────────────────── */

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ash" | "ember" | "forest" | "gold" | "rosehip" | "muted";
}) {
  const valueColor: Record<NonNullable<typeof tone>, string> = {
    ash: "var(--color-ash)",
    ember: "var(--color-ember)",
    forest: "var(--color-forest)",
    gold: "var(--color-terra)",
    rosehip: "var(--color-rosehip)",
    muted: "var(--color-muted)",
  };
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: "rgba(255, 253, 248, 0.6)", border: "1px solid var(--line)" }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--color-mist)",
        }}
      >
        {label}
      </div>
      <div
        className="mt-1"
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 20,
          letterSpacing: "-0.01em",
          color: tone ? valueColor[tone] : "var(--color-ash)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-mist)",
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/* ── Section header (eyebrow + title) ─────────────────────────── */

export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="h-eyebrow">{eyebrow}</div>
        <h2
          className="h-display mt-1"
          style={{ fontSize: 18, lineHeight: 1.2 }}
        >
          {title}
        </h2>
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

/* ── Alert/banner ─────────────────────────────────────────────── */

export type AlertTone = "ok" | "warn" | "error" | "info";

export function Alert({ tone, children }: { tone: AlertTone; children: ReactNode }) {
  const styles: Record<AlertTone, { bg: string; border: string; text: string }> = {
    ok: {
      bg: "rgba(47, 74, 54, 0.08)",
      border: "rgba(47, 74, 54, 0.20)",
      text: "var(--color-forest)",
    },
    warn: {
      bg: "rgba(233, 184, 93, 0.16)",
      border: "rgba(168, 74, 29, 0.22)",
      text: "var(--color-terra)",
    },
    error: {
      bg: "rgba(154, 52, 22, 0.08)",
      border: "rgba(154, 52, 22, 0.22)",
      text: "var(--color-rosehip)",
    },
    info: {
      bg: "rgba(74, 40, 26, 0.05)",
      border: "var(--line)",
      text: "var(--color-pine)",
    },
  };
  const s = styles[tone];
  return (
    <div
      className="rounded-md px-3 py-2 text-sm"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text }}
    >
      {children}
    </div>
  );
}
