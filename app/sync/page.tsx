"use client";

import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@/components/ui";
import { BACKEND, fmt } from "@/lib/constants";
import type { SyncLog } from "@/types";

interface ActiveJob {
  job_id: string | null;
  status: string;
  progress?: number;
  total?: number;
  message?: string;
  counts?: { people: number; pets: number; vehicles: number };
}

export default function SyncPage() {
  const { data: activeJob } = useQuery<ActiveJob>({
    queryKey: ["active-job"],
    queryFn: () => fetch(`${BACKEND}/jobs/active`).then((r) => r.json()),
    refetchInterval: 3000,
  });

  const { data: syncs, isLoading } = useQuery<SyncLog[]>({
    queryKey: ["syncs"],
    queryFn: () => fetch(`${BACKEND}/syncs`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const isRunning = activeJob?.status === "running";
  const progress = activeJob?.total ? Math.round(((activeJob.progress || 0) / activeJob.total) * 100) : 0;

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 24 }}>
          <div>
            <h2>Sync Status</h2>
            <p>Photo scanning progress and history.</p>
          </div>
        </div>

        {/* Active scan */}
        {isRunning && activeJob && (
          <div className="sync-active-card">
            <div className="sync-active-header">
              <Spinner />
              <strong>Scan in progress</strong>
            </div>
            <div className="sync-active-progress">
              <div className="sync-active-bar">
                <div className="sync-active-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="sync-active-pct">{progress}%</span>
            </div>
            <div className="sync-active-details">
              <span>{activeJob.message}</span>
              <span>{fmt.format(activeJob.progress || 0)} / {fmt.format(activeJob.total || 0)} photos</span>
            </div>
            {activeJob.counts && (
              <div className="sync-active-counts">
                <div className="sync-count-item">
                  <strong>{fmt.format(activeJob.counts.people)}</strong>
                  <span>faces</span>
                </div>
                <div className="sync-count-item">
                  <strong>{fmt.format(activeJob.counts.pets)}</strong>
                  <span>pets</span>
                </div>
                <div className="sync-count-item">
                  <strong>{fmt.format(activeJob.counts.vehicles)}</strong>
                  <span>vehicles</span>
                </div>
              </div>
            )}
          </div>
        )}

        {!isRunning && (
          <div className="sync-idle-card">
            <span style={{ fontSize: 28 }}>&#10003;</span>
            <strong>No active scan</strong>
            <p>Use the scan button in the user menu to start a new scan, or wait for the weekly auto-scan (Sunday 2am).</p>
          </div>
        )}

        {/* Sync history */}
        <h3 style={{ marginTop: 32, marginBottom: 12, fontSize: 13, color: "var(--mist)", textTransform: "uppercase", letterSpacing: ".08em" }}>
          Scan History
        </h3>

        {isLoading && <div style={{ textAlign: "center", padding: 24 }}><Spinner /></div>}

        {!isLoading && (syncs || []).length === 0 && (
          <p style={{ color: "var(--mist)" }}>No scan history yet.</p>
        )}

        {!isLoading && (syncs || []).map((sync) => (
          <div key={sync.id} className="sync-history-row">
            <div className="sync-history-status">
              <span className={`sync-dot ${sync.status === "done" ? "sync-dot-done" : sync.status === "running" ? "sync-dot-running" : "sync-dot-error"}`} />
              <span className="sync-history-date">
                {sync.started_at ? new Date(sync.started_at).toLocaleString() : "Unknown"}
              </span>
            </div>
            <div className="sync-history-meta">
              <span>{fmt.format(sync.total_photos || 0)} photos scanned</span>
              {sync.new_faces != null && (
                <span>{fmt.format(sync.new_faces)} faces · {fmt.format(sync.new_pets || 0)} pets · {fmt.format(sync.new_vehicles || 0)} vehicles</span>
              )}
              {sync.finished_at && sync.started_at && (
                <span className="sync-history-duration">
                  {Math.round((new Date(sync.finished_at).getTime() - new Date(sync.started_at).getTime()) / 60000)} min
                </span>
              )}
            </div>
          </div>
        ))}

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>Kindling builds useful software with character.</p>
        </footer>
      </main>
    </div>
  );
}
