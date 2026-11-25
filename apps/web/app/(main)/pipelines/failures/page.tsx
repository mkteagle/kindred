"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import { useUser } from "@/lib/use-user";
import { KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";
import styles from "../../activity/page.module.css";

type Event = {
  id: number;
  filename: string | null;
  outcome: "historical_failure" | "failed" | "recovered";
  attempt: number;
  detail: string;
  occurred_at: string;
  next_attempt_at: string | null;
  preview_ready: boolean;
};

type EventPage = { events: Event[]; next_before: number | null };

const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function retryStatus(event: Event) {
  if (event.outcome === "recovered") return "Recovered";
  if (!event.next_attempt_at) return "—";
  if (!event.preview_ready) return "Waiting for a preview";
  if (new Date(event.next_attempt_at).getTime() <= Date.now()) return "Queued for retry";
  return <time dateTime={event.next_attempt_at}>{timestamp.format(new Date(event.next_attempt_at))}</time>;
}

export default function CategorizationFailuresPage() {
  const { isAdmin, isLoading } = useUser();
  const [history, setHistory] = useState(false);
  const [cursors, setCursors] = useState<number[]>([]);
  const before = cursors.at(-1);
  const { data, error, isPending, isFetching, refetch } = useQuery<EventPage>({
    queryKey: ["categorization-events", history, before],
    enabled: isAdmin,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ history: String(history), limit: "50" });
      if (before) params.set("before", String(before));
      const response = await fetch(`${BACKEND}/categorization-events?${params}`, { signal });
      if (!response.ok) throw new Error("Categorization events could not be loaded.");
      return response.json();
    },
    refetchInterval: before ? false : 15000,
    retry: false,
  });

  return (
    <main className={`kx-page ${styles.page}`}>
      <h1 className="kx-title">Categorization failures</h1>
      <Link href="/pipelines" className={styles.progress}>← Indexing progress</Link>
      {!isLoading && !isAdmin && <p>Categorization logs are available to household admins.</p>}
      {isAdmin && (
        <div className={styles.controls}>
          <label>Show
            <select className="kx-select" value={history ? "history" : "open"} onChange={(event) => {
              setHistory(event.target.value === "history");
              setCursors([]);
            }}>
              <option value="open">Unresolved failures</option>
              <option value="history">Failure and recovery history</option>
            </select>
          </label>
          <button className={styles.button} disabled={isFetching} onClick={() => void refetch()}>Refresh</button>
        </div>
      )}
      {error && <KxErrorBanner detail={error.message} onRetry={() => void refetch()} />}
      {(isLoading || (isAdmin && isPending)) && <KxSkeletonRows count={6} height={52} />}
      {data && (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.caption}>Newest first · Times shown in your local timezone</caption>
              <thead><tr><th scope="col">Filename</th><th scope="col">Result</th><th scope="col">Attempt</th><th scope="col">Recorded</th><th scope="col">Retry</th></tr></thead>
              <tbody>{data.events.map((event) => (
                <tr key={event.id}>
                  <td className={styles.filename}>{event.filename || "Unnamed photo"}</td>
                  <td>{event.detail}</td>
                  <td>{event.attempt || "Previous worker"}</td>
                  <td className={styles.time}>
                    <time dateTime={event.occurred_at}>{timestamp.format(new Date(event.occurred_at))}</time>
                  </td>
                  <td className={styles.time}>{retryStatus(event)}</td>
                </tr>
              ))}</tbody>
            </table>
            {data.events.length === 0 && <p className={styles.empty}>
              {history ? "No categorization failures recorded." : "No unresolved categorization failures."}
            </p>}
          </div>
          <div className={styles.pagination}>
            <button className={styles.button} disabled={!before || isFetching}
              onClick={() => setCursors((current) => current.slice(0, -1))}>Newer events</button>
            <button className={styles.button} disabled={!data.next_before || isFetching} onClick={() => {
              if (data.next_before) setCursors((current) => [...current, data.next_before!]);
            }}>Older events</button>
          </div>
        </>
      )}
    </main>
  );
}
