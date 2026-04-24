"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { BACKEND, fmt } from "@/lib/constants";
import type { Job } from "@/types";

interface ActiveJob {
  job_id: string | null;
  status: string;
  progress?: number;
  total?: number;
  message?: string;
  counts?: { people: number; pets: number; vehicles: number };
}

// Request browser notification permission on first interaction
function requestNotificationPermission() {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function sendNotification(title: string, body: string) {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.png" });
  }
}

export function SyncProgress() {
  const [job, setJob] = useState<ActiveJob | null>(null);
  const [notified, setNotified] = useState(false);
  const qc = useQueryClient();
  const prevJobId = useRef<string | null>(null);

  // Poll for active job — fast when running, slow when idle
  const isRunning = job?.status === "running";
  const { data: activeJob } = useQuery<ActiveJob>({
    queryKey: ["active-job"],
    queryFn: () => fetch(`${BACKEND}/jobs/active`).then((r) => r.json()),
    refetchInterval: isRunning ? 3000 : 30000, // 3s when scanning, 30s when idle
  });

  // Update job state from polling (SSE is bonus, not required)
  useEffect(() => {
    if (!activeJob) return;

    if (activeJob.status === "running" && activeJob.job_id) {
      setJob(activeJob);

      // Request notification permission when scan starts
      if (prevJobId.current !== activeJob.job_id) {
        prevJobId.current = activeJob.job_id;
        setNotified(false);
        requestNotificationPermission();
        sendNotification("Scan started", `Processing ${fmt.format(activeJob.total || 0)} photos...`);
      }
    } else if (activeJob.status === "idle") {
      // Job finished — if we had a job before, show completion
      if (job && job.status === "running" && !notified) {
        setNotified(true);
        const c = job.counts;
        const body = c ? `${fmt.format(c.people)} faces · ${fmt.format(c.pets)} pets · ${fmt.format(c.vehicles)} vehicles` : "Scan complete";
        sendNotification("Scan complete", body);
        setJob({ ...job, status: "done" });
        qc.invalidateQueries({ queryKey: ["clusters-summary"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
        setTimeout(() => setJob(null), 5000);
      } else if (!job || job.status !== "done") {
        setJob(null);
      }
    }
  }, [activeJob?.job_id, activeJob?.status, activeJob?.progress]);

  if (!job || job.status === "idle") return null;

  const progress = job.total ? Math.round(((job.progress || 0) / job.total) * 100) : 0;
  const isDone = job.status === "done";

  return (
    <Link href="/sync" className="sync-bar-link">
      <div className={`sync-bar ${isDone ? "sync-bar-done" : ""}`}>
        <div className="sync-bar-fill" style={{ width: `${isDone ? 100 : progress}%` }} />
        <div className="sync-bar-content">
          <span className="sync-bar-text">
            {isDone ? "Scan complete — click to view" : (job.message || "Scanning...")}
          </span>
          <span className="sync-bar-stats">
            {job.counts && !isDone && (
              <>
                {fmt.format(job.counts.people)} faces
                {" \u00b7 "}
                {fmt.format(job.counts.pets)} pets
                {" \u00b7 "}
                {fmt.format(job.counts.vehicles)} vehicles
              </>
            )}
            {!isDone && job.total && (
              <> &mdash; {fmt.format(job.progress || 0)}/{fmt.format(job.total)}</>
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}
