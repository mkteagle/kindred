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
    return <div className="text-xs text-ink-500 mt-3">Loading…</div>;
  }
  if (rows.length === 0) {
    return <div className="text-xs text-ink-500 mt-3">No failures.</div>;
  }
  return (
    <div className="mt-3 space-y-1 max-h-80 overflow-y-auto">
      {rows.map((r) => (
        <div
          key={r.id}
          className="text-xs flex items-center gap-2 border border-ink-200 rounded px-2 py-1.5 bg-white"
        >
          <div className="flex-1 min-w-0">
            <div className="truncate font-medium text-ink-900" title={r.path}>
              {basename(r.path)}
            </div>
            <div className="text-ink-500 truncate" title={r.error ?? ""}>
              {r.error ?? "(no error)"}
            </div>
          </div>
          <div className="text-ink-500 whitespace-nowrap">{formatBytes(r.size_bytes)}</div>
          <div className="text-ink-500 whitespace-nowrap">×{r.attempts}</div>
          <button onClick={() => retry(r.id)} className="btn-ghost text-xs px-2 py-1">
            Retry
          </button>
        </div>
      ))}
    </div>
  );
}
