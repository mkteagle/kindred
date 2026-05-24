import { useAppState } from "../lib/appState";
import { basename } from "../lib/format";
import { StatCard } from "../components/Primitives";
import { PageHeader } from "../components/PageHeader";

export function IndexerPage() {
  const { scanState, scanning } = useAppState();

  return (
    <div>
      <PageHeader
        title="Indexer"
        subtitle={scanning ? "Walking the drive for photos…" : "Idle — start a scan from Sources."}
      />

      <div className="px-7 py-6 space-y-6 max-w-[1040px]">
        {/* Live counters */}
        <section className="grid grid-cols-4 gap-3">
          <StatCard
            label="Files seen"
            value={(scanState?.scanned ?? 0).toLocaleString()}
            tone="ash"
          />
          <StatCard
            label="New · queued"
            value={(scanState?.queued ?? 0).toLocaleString()}
            tone="ember"
            sub={scanState && scanState.queued > 0 ? "Added to the upload queue" : undefined}
          />
          <StatCard
            label="With sidecars"
            value={(scanState?.sidecars ?? 0).toLocaleString()}
            tone="forest"
            sub="Google Takeout metadata paired"
          />
          <StatCard
            label="Skipped"
            value={(scanState?.skipped ?? 0).toLocaleString()}
            tone="muted"
            sub="Unsupported extensions"
          />
        </section>

        {/* Current scan strip */}
        <section className="card-pad">
          <div className="h-eyebrow">Current scan</div>
          {scanState ? (
            <>
              <div
                className="mt-2 truncate"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 16,
                  color: "var(--color-ash)",
                  letterSpacing: "-0.005em",
                }}
                title={scanState.current_dir}
              >
                {scanning ? "Scanning " : "Last scanned "}
                <code
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 500,
                    fontSize: 13,
                    color: "var(--color-pine)",
                  }}
                >
                  {basename(scanState.current_dir) || scanState.current_dir}
                </code>
              </div>
              <div
                className="mt-1"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--color-mist)",
                  wordBreak: "break-all",
                }}
              >
                {scanState.current_dir}
              </div>
              {scanning && (
                <div className="mt-4">
                  <div
                    className="flex justify-between mb-1.5"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-mist)" }}
                  >
                    <span>{scanState.scanned.toLocaleString()} files seen</span>
                    <span>working…</span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-bar"
                      style={{ width: "100%", animation: "pulse-shimmer 2s ease-in-out infinite" }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <p
              className="mt-2"
              style={{ fontSize: 12.5, color: "var(--color-mist)", lineHeight: 1.5 }}
            >
              No scan has been run yet. Head to <b>Sources</b> to pick a folder. The scanner walks
              your drive, pairs each photo with its Google Takeout sidecar (if present), and queues
              them for upload.
            </p>
          )}
        </section>

        {/* What scanner handles */}
        <section className="card-pad">
          <div className="h-eyebrow">Supported file types</div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "var(--color-pine)",
                }}
              >
                Images
              </div>
              <div
                className="mt-1.5"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  color: "var(--color-ash)",
                  lineHeight: 1.6,
                }}
              >
                jpg · jpeg · png · gif · bmp · tif · tiff · webp · heic · heif
              </div>
            </div>
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "var(--color-pine)",
                }}
              >
                Videos
              </div>
              <div
                className="mt-1.5"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  color: "var(--color-ash)",
                  lineHeight: 1.6,
                }}
              >
                mp4 · mov · m4v · m4p · avi · wmv · mpeg · mpg · 3gp · m2ts · ogg · ogv
              </div>
            </div>
          </div>
          <div
            className="mt-4"
            style={{ fontSize: 11.5, color: "var(--color-mist)", lineHeight: 1.4 }}
          >
            RAW formats (DNG · CR2 · NEF · ARW etc.) are intentionally skipped — Flickr rejects
            them. Each file is capped at 1 GB.
          </div>
        </section>
      </div>
    </div>
  );
}
