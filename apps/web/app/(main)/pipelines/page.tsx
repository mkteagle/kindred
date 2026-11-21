"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BACKEND } from "@/lib/constants";
import { KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";

interface Pipeline {
  key: string;
  label: string;
  detail: string;
  done: number;
  total: number | null;
  percent: number | null;
  remaining: number | null;
  running: boolean;
  rate_per_minute: number | null;
  eta: string;
  measured_at: string | null;
  phase?: string;
  stale?: boolean;
}

const fmt = new Intl.NumberFormat("en-GB");

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
  const unknown = percent === null;

  // Three states worth telling apart, because they mean different things:
  // finished, moving, and awaiting a fresh report. A stalled pipeline that looks like a
  // half-full bar is exactly how the iCloud download went unnoticed.
  const finished = total !== null && done >= total && total > 0;
  const state = finished ? "done" : running ? "live" : "idle";

  return (
    <li className="kx-pipeline" data-state={state}>
      <div className="kx-pipeline-head">
        <strong>{pipeline.label}</strong>
        <span className="kx-mono kx-pipeline-count">
          {fmt.format(done)}
          {total !== null && ` / ${fmt.format(total)}`}
          {unknown && total === null && " · total unknown"}
        </span>
      </div>

      <div
        className={`kx-pipeline-track ${unknown ? "indeterminate" : ""}`.trim()}
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={pipeline.label}
      >
        <span className="kx-pipeline-fill" style={unknown ? undefined : { width: `${percent}%` }} />
      </div>

      <div className="kx-pipeline-foot kx-mono">
        <span>{pipeline.detail}</span>
        <span>
          {finished
            ? "complete"
            : pipeline.phase === "waiting_for_discovery"
              ? "waiting for discovery"
            : pipeline.phase === "waiting_for_previews"
              ? "waiting for thumbnails"
            : pipeline.phase === "waiting_for_capacity"
              ? "waiting for NAS capacity"
            : pipeline.stale
              ? "progress update delayed"
            : state === "idle"
              ? "no recent progress"
              : [
                  percent !== null && `${percent}%`,
                  rate ? `${rate.toFixed(0)}/min` : null,
                  eta && `${eta} left`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
        </span>
      </div>
      {pipeline.measured_at && (
        <p className="kx-pipeline-stamp kx-mono">
          Worker last reported {ago(pipeline.measured_at)}
        </p>
      )}
    </li>
  );
}

export default function PipelinesPage() {
  const { data, error, isPending, refetch } = useQuery<{ pipelines: Pipeline[] }>({
    queryKey: ["pipelines"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/pipelines`);
      if (!response.ok) throw new Error("Progress could not be read just now.");
      return response.json();
    },
    // The rate is derived from the gap between two readings, so a steady poll
    // is what makes the per-minute figure and the ETA meaningful.
    refetchInterval: 15000,
  });

  return (
    <main className="kx-page" style={{ maxWidth: 900 }}>
      <span className="kx-eyebrow">Operations</span>
      <h1 className="kx-title" style={{ fontSize: 40 }}>
        What the server is doing.
      </h1>
      <p className="kx-lede">
        Current Kindred discovery, previews, and recognition work. Status comes
        from worker heartbeats; retired imports are not shown.
      </p>

      <p style={{ margin: "16px 0 24px" }}><Link href="/activity">View filenames and processing timestamps →</Link></p>
      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}

      {isPending ? (
        <KxSkeletonRows count={3} height={74} />
      ) : (
        <ul className="kx-pipelines">
          {(data?.pipelines ?? []).map((pipeline) => (
            <Bar key={pipeline.key} pipeline={pipeline} />
          ))}
        </ul>
      )}
    </main>
  );
}
