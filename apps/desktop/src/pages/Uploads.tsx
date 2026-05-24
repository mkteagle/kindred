import { useEffect, useState } from "react";
import { useAppState } from "../lib/appState";
import { api, type FileRow } from "../lib/tauri";
import { basename, formatBytes } from "../lib/format";
import { Alert, StatCard } from "../components/Primitives";
import { PageHeader } from "../components/PageHeader";

export function UploadsPage() {
  const { counts, inFlight, running, startUpload, stopUpload } = useAppState();
  const [failures, setFailures] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setFailures(await api.listFailed(200));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 3000);
    return () => clearInterval(i);
  }, []);

  async function retryOne(id: number) {
    setBusyId(id);
    try {
      await api.retryFailed(id);
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function retryAll() {
    for (const f of failures) {
      await api.retryFailed(f.id);
    }
    refresh();
  }

  return (
    <div>
      <PageHeader
        title="Uploads"
        subtitle={`${(counts.pending + counts.uploading).toLocaleString()} in queue · ${counts.done.toLocaleString()} done · ${counts.failed.toLocaleString()} failed`}
        actions={
          <>
            {failures.length > 0 && (
              <button onClick={retryAll} className="btn-ghost">
                Retry all failed
              </button>
            )}
            {!running ? (
              <button onClick={startUpload} disabled={counts.pending === 0} className="btn-primary">
                Resume uploads
              </button>
            ) : (
              <button onClick={stopUpload} className="btn-secondary">
                Pause uploads
              </button>
            )}
          </>
        }
      />

      <div className="px-7 py-6 space-y-6 max-w-[1040px]">
        {/* Counters */}
        <section className="grid grid-cols-4 gap-3">
          <StatCard label="In flight" value={counts.uploading.toLocaleString()} tone="ember" sub={running ? "Live" : "Idle"} />
          <StatCard label="Queued" value={counts.pending.toLocaleString()} tone="ash" />
          <StatCard label="Done" value={counts.done.toLocaleString()} tone="forest" />
          <StatCard label="Failed" value={counts.failed.toLocaleString()} tone={counts.failed > 0 ? "rosehip" : "muted"} />
        </section>

        {/* In-flight */}
        <section className="card-pad">
          <div className="h-eyebrow">In flight</div>
          {inFlight.length === 0 ? (
            <p className="mt-2" style={{ fontSize: 12.5, color: "var(--color-mist)" }}>
              {running ? "Spooling up the next batch…" : "Not currently uploading. Hit Resume to start."}
            </p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {inFlight.map((f) => (
                <div key={f.file_id} className="flex items-center gap-3 px-3 py-2 rounded-md" style={{ background: "rgba(201, 85, 28, 0.04)", border: "1px solid var(--line)" }}>
                  <span className="inline-block w-2 h-2 rounded-full pulse-dot-ember shrink-0" style={{ background: "var(--color-ember)" }} />
                  <code className="flex-1 truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-ash)" }} title={f.path}>
                    {basename(f.path)}
                  </code>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-mist)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    Uploading
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Failures */}
        <section className="card-pad">
          <div className="flex items-end justify-between">
            <div>
              <div className="h-eyebrow">Failures</div>
              <h2 className="h-display mt-1" style={{ fontSize: 18 }}>
                {failures.length.toLocaleString()}{" "}
                <span style={{ color: "var(--color-mist)", fontWeight: 400 }}>
                  showing{failures.length === 100 ? " (latest 100)" : ""}
                </span>
              </h2>
            </div>
            {failures.length > 0 && (
              <button onClick={refresh} className="btn-ghost" disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            )}
          </div>

          {failures.length === 0 ? (
            <Alert tone="ok">
              No failures. Everything that's gone up so far has stuck.
            </Alert>
          ) : (
            <div className="mt-4 space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
              {failures.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md"
                  style={{
                    background: "rgba(154, 52, 22, 0.05)",
                    border: "1px solid rgba(154, 52, 22, 0.15)",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate" style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12, color: "var(--color-ash)" }} title={r.path}>
                      {basename(r.path)}
                    </div>
                    <div className="truncate" style={{ fontSize: 11, color: "var(--color-rosehip)", marginTop: 2 }} title={r.error ?? ""}>
                      {r.error ?? "(no error)"}
                    </div>
                  </div>
                  <div className="whitespace-nowrap" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-mist)" }}>
                    {formatBytes(r.size_bytes)}
                  </div>
                  <div className="whitespace-nowrap" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-mist)" }}>
                    ×{r.attempts}
                  </div>
                  <button
                    onClick={() => retryOne(r.id)}
                    disabled={busyId === r.id}
                    className="btn-ghost"
                    style={{ fontSize: 11, padding: "5px 10px" }}
                  >
                    {busyId === r.id ? "…" : "Retry"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
