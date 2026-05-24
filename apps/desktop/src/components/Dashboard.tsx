import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  api,
  events,
  type Album,
  type FixMetadataResult,
  type ScanProgress,
  type ScanTriggerResponse,
  type SidecarRescanProgress,
  type StatusCounts,
  type UploadEvent,
} from "../lib/tauri";
import { basename, formatBytes, formatDuration } from "../lib/format";
import { FailureList } from "./FailureList";
import { Alert, KindredMark, SectionHeader, StatCard, StatusPill } from "./Primitives";

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
  const [scanTrigger, setScanTrigger] = useState<{
    state: "idle" | "running" | "done" | "error";
    msg?: string;
  }>({ state: "idle" });
  const [sidecarRescan, setSidecarRescan] = useState<{
    state: "idle" | "running" | "done" | "error";
    progress?: SidecarRescanProgress;
    msg?: string;
  }>({ state: "idle" });
  const [fixMeta, setFixMeta] = useState<{
    state: "idle" | "running" | "done" | "error";
    result?: FixMetadataResult;
    msg?: string;
  }>({ state: "idle" });
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
        updateRate(
          c.total_bytes_done,
          c.total_bytes_all - c.total_bytes_done,
          ratePoints,
          setRate,
        );
      } catch (_e) {
        // transient
      }
    };
    tick();
    const i = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, []);

  useEffect(() => {
    const unsubs: Promise<() => void>[] = [];
    unsubs.push(
      events.onUploadEvent((e) => {
        setInFlight((prev) => {
          if (e.kind === "start") return [...prev.filter((x) => x.file_id !== e.file_id), e];
          return prev.filter((x) => x.file_id !== e.file_id);
        });
      }),
    );
    unsubs.push(events.onUploadStarted(() => setRunning(true)));
    unsubs.push(
      events.onUploadStopped(() => {
        setRunning(false);
        setInFlight([]);
      }),
    );
    unsubs.push(events.onScanProgress((p) => setScanState(p)));
    unsubs.push(
      events.onScanComplete((p) => {
        setScanState(p);
        setScanning(false);
      }),
    );
    unsubs.push(
      events.onSidecarRescanProgress((p) =>
        setSidecarRescan((s) => ({ ...s, state: "running", progress: p })),
      ),
    );
    unsubs.push(
      events.onSidecarRescanComplete((p) =>
        setSidecarRescan({
          state: "done",
          progress: p,
          msg: `Found ${p.found.toLocaleString()} sidecars across ${p.total.toLocaleString()} pending files.`,
        }),
      ),
    );
    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  async function pickAndScan() {
    setError(null);
    const path = await open({ directory: true, multiple: false });
    if (!path || typeof path !== "string") return;
    setScanning(true);
    setScanState({ scanned: 0, queued: 0, skipped: 0, sidecars: 0, current_dir: path });
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
    if (
      !confirm(
        "Clear all queued files? Files already uploaded to Flickr stay there; this just resets the local queue.",
      )
    ) {
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
        msg:
          res.count > 0
            ? `Indexing started for ${res.count.toLocaleString()} photos${res.job_id ? ` (job ${res.job_id.slice(0, 8)})` : ""}.`
            : res.message || "Indexing started.",
      });
    } catch (e) {
      setScanTrigger({ state: "error", msg: String(e) });
    }
  }

  async function runSidecarRescan() {
    setSidecarRescan({ state: "running" });
    try {
      await api.rescanSidecars();
    } catch (e) {
      setSidecarRescan({ state: "error", msg: String(e) });
    }
  }

  async function runFixMetadata() {
    setFixMeta({ state: "running" });
    try {
      const res = await api.fixExistingMetadata();
      setFixMeta({
        state: "done",
        result: res,
        msg: `Applied metadata to ${res.applied.toLocaleString()} of ${res.total.toLocaleString()} already-uploaded photos${res.failed > 0 ? ` (${res.failed} failed)` : ""}.`,
      });
    } catch (e) {
      setFixMeta({ state: "error", msg: String(e) });
    }
  }

  const total = counts.pending + counts.uploading + counts.done + counts.failed;
  const pctBytes =
    counts.total_bytes_all > 0
      ? Math.min(100, (counts.total_bytes_done / counts.total_bytes_all) * 100)
      : 0;

  const statusTone = running ? "ember" : counts.pending > 0 ? "muted" : "forest";
  const statusLabel = running
    ? "Uploading"
    : counts.pending > 0
      ? "Paused"
      : counts.done > 0
        ? "Up to date"
        : "Ready";

  return (
    <div className="min-h-full" style={{ background: "var(--color-paper)" }}>
      {/* Titlebar */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-5"
        style={{
          height: 56,
          background: "linear-gradient(180deg, var(--color-card), var(--color-paper))",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <KindredMark size={18} />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 14.5,
              color: "var(--color-ash)",
              letterSpacing: "-0.005em",
            }}
          >
            Kindred Backup
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill tone={statusTone} pulse={running}>
            {statusLabel}
          </StatusPill>
          <button onClick={onOpenSettings} className="btn-ghost">
            Settings
          </button>
        </div>
      </header>

      <div className="max-w-[1040px] mx-auto px-6 py-7 space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        {/* ── Hero status card ──────────────────────────────────── */}
        <section className="hero-card p-6 relative">
          <div className="hero-glow" />
          <div className="relative">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1 min-w-0">
                <div className="h-eyebrow">
                  {running ? "Currently uploading" : counts.pending > 0 ? "Queue" : "All clear"}
                </div>
                <div
                  className="mt-2"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: 26,
                    letterSpacing: "-0.01em",
                    color: "var(--color-ash)",
                  }}
                >
                  {running ? (
                    <>
                      Uploading <b style={{ color: "var(--color-ember)" }}>{counts.done.toLocaleString()}</b>{" "}
                      of {total.toLocaleString()}
                    </>
                  ) : counts.pending > 0 ? (
                    <>
                      <b style={{ color: "var(--color-ember)" }}>{counts.pending.toLocaleString()}</b> photos
                      waiting to upload
                    </>
                  ) : counts.done > 0 ? (
                    <>
                      <b>{counts.done.toLocaleString()}</b> photos backed up
                    </>
                  ) : (
                    "Pick a folder to begin"
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!running ? (
                  <button
                    onClick={startUpload}
                    disabled={counts.pending === 0}
                    className="btn-primary"
                    style={{ fontSize: 13 }}
                  >
                    {counts.pending > 0 ? "Start backing up →" : "Nothing queued"}
                  </button>
                ) : (
                  <button onClick={stopUpload} className="btn-secondary">
                    Stop after in-flight
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            {counts.total_bytes_all > 0 && (
              <div className="mt-5">
                <div
                  className="flex justify-between mb-1.5"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-mist)" }}
                >
                  <span>
                    {formatBytes(counts.total_bytes_done)} of {formatBytes(counts.total_bytes_all)}
                  </span>
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

            {/* Stat strip */}
            <div className="grid grid-cols-4 gap-3 mt-5">
              <StatCard
                label="Done"
                value={counts.done.toLocaleString()}
                tone="forest"
                sub={counts.done > 0 ? `${formatBytes(counts.total_bytes_done)} uploaded` : undefined}
              />
              <StatCard label="Pending" value={counts.pending.toLocaleString()} tone="ash" />
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
              />
            </div>

            {/* In-flight list */}
            {inFlight.length > 0 && (
              <div className="mt-5">
                <div className="h-eyebrow mb-2">In flight</div>
                <div className="space-y-1.5">
                  {inFlight.slice(0, 6).map((f) => (
                    <div
                      key={f.file_id}
                      className="flex items-center gap-2"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}
                    >
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full pulse-dot-ember"
                        style={{ background: "var(--color-ember)" }}
                      />
                      <code
                        className="truncate"
                        style={{ color: "var(--color-pine)" }}
                        title={f.path}
                      >
                        {basename(f.path)}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Source ────────────────────────────────────────────── */}
        <section className="card-pad space-y-4">
          <SectionHeader
            eyebrow="Source"
            title="Pick a folder to scan"
            action={
              <button onClick={pickAndScan} disabled={scanning} className="btn-primary">
                {scanning ? "Scanning…" : "Pick folder & scan"}
              </button>
            }
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block">
                <span
                  className="block mb-1.5"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--color-mist)",
                  }}
                >
                  Add uploaded photos to album
                </span>
                <select
                  className="input"
                  value={selectedAlbumId}
                  onChange={(e) => setSelectedAlbumId(e.target.value)}
                  disabled={albumsLoading}
                >
                  <option value="">— No album —</option>
                  {(albums ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} ({a.photo_count.toLocaleString()})
                    </option>
                  ))}
                </select>
              </label>
              {albumsError && (
                <div
                  className="mt-1.5"
                  style={{ fontSize: 11, color: "var(--color-rosehip)" }}
                >
                  Could not load albums: {albumsError}
                </div>
              )}
            </div>
            <div className="flex items-end">
              <button onClick={refreshAlbums} disabled={albumsLoading} className="btn-secondary">
                {albumsLoading ? "Refreshing…" : "Refresh albums"}
              </button>
            </div>
          </div>

          {scanState && (
            <div
              className="grid grid-cols-4 gap-3 pt-3"
              style={{ borderTop: "1px solid var(--line)" }}
            >
              <StatCard label="Seen" value={scanState.scanned.toLocaleString()} tone="muted" />
              <StatCard label="Queued" value={scanState.queued.toLocaleString()} tone="ember" />
              <StatCard label="Skipped" value={scanState.skipped.toLocaleString()} tone="muted" />
              <StatCard
                label="With sidecars"
                value={scanState.sidecars.toLocaleString()}
                tone={scanState.sidecars > 0 ? "forest" : "muted"}
              />
            </div>
          )}
          {scanState && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-mist)",
              }}
            >
              {scanning ? "Scanning " : "Last scan: "}
              <code style={{ color: "var(--color-pine)" }}>{scanState.current_dir}</code>
            </div>
          )}

          <div
            style={{ fontSize: 11.5, color: "var(--color-mist)", lineHeight: 1.5 }}
          >
            Uploads are <b style={{ color: "var(--color-forest)" }}>private</b> — never visible to
            family, friends, or public. Supports JPEG, PNG, GIF, BMP, TIFF, WebP, HEIC and most video
            formats up to 1 GB.
          </div>
        </section>

        {/* ── Google Takeout tools ──────────────────────────────── */}
        <section className="card-pad space-y-4">
          <SectionHeader
            eyebrow="Google Photos Takeout"
            title="Sidecar metadata tools"
          />
          <p
            style={{ fontSize: 12.5, color: "var(--color-pine)", lineHeight: 1.5 }}
          >
            Each photo from Google Takeout has a sibling{" "}
            <code style={{ fontSize: 11, color: "var(--color-ember)" }}>
              .supplemental-metadata.json
            </code>{" "}
            with the original capture date, GPS, and caption. The scanner pairs them automatically
            on new scans. Use these tools to backfill sidecars on existing queue rows, or to fix
            dates on photos that were uploaded before sidecar support was added.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={runSidecarRescan}
              disabled={sidecarRescan.state === "running"}
              className="btn-secondary"
            >
              {sidecarRescan.state === "running"
                ? sidecarRescan.progress
                  ? `Scanning ${sidecarRescan.progress.checked.toLocaleString()}/${sidecarRescan.progress.total.toLocaleString()}…`
                  : "Scanning…"
                : "Rescan sidecars on pending queue"}
            </button>
            <button
              onClick={runFixMetadata}
              disabled={fixMeta.state === "running" || counts.done === 0}
              className="btn-secondary"
            >
              {fixMeta.state === "running" ? "Applying…" : "Fix dates on already-uploaded photos"}
            </button>
          </div>
          {sidecarRescan.state === "done" && sidecarRescan.msg && (
            <Alert tone="ok">{sidecarRescan.msg}</Alert>
          )}
          {sidecarRescan.state === "error" && <Alert tone="error">{sidecarRescan.msg}</Alert>}
          {fixMeta.state === "done" && fixMeta.msg && <Alert tone="ok">{fixMeta.msg}</Alert>}
          {fixMeta.state === "error" && <Alert tone="error">{fixMeta.msg}</Alert>}
        </section>

        {/* ── Backend indexing ──────────────────────────────────── */}
        <section className="card-pad space-y-4">
          <SectionHeader eyebrow="Backend indexing" title="Make photos searchable on Kindred" />
          <p style={{ fontSize: 12.5, color: "var(--color-pine)", lineHeight: 1.5 }}>
            Uploads skip per-photo ML for speed. After photos are in Flickr, trigger a backend scan
            to index them into Kindred's database so they appear on the website with face
            recognition + search.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={triggerIndex}
              disabled={
                scanTrigger.state === "running" || (counts.done === 0 && counts.pending === 0)
              }
              className="btn-secondary"
            >
              {scanTrigger.state === "running" ? "Triggering…" : "Trigger backend scan"}
            </button>
            {running && counts.pending > 0 && (
              <span style={{ fontSize: 11.5, color: "var(--color-terra)" }}>
                Tip: wait until uploads finish so the scan covers everything.
              </span>
            )}
          </div>
          {scanTrigger.state === "done" && scanTrigger.msg && <Alert tone="ok">{scanTrigger.msg}</Alert>}
          {scanTrigger.state === "error" && <Alert tone="error">{scanTrigger.msg}</Alert>}
        </section>

        {/* ── Failures ──────────────────────────────────────────── */}
        <section className="card-pad space-y-4">
          <button
            onClick={() => setShowFailures((v) => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <div>
              <div className="h-eyebrow">Failures</div>
              <h2
                className="h-display mt-1"
                style={{ fontSize: 18, lineHeight: 1.2 }}
              >
                {counts.failed.toLocaleString()}{" "}
                <span style={{ color: "var(--color-mist)", fontWeight: 400 }}>
                  photo{counts.failed === 1 ? "" : "s"} failed
                </span>
              </h2>
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--color-mist)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              {showFailures ? "Hide" : "Show"}
            </span>
          </button>
          {showFailures && <FailureList />}
        </section>

        <div
          className="flex items-center justify-between pt-4 pb-2"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-muted)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          <span>
            {total > 0
              ? `${total.toLocaleString()} files in queue · saved between sessions`
              : "Queue is empty"}
          </span>
          {total > 0 && (
            <button
              onClick={clearQueue}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--color-rosehip)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                background: "transparent",
                border: "none",
              }}
            >
              Reset queue
            </button>
          )}
        </div>
      </div>
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
