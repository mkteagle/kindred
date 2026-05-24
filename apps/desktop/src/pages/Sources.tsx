import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppState } from "../lib/appState";
import { api, type Album, type FixMetadataResult, type SidecarRescanProgress } from "../lib/tauri";
import { events } from "../lib/tauri";
import { Alert, StatCard } from "../components/Primitives";
import { PageHeader } from "../components/PageHeader";

export function SourcesPage() {
  const { scanState, scanning, setScanState, setScanning, setError, error } = useAppState();
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsError, setAlbumsError] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>("");

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
    const unsubs: Promise<() => void>[] = [];
    unsubs.push(events.onSidecarRescanProgress((p) =>
      setSidecarRescan((s) => ({ ...s, state: "running", progress: p })),
    ));
    unsubs.push(events.onSidecarRescanComplete((p) =>
      setSidecarRescan({
        state: "done",
        progress: p,
        msg: `Found ${p.found.toLocaleString()} sidecars across ${p.total.toLocaleString()} pending files.`,
      }),
    ));
    return () => unsubs.forEach((p) => p.then((fn) => fn()));
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

  return (
    <div>
      <PageHeader
        title="Sources"
        subtitle="Pick a folder, optionally route into a Flickr album, and tools for Google Takeout sidecars."
        actions={
          <button onClick={pickAndScan} disabled={scanning} className="btn-primary">
            {scanning ? "Scanning…" : "+ Add folder"}
          </button>
        }
      />

      <div className="px-7 py-6 space-y-6 max-w-[1040px]">
        {error && <Alert tone="error">{error}</Alert>}

        {/* Folder + album picker card */}
        <section className="card-pad space-y-4">
          <div className="h-eyebrow">Next scan</div>

          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
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
                Route uploads into Flickr album
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
            <button onClick={refreshAlbums} disabled={albumsLoading} className="btn-secondary">
              {albumsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {albumsError && (
            <div style={{ fontSize: 11.5, color: "var(--color-rosehip)" }}>
              Could not load albums: {albumsError}
            </div>
          )}

          {/* Drop-target style block */}
          <div
            onClick={pickAndScan}
            className="rounded-lg cursor-pointer text-center"
            style={{
              border: "1.5px dashed var(--line-dark)",
              background: "rgba(233, 184, 93, 0.06)",
              padding: "24px 20px",
              transition: "background 120ms ease, border-color 120ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(201, 85, 28, 0.06)";
              e.currentTarget.style.borderColor = "var(--color-ember)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(233, 184, 93, 0.06)";
              e.currentTarget.style.borderColor = "var(--line-dark)";
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 15,
                color: "var(--color-ember)",
              }}
            >
              + Pick a folder to scan
            </div>
            <div
              className="mt-1"
              style={{ fontSize: 12, color: "var(--color-mist)", lineHeight: 1.4 }}
            >
              Treats the source as read-only. Uploads are private; Google Takeout sidecars are paired automatically.
            </div>
          </div>

          {/* Live scan stats */}
          {scanState && (
            <div className="grid grid-cols-4 gap-3 pt-1">
              <StatCard label="Seen" value={scanState.scanned.toLocaleString()} tone="muted" />
              <StatCard label="Queued" value={scanState.queued.toLocaleString()} tone="ember" />
              <StatCard label="Skipped" value={scanState.skipped.toLocaleString()} tone="muted" />
              <StatCard label="Sidecars" value={scanState.sidecars.toLocaleString()} tone={scanState.sidecars > 0 ? "forest" : "muted"} />
            </div>
          )}
          {scanState && (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-mist)" }}>
              {scanning ? "Scanning " : "Last scan: "}
              <code style={{ color: "var(--color-pine)" }}>{scanState.current_dir}</code>
            </div>
          )}
        </section>

        {/* Google Takeout */}
        <section className="card-pad space-y-3">
          <div className="h-eyebrow">Google Photos Takeout sidecars</div>
          <p style={{ fontSize: 12.5, color: "var(--color-pine)", lineHeight: 1.5 }}>
            Each photo from Google Takeout has a sibling{" "}
            <code style={{ fontSize: 11, color: "var(--color-ember)" }}>
              .supplemental-metadata.json
            </code>{" "}
            with the original capture date, GPS, and caption. The scanner pairs them automatically
            on fresh scans. These tools backfill sidecars onto rows from older scans, or fix dates
            on photos that were uploaded before sidecar support existed.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={runSidecarRescan} disabled={sidecarRescan.state === "running"} className="btn-secondary">
              {sidecarRescan.state === "running"
                ? sidecarRescan.progress
                  ? `Scanning ${sidecarRescan.progress.checked.toLocaleString()}/${sidecarRescan.progress.total.toLocaleString()}…`
                  : "Scanning…"
                : "Rescan sidecars on pending queue"}
            </button>
            <button onClick={runFixMetadata} disabled={fixMeta.state === "running"} className="btn-secondary">
              {fixMeta.state === "running" ? "Applying…" : "Fix dates on already-uploaded photos"}
            </button>
          </div>
          {sidecarRescan.state === "done" && sidecarRescan.msg && <Alert tone="ok">{sidecarRescan.msg}</Alert>}
          {sidecarRescan.state === "error" && <Alert tone="error">{sidecarRescan.msg}</Alert>}
          {fixMeta.state === "done" && fixMeta.msg && <Alert tone="ok">{fixMeta.msg}</Alert>}
          {fixMeta.state === "error" && <Alert tone="error">{fixMeta.msg}</Alert>}
        </section>
      </div>
    </div>
  );
}
