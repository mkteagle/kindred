import { useState } from "react";
import { useAppState } from "../lib/appState";
import { api, type ScanTriggerResponse } from "../lib/tauri";
import { basename, formatBytes, formatDuration } from "../lib/format";
import { Alert, StatCard } from "../components/Primitives";
import { PageHeader } from "../components/PageHeader";

export function DashboardPage({ onNavigate }: { onNavigate: (p: "uploads" | "sources" | "settings") => void }) {
  const { counts, running, inFlight, rate, error, startUpload, stopUpload } = useAppState();
  const [scanTrigger, setScanTrigger] = useState<{ state: "idle" | "running" | "done" | "error"; msg?: string }>({ state: "idle" });

  const total = counts.pending + counts.uploading + counts.done + counts.failed;
  const pctBytes = counts.total_bytes_all > 0
    ? Math.min(100, (counts.total_bytes_done / counts.total_bytes_all) * 100)
    : 0;

  async function triggerIndex() {
    setScanTrigger({ state: "running" });
    try {
      const res: ScanTriggerResponse = await api.triggerScan();
      setScanTrigger({
        state: "done",
        msg: res.count > 0
          ? `Indexing started for ${res.count.toLocaleString()} photos${res.job_id ? ` (job ${res.job_id.slice(0, 8)})` : ""}.`
          : res.message || "Indexing started.",
      });
    } catch (e) {
      setScanTrigger({ state: "error", msg: String(e) });
    }
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={total > 0 ? `${total.toLocaleString()} photos in your queue` : "Nothing queued yet"}
        actions={
          !running ? (
            <button
              onClick={startUpload}
              disabled={counts.pending === 0}
              className="btn-primary"
            >
              {counts.pending > 0 ? "Start backing up →" : "Nothing queued"}
            </button>
          ) : (
            <button onClick={stopUpload} className="btn-secondary">
              Stop after in-flight
            </button>
          )
        }
      />

      <div className="px-7 py-6 space-y-6 max-w-[1040px]">
        {error && <Alert tone="error">{error}</Alert>}

        {/* Hero status */}
        <section className="hero-card p-6 relative">
          <div className="hero-glow" />
          <div className="relative">
            <div className="h-eyebrow">
              {running ? "Currently uploading" : counts.pending > 0 ? "Ready to resume" : counts.done > 0 ? "All clear" : "Get started"}
            </div>
            <div
              className="mt-2"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 28,
                letterSpacing: "-0.01em",
                color: "var(--color-ash)",
                lineHeight: 1.15,
              }}
            >
              {running ? (
                <>Uploading <b style={{ color: "var(--color-ember)" }}>{counts.done.toLocaleString()}</b> of {total.toLocaleString()}</>
              ) : counts.pending > 0 ? (
                <><b style={{ color: "var(--color-ember)" }}>{counts.pending.toLocaleString()}</b> photos waiting to upload</>
              ) : counts.done > 0 ? (
                <><b>{counts.done.toLocaleString()}</b> photos backed up</>
              ) : (
                <button
                  onClick={() => onNavigate("sources")}
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: 28,
                    color: "var(--color-ember)",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Pick a folder to begin →
                </button>
              )}
            </div>

            {counts.total_bytes_all > 0 && (
              <div className="mt-5">
                <div
                  className="flex justify-between mb-2"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-mist)" }}
                >
                  <span>{formatBytes(counts.total_bytes_done)} of {formatBytes(counts.total_bytes_all)}</span>
                  <span>
                    {running
                      ? `${formatBytes(rate.bps)}/s · ETA ${formatDuration(rate.eta)}`
                      : `${pctBytes.toFixed(1)}% complete`}
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${pctBytes}%` }} />
                </div>
              </div>
            )}

            {inFlight.length > 0 && (
              <div className="mt-5">
                <div className="h-eyebrow mb-2">In flight</div>
                <div className="space-y-1">
                  {inFlight.slice(0, 5).map((f) => (
                    <div key={f.file_id} className="flex items-center gap-2" style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
                      <span className="inline-block w-1.5 h-1.5 rounded-full pulse-dot-ember" style={{ background: "var(--color-ember)" }} />
                      <code className="truncate" style={{ color: "var(--color-pine)" }} title={f.path}>{basename(f.path)}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Stat row */}
        <section className="grid grid-cols-4 gap-3">
          <StatCard
            label="Done"
            value={counts.done.toLocaleString()}
            tone="forest"
            sub={counts.done > 0 ? `${formatBytes(counts.total_bytes_done)} uploaded` : "Nothing yet"}
          />
          <StatCard
            label="Pending"
            value={counts.pending.toLocaleString()}
            tone="ash"
            sub={counts.pending > 0 ? `${formatBytes(counts.total_bytes_all - counts.total_bytes_done)} to go` : "Caught up"}
          />
          <StatCard
            label="In flight"
            value={counts.uploading.toLocaleString()}
            tone="ember"
            sub={running ? "Live" : "Idle"}
          />
          <StatCard
            label="Failed"
            value={counts.failed.toLocaleString()}
            tone={counts.failed > 0 ? "rosehip" : "muted"}
            sub={counts.failed > 0 ? "Tap Uploads to review" : "All clear"}
          />
        </section>

        {/* Quick actions */}
        <section className="grid grid-cols-3 gap-3">
          <QuickLink
            eyebrow="Sources"
            title="Add a folder"
            sub="Pick another drive or directory to scan."
            onClick={() => onNavigate("sources")}
          />
          <QuickLink
            eyebrow="Uploads"
            title={counts.failed > 0 ? "Review failures" : "Open queue"}
            sub={counts.failed > 0 ? `${counts.failed.toLocaleString()} failed · tap to retry` : "Live view of every in-flight upload."}
            onClick={() => onNavigate("uploads")}
            tone={counts.failed > 0 ? "warn" : "default"}
          />
          <QuickLink
            eyebrow="Backend indexing"
            title={scanTrigger.state === "running" ? "Triggering…" : "Run a scan"}
            sub="Index recent uploads into Kindred so they appear on the web app."
            onClick={triggerIndex}
            tone="default"
          />
        </section>

        {scanTrigger.state === "done" && scanTrigger.msg && <Alert tone="ok">{scanTrigger.msg}</Alert>}
        {scanTrigger.state === "error" && <Alert tone="error">{scanTrigger.msg}</Alert>}
      </div>
    </div>
  );
}

function QuickLink({
  eyebrow,
  title,
  sub,
  onClick,
  tone = "default",
}: {
  eyebrow: string;
  title: string;
  sub: string;
  onClick: () => void;
  tone?: "default" | "warn";
}) {
  const border = tone === "warn" ? "rgba(168, 74, 29, 0.32)" : "var(--line)";
  return (
    <button
      onClick={onClick}
      className="text-left p-4 rounded-lg"
      style={{
        background: "var(--color-card)",
        border: `1px solid ${border}`,
        boxShadow: "var(--shadow-card)",
        transition: "transform 80ms ease, box-shadow 120ms ease",
      }}
    >
      <div className="h-eyebrow">{eyebrow}</div>
      <div
        className="mt-1"
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 15,
          color: tone === "warn" ? "var(--color-terra)" : "var(--color-ash)",
          letterSpacing: "-0.005em",
        }}
      >
        {title}
      </div>
      <div className="mt-1" style={{ fontSize: 11.5, color: "var(--color-mist)", lineHeight: 1.4 }}>
        {sub}
      </div>
    </button>
  );
}
