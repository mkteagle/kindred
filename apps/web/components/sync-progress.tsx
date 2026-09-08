"use client";

import Link from "next/link";
import { busiestPipeline, usePipelines } from "@/components/kx/use-library";

const fmt = new Intl.NumberFormat("en-GB");

/**
 * The banner that says something long-running is happening.
 *
 * It used to poll /jobs/active, which is an in-memory dict inside the API
 * process -- while every job that runs for days lives in a different container
 * and cannot write to it. The endpoint answered "idle" on every request, so
 * this never appeared once, however busy the server actually was.
 *
 * /pipelines reads the database and the disk, so what it reports is what is
 * happening. Nothing is drawn when nothing is running: a permanent bar is
 * furniture, and furniture gets ignored.
 */
export function SyncProgress() {
  const { data } = usePipelines(10000);
  const busiest = busiestPipeline(data?.pipelines);
  if (!busiest) return null;

  const running = (data?.pipelines ?? []).filter((p) => p.running);
  const others = running.length - 1;

  return (
    <Link href="/pipelines" className="kx-syncbanner" prefetch={false}>
      <span className="kx-syncbanner-pulse" aria-hidden="true" />
      <span className="kx-syncbanner-copy">
        <strong>{busiest.label}</strong>
        <span className="kx-mono">
          {fmt.format(busiest.done)}
          {busiest.total !== null && ` of ${fmt.format(busiest.total)}`}
          {busiest.percent !== null && ` · ${busiest.percent}%`}
          {busiest.eta && ` · ${busiest.eta} left`}
          {others > 0 && ` · ${others} other ${others === 1 ? "job" : "jobs"} running`}
        </span>
      </span>
      <span className="kx-syncbanner-bar" aria-hidden="true">
        <span style={busiest.percent === null ? undefined : { width: `${busiest.percent}%` }} />
      </span>
    </Link>
  );
}
