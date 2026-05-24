import { useEffect, useState } from "react";
import { api, type FileRow } from "../lib/tauri";
import { basename, formatBytes } from "../lib/format";

export function FailureList() {
  const [rows, setRows] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await api.listFailed(100));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 3000);
    return () => clearInterval(i);
  }, []);

  async function retry(id: number) {
    await api.retryFailed(id);
    refresh();
  }

  if (loading && rows.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: "var(--color-mist)" }}>Loading…</div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: "var(--color-mist)" }}>
        No failures. Everything that's gone up so far has stuck.
      </div>
    );
  }
  return (
    <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-3 px-3 py-2 rounded-md"
          style={{
            background: "rgba(154, 52, 22, 0.05)",
            border: "1px solid rgba(154, 52, 22, 0.15)",
          }}
        >
          <div className="flex-1 min-w-0">
            <div
              className="truncate"
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                fontSize: 12,
                color: "var(--color-ash)",
              }}
              title={r.path}
            >
              {basename(r.path)}
            </div>
            <div
              className="truncate"
              style={{
                fontSize: 11,
                color: "var(--color-rosehip)",
                marginTop: 2,
              }}
              title={r.error ?? ""}
            >
              {r.error ?? "(no error)"}
            </div>
          </div>
          <div
            className="whitespace-nowrap"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--color-mist)",
            }}
          >
            {formatBytes(r.size_bytes)}
          </div>
          <div
            className="whitespace-nowrap"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--color-mist)",
            }}
          >
            ×{r.attempts}
          </div>
          <button
            onClick={() => retry(r.id)}
            className="btn-ghost"
            style={{ fontSize: 11, padding: "5px 10px" }}
          >
            Retry
          </button>
        </div>
      ))}
    </div>
  );
}
