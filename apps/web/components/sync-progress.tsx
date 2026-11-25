"use client";

import Link from "next/link";
import { usePipelines } from "@/components/kx/use-library";

const fmt = new Intl.NumberFormat("en-GB");

export function SyncProgress() {
  const { data } = usePipelines(10000);
  const running = (data?.pipelines ?? []).filter((pipeline) => pipeline.running && !pipeline.complete);
  const primary = running[0];
  if (!primary) return null;
  const others = running.length - 1;
  const done = primary.remaining !== null && primary.total !== null
    ? Math.max(primary.done, primary.total - primary.remaining)
    : primary.done;

  return (
    <Link href="/pipelines" className="kx-syncbanner" prefetch={false}>
      <span className="kx-syncbanner-pulse" aria-hidden="true" />
      <span className="kx-syncbanner-copy">
        <strong>{primary.label}</strong>
        <span className="kx-mono">
          {fmt.format(done)}
          {primary.total !== null && ` of ${fmt.format(primary.total)}`}
          {primary.percent !== null ? ` · ${primary.percent}%` : " · counting total"}
          {primary.eta && ` · ${primary.eta} left`}
          {others > 0 && ` · ${others} other ${others === 1 ? "job" : "jobs"} running`}
        </span>
      </span>
      {primary.percent !== null && (
        <span className="kx-syncbanner-bar" aria-hidden="true">
          <span style={{ width: `${primary.percent}%` }} />
        </span>
      )}
      <span className="kx-syncbanner-arrow" aria-hidden="true">→</span>
    </Link>
  );
}
