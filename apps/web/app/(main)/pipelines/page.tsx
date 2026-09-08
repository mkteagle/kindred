"use client";

import { useQuery } from "@tanstack/react-query";
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
  // finished, moving, and stopped. A stalled pipeline that looks like a
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
            : state === "idle"
              ? "not running"
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
          Total counted from disk {ago(pipeline.measured_at)}
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
    refetchInterval: 5000,
  });

  return (
    <main className="kx-page" style={{ maxWidth: 900 }}>
      <span className="kx-eyebrow">Operations</span>
      <h1 className="kx-title" style={{ fontSize: 40 }}>
        What the server is doing.
      </h1>
      <p className="kx-lede">
        Five jobs run for days at a time. This is where they are — refreshed every
        few seconds, so a stalled one shows as stopped rather than as a bar that
        happens not to move.
      </p>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}

      {isPending ? (
        <KxSkeletonRows count={5} height={74} />
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
