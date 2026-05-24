import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, events, type Album, type ScanProgress, type ScanTriggerResponse, type StatusCounts, type UploadEvent } from "../lib/tauri";
import { basename, formatBytes, formatDuration } from "../lib/format";
import { FailureList } from "./FailureList";

type Props = {
  onOpenSettings: () => void;
};

export function Dashboard({ onOpenSettings }: Props) {
  const [counts, setCounts] = useState<StatusCounts>({
    pending: 0,
    uploading: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    total_bytes_done: 0,
    total_bytes_all: 0,
  });
  const [running, setRunning] = useState(false);
  const [scanState, setScanState] = useState<ScanProgress | null>(null);
  const [scanning, setScanning] = useState(false);
  const [inFlight, setInFlight] = useState<UploadEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showFailures, setShowFailures] = useState(false);
  const [rate, setRate] = useState<{ bps: number; eta: number }>({ bps: 0, eta: Infinity });
  const ratePoints = useRef<{ t: number; bytes: number }[]>([]);
  const [scanTrigger, setScanTrigger] = useState<{ state: "idle" | "running" | "done" | "error"; msg?: string }>({ state: "idle" });
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsError, setAlbumsError] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>("");

  async function refreshAlbums() {
    setAlbumsLoading(true);
    setAlbumsError(null);
    try {
      const list = await api.listAlbums();
      list.sort((a, b) => a.title.localeCompare(b.title));
      setAlbums(list);
    } catch (e) {
      setAlbumsError(String(e));
      setAlbums([]);
    } finally {
      setAlbumsLoading(false);
    }
  }

  useEffect(() => {
    refreshAlbums();
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [c, r] = await Promise.all([api.getStatus(), api.isRunning()]);
        if (!alive) return;
        setCounts(c);
        setRunning(r);
        updateRate(c.total_bytes_done, c.total_bytes_all - c.total_bytes_done, ratePoints, setRate);
      } catch (e) {
        // ignore transient errors
      }
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, []);

  useEffect(() => {
    const unsubs: Promise<() => void>[] = [];
    unsubs.push(events.onUploadEvent((e) => {
      setInFlight((prev) => {
        if (e.kind === "start") {
          return [...prev.filter((x) => x.file_id !== e.file_id), e];
        }
        return prev.filter((x) => x.file_id !== e.file_id);
      });
    }));
    unsubs.push(events.onUploadStarted(() => setRunning(true)));
    unsubs.push(events.onUploadStopped(() => {
      setRunning(false);
      setInFlight([]);
    }));
    unsubs.push(events.onScanProgress((p) => setScanState(p)));
    unsubs.push(events.onScanComplete((p) => {
      setScanState(p);
      setScanning(false);
    }));
    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  async function pickAndScan() {
    setError(null);
    const path = await open({ directory: true, multiple: false });
    if (!path || typeof path !== "string") return;
    setScanning(true);
    setScanState({ scanned: 0, queued: 0, skipped: 0, current_dir: path });
    try {
      await api.startScan(path, selectedAlbumId || null);
    } catch (e) {
      setError(String(e));
      setScanning(false);
    }
  }

  async function startUpload() {
    setError(null);
    try {
      await api.startUpload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function stopUpload() {
    try {
      await api.stopUpload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function clearQueue() {
    if (!confirm("Clear all queued files? Files already uploaded to Flickr stay there; this just resets the local queue.")) {
      return;
    }
    try {
      await api.clearQueue();
    } catch (e) {
      setError(String(e));
    }
  }

  async function triggerIndex() {
    setScanTrigger({ state: "running" });
    setError(null);
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

  const total = counts.pending + counts.uploading + counts.done + counts.failed;
  const doneBytes = counts.total_bytes_done;
  const totalBytes = counts.total_bytes_all;
  const pctBytes = totalBytes > 0 ? Math.min(100, (doneBytes / totalBytes) * 100) : 0;

  return (
    <div className="min-h-full p-6 space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Kindred Uploader</h1>
          <p className="text-xs text-ink-500">Bulk-upload a folder of photos to Flickr via Kindred.</p>
        </div>
        <button onClick={onOpenSettings} className="btn-ghost">Settings</button>
      </header>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="card">
        <h2 className="card-title">Source</h2>

        <div className="mt-3 flex items-end gap-2 flex-wrap">
          <label className="flex-1 min-w-[240px]">
            <span className="block text-xs text-ink-500 mb-1">Add uploaded photos to album</span>
            <select
              className="input"
              value={selectedAlbumId}
              onChange={(e) => setSelectedAlbumId(e.target.value)}
              disabled={albumsLoading}
            >
              <option value="">— No album (just upload) —</option>
              {(albums ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} ({a.photo_count.toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          <button onClick={refreshAlbums} disabled={albumsLoading} className="btn-ghost">
            {albumsLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {albumsError && (
          <p className="text-xs text-amber-700 mt-1">
            Could not load albums: {albumsError}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button onClick={pickAndScan} disabled={scanning} className="btn-primary">
            {scanning ? "Scanning…" : "Pick a folder and scan"}
          </button>
          {scanState && (
            <div className="text-xs text-ink-500 truncate flex-1">
              {scanning ? "Scanning " : "Last scan: "}
              <code className="text-ink-700">{scanState.current_dir}</code>
            </div>
          )}
        </div>
        {scanState && (
          <div className="mt-3 text-sm text-ink-700 flex gap-4">
            <span><b>{scanState.scanned.toLocaleString()}</b> files seen</span>
            <span><b>{scanState.queued.toLocaleString()}</b> queued</span>
            <span><b>{scanState.skipped.toLocaleString()}</b> skipped</span>
          </div>
        )}
        <p className="text-xs text-ink-500 mt-2">
          Uploads are <b>private</b> by default — not visible to family, friends, or public.
          Supports JPEG, PNG, GIF, BMP, TIFF, WebP, HEIC, and videos (MP4, MOV, M4V, AVI, WMV, MPEG, 3GP, M2TS, OGG).
          Max 1 GB per file.
        </p>
      </section>

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Queue</h2>
          <div className="flex gap-2">
            {!running ? (
              <button
                onClick={startUpload}
                disabled={counts.pending === 0}
                className="btn-primary"
              >
                Start upload
              </button>
            ) : (
              <button onClick={stopUpload} className="btn-secondary">
                Stop after in-flight
              </button>
            )}
            <button onClick={clearQueue} className="btn-ghost">Clear</button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mt-4">
          <Stat label="Done" value={counts.done.toLocaleString()} tone="ok" />
          <Stat label="Pending" value={counts.pending.toLocaleString()} />
          <Stat label="Uploading" value={counts.uploading.toLocaleString()} tone="active" />
          <Stat label="Failed" value={counts.failed.toLocaleString()} tone={counts.failed > 0 ? "warn" : undefined} />
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-xs text-ink-500 mb-1">
            <span>{formatBytes(doneBytes)} of {formatBytes(totalBytes)}</span>
            <span>
              {running ? `${formatBytes(rate.bps)}/s · ETA ${formatDuration(rate.eta)}` : `${total.toLocaleString()} files`}
            </span>
          </div>
          <div className="h-2 bg-ink-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${pctBytes}%` }}
            />
          </div>
        </div>

        {inFlight.length > 0 && (
          <div className="mt-4 space-y-1">
            <div className="text-xs font-medium text-ink-500">In flight</div>
            {inFlight.slice(0, 6).map((f) => (
              <div key={f.file_id} className="text-xs flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <code className="truncate text-ink-700">{basename(f.path)}</code>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Backend indexing</h2>
        <p className="text-xs text-ink-500 mt-1">
          Uploads skip per-photo ML so the bulk run stays fast. After photos are in Flickr,
          trigger a backend scan to index them into Kindred so they appear on the website.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={triggerIndex}
            disabled={scanTrigger.state === "running" || (counts.done === 0 && counts.pending === 0)}
            className="btn-secondary"
          >
            {scanTrigger.state === "running" ? "Triggering…" : "Trigger backend scan"}
          </button>
          {running && counts.pending > 0 && (
            <span className="text-xs text-amber-700">
              Tip: wait until uploads finish so the scan covers everything.
            </span>
          )}
        </div>
        {scanTrigger.state === "done" && (
          <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
            {scanTrigger.msg}
          </div>
        )}
        {scanTrigger.state === "error" && (
          <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
            {scanTrigger.msg}
          </div>
        )}
      </section>

      <section className="card">
        <button
          onClick={() => setShowFailures((v) => !v)}
          className="card-title w-full text-left flex items-center justify-between"
        >
          <span>Failures ({counts.failed.toLocaleString()})</span>
          <span className="text-xs text-ink-500">{showFailures ? "hide" : "show"}</span>
        </button>
        {showFailures && <FailureList />}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "active";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "active"
          ? "text-blue-700"
          : "text-ink-900";
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function updateRate(
  doneBytes: number,
  remainingBytes: number,
  pointsRef: React.MutableRefObject<{ t: number; bytes: number }[]>,
  setRate: (r: { bps: number; eta: number }) => void,
) {
  const now = Date.now();
  pointsRef.current.push({ t: now, bytes: doneBytes });
  // keep last 30 seconds
  pointsRef.current = pointsRef.current.filter((p) => now - p.t < 30_000);
  if (pointsRef.current.length < 2) {
    setRate({ bps: 0, eta: Infinity });
    return;
  }
  const oldest = pointsRef.current[0];
  const elapsed = (now - oldest.t) / 1000;
  if (elapsed < 0.5) return;
  const delta = doneBytes - oldest.bytes;
  const bps = delta / elapsed;
  const eta = bps > 0 ? remainingBytes / bps : Infinity;
  setRate({ bps, eta });
}
