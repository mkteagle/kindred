import { type ReactNode } from "react";
import { useAppState } from "../lib/appState";
import { KindredMark, StatusPill, type StatusTone } from "./Primitives";

export type Page =
  | "dashboard"
  | "indexer"
  | "uploads"
  | "sources"
  | "activity"
  | "settings";

type Props = {
  current: Page;
  onNavigate: (p: Page) => void;
  children: ReactNode;
};

const NAV: { id: Page; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "indexer", label: "Indexer" },
  { id: "uploads", label: "Uploads" },
  { id: "sources", label: "Sources" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

export function SidebarShell({ current, onNavigate, children }: Props) {
  const { counts, running, scanning } = useAppState();

  const statusTone: StatusTone = running
    ? "ember"
    : counts.pending > 0
      ? "muted"
      : "forest";
  const statusLabel = running
    ? "Backing up"
    : counts.pending > 0
      ? "Paused"
      : counts.done > 0
        ? "Up to date"
        : "Ready";

  return (
    <div
      className="h-full grid"
      style={{
        gridTemplateColumns: "208px 1fr",
        background: "var(--color-paper)",
      }}
    >
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className="flex flex-col"
        style={{
          background: "linear-gradient(180deg, var(--color-cream), var(--color-canvas))",
          borderRight: "1px solid var(--line)",
        }}
      >
        {/* Top: brand + status */}
        <div
          className="px-4 pt-5 pb-4"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          <div className="flex items-center gap-2">
            <KindredMark size={16} />
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 13.5,
                color: "var(--color-ash)",
                letterSpacing: "-0.005em",
              }}
            >
              Kindred Backup
            </span>
          </div>
          <div className="mt-3">
            <StatusPill tone={statusTone} pulse={running || scanning}>
              {statusLabel}
            </StatusPill>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = current === item.id;
            const badge = badgeFor(item.id, counts, scanning);
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md transition-colors"
                style={{
                  background: active ? "var(--color-card)" : "transparent",
                  boxShadow: active ? "0 1px 3px rgba(109, 60, 36, 0.08)" : "none",
                  border: active ? "1px solid var(--line)" : "1px solid transparent",
                  color: active ? "var(--color-ember)" : "var(--color-pine)",
                  fontFamily: "var(--font-display)",
                  fontWeight: active ? 700 : 600,
                  fontSize: 12.5,
                  letterSpacing: "-0.005em",
                }}
              >
                <span>{item.label}</span>
                {badge}
              </button>
            );
          })}
        </nav>

        {/* Bottom: user / version */}
        <div
          className="px-4 py-4"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-ember), var(--color-gold))",
                color: "#fffdf8",
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 11.5,
              }}
            >
              M
            </div>
            <div className="min-w-0 flex-1">
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--color-ash)",
                  lineHeight: 1.2,
                }}
              >
                Kindred
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--color-mist)",
                  marginTop: 1,
                }}
              >
                Admin · macOS
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Content ─────────────────────────────────────────── */}
      <main className="overflow-y-auto" style={{ height: "100vh" }}>
        {children}
      </main>
    </div>
  );
}

function badgeFor(
  page: Page,
  counts: { pending: number; failed: number; uploading: number },
  scanning: boolean,
): ReactNode {
  if (page === "uploads") {
    const inQueue = counts.pending + counts.uploading;
    if (inQueue > 0) {
      return (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            fontWeight: 700,
            background: "var(--color-card)",
            border: "1px solid var(--line)",
            color: "var(--color-pine)",
            padding: "2px 6px",
            borderRadius: 999,
          }}
        >
          {fmtCompact(inQueue)}
        </span>
      );
    }
    if (counts.failed > 0) {
      return (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            fontWeight: 700,
            background: "rgba(154, 52, 22, 0.12)",
            color: "var(--color-rosehip)",
            padding: "2px 6px",
            borderRadius: 999,
          }}
        >
          {counts.failed.toLocaleString()}
        </span>
      );
    }
  }
  if (page === "indexer" && scanning) {
    return (
      <span
        className="inline-block w-1.5 h-1.5 rounded-full pulse-dot-ember"
        style={{ background: "var(--color-ember)" }}
      />
    );
  }
  return null;
}

function fmtCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
