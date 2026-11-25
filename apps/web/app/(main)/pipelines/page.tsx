"use client";

import Link from "next/link";
import { KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";
import { usePipelines, type Pipeline } from "@/components/kx/use-library";
import { useUser } from "@/lib/use-user";

const fmt = new Intl.NumberFormat("en-GB");
const phaseLabels: Record<string, string> = {
  caught_up: "caught up",
  checking_completion: "checking completion",
  counting_thumbnails: "counting thumbnails",
  reading_flickr: "reading Flickr inventory",
  restoring_flickr_albums: "restoring Flickr albums",
  preparing_nas_catalog: "preparing NAS lookup",
  needs_review: "review required",
  reconciliation_needed: "review required",
  queued: "queued",
  failed: "worker stopped",
  retrying: "waiting to retry",
  stopped: "stopped",
  waiting_for_discovery: "waiting for discovery",
  waiting_for_previews: "waiting for thumbnails",
  waiting_for_capacity: "waiting for NAS capacity",
  waiting_for_categorization_retry: "waiting for the next retry",
  waiting_for_flickr_batch: "pausing between Flickr download batches",
  waiting_for_flickr_downloads: "Flickr is limiting original downloads",
  waiting_for_flickr_match: "waiting for Flickr comparison",
};

/** "measured 4 minutes ago" — a cached total should say how old it is. */
function ago(iso: string | null): string {
  if (!iso) return "";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${(minutes / 60).toFixed(1)} hours ago`;
}

function Bar({ pipeline }: { pipeline: Pipeline }) {
  const { percent, total, done, running, rate_per_minute: rate, eta } = pipeline;
  const r2Publication = pipeline.key === "r2";
  const previewFailures = pipeline.key === "previews" ? (pipeline.failed ?? 0) : 0;

  // Three states worth telling apart, because they mean different things:
  // finished, moving, and awaiting a fresh report. A stalled pipeline that looks like a
  // half-full bar is exactly how the iCloud download went unnoticed.
  const finished = pipeline.complete;
  const state = finished ? "done" : running ? "live" : "idle";
  const activity = [
    percent !== null ? `${percent}%` : "counting total",
    rate ? `${rate.toFixed(0)}/min` : null,
    eta && `${eta} left`,
  ].filter(Boolean).join(" · ");
  const status = finished ? (pipeline.phase === "complete_with_errors" ? "complete with errors" : "complete")
    : pipeline.stale ? "progress update delayed"
    : phaseLabels[pipeline.phase ?? ""] ?? (running ? activity : "no recent progress");

  return (
    <li className="kx-pipeline" data-state={state}>
      <div className="kx-pipeline-head">
        <strong>{pipeline.label}</strong>
        <span className="kx-mono kx-pipeline-count">
          {fmt.format(done + previewFailures)}
          {total !== null && ` / ${fmt.format(total)}`}
          {r2Publication && " uploaded"}
          {!!previewFailures && " checked"}
          {total === null && " · total unknown"}
        </span>
      </div>

      {percent !== null && (
        <div className="kx-pipeline-track" role="progressbar"
          aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={pipeline.label}>
          <span className="kx-pipeline-fill" style={{ width: `${percent}%` }} />
        </div>
      )}

      <div className="kx-pipeline-foot kx-mono">
        <span>{pipeline.detail}</span>
        <span>{status}</span>
      </div>
      {!!pipeline.skipped && (
        <p className="kx-pipeline-stamp kx-mono">
          {fmt.format(done - pipeline.skipped)} photos indexed · {fmt.format(pipeline.skipped)} files skipped for recognition
        </p>
      )}
      {pipeline.measured_at && (
        <p className="kx-pipeline-stamp kx-mono">
          Worker last reported {ago(pipeline.measured_at)}
        </p>
      )}
    </li>
  );
}

export default function PipelinesPage() {
  const { data, error, isPending, refetch } = usePipelines();
  const { isAdmin } = useUser();
  const pipelines = data?.pipelines ?? [];
  const sections = [
    { title: "Running", items: pipelines.filter((pipeline) => pipeline.running && !pipeline.complete) },
    { title: "Waiting and needs review", items: pipelines.filter((pipeline) => !pipeline.running && !pipeline.complete) },
    { title: "Finished", items: pipelines.filter((pipeline) => pipeline.complete) },
  ];

  return (
    <main className="kx-page" style={{ maxWidth: 900 }}>
      <h1 className="kx-title">Indexing progress</h1>
      <p className="kx-lede">
        Live progress for NAS discovery, previews, Flickr backup, and photo indexing.
      </p>

      <p style={{ margin: "12px 0 16px", display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/activity">View filenames and processing timestamps →</Link>
        {isAdmin && <Link href="/pipelines/failures">Categorization failures →</Link>}
        <Link href="/settings/health">Health check →</Link>
      </p>
      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}

      {isPending ? (
        <KxSkeletonRows count={3} height={74} />
      ) : (
        <>
          {sections.filter(({ items }) => items.length).map(({ title, items }) => (
            <section className="kx-pipeline-section" key={title}>
              <h2>{title}</h2>
              <ul className="kx-pipelines">
                {items.map((pipeline) => <Bar key={pipeline.key} pipeline={pipeline} />)}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
