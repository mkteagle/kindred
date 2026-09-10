"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import { KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";
import styles from "./page.module.css";

type Kind = "all" | "imported" | "indexed";
interface Activity {
  event_id: string;
  photo_id: string;
  filename: string;
  occurred_at: string;
  kind: Exclude<Kind, "all">;
}
interface History { events: Activity[]; next_cursor: string | null }

export default function ActivityPage() {
  const [kind, setKind] = useState<Kind>("all");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const cursor = cursors.at(-1);
  const { data, error, isPending, isFetching, refetch, dataUpdatedAt } = useQuery<History>({
    queryKey: ["import-activity", kind, search, cursor],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ kind, search, limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`${BACKEND}/import-activity?${params}`, { signal });
      if (!response.ok) throw new Error(response.status === 403
        ? "An administrator account is needed to view the library activity log."
        : response.status === 401 ? "Sign in to view library activity."
        : "Activity could not be loaded. Please try again.");
      return response.json();
    },
    refetchInterval: live && !cursor ? 10000 : false,
    retry: false,
  });

  return (
    <main className={`kx-page ${styles.page}`}>
      <span className="kx-eyebrow">Operations</span>
      <h1 className="kx-title" style={{ fontSize: 40 }}>Library activity</h1>
      <p className="kx-lede">A file-by-file record of what reached your library and what finished indexing.</p>
      <Link href="/pipelines" className={styles.progress}>View overall processing progress →</Link>
      <form className={styles.controls} onSubmit={(event) => {
        event.preventDefault(); setSearch(draft.trim()); setCursors([]);
      }}>
        <label className={styles.search}>Filename
          <input className="kx-input" value={draft} maxLength={200} placeholder="Search filenames…"
            onChange={(event) => setDraft(event.target.value)} />
        </label>
        <button className={styles.button} type="submit">Search</button>
        <label>Activity
          <select className="kx-select" value={kind} onChange={(event) => {
            setKind(event.target.value as Kind); setCursors([]);
          }}>
            <option value="all">All activity</option>
            <option value="imported">Added to library</option>
            <option value="indexed">Indexing completed</option>
          </select>
        </label>
      </form>
      <div className={styles.status}>
        <label><input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} /> Auto-refresh</label>
        <span>{cursor ? "Viewing older activity" : live ? "Refreshes every 10 seconds" : "Auto-refresh paused"}</span>
        <button className={styles.button} disabled={isFetching} onClick={() => void refetch()}>Refresh</button>
      </div>
      {error && <KxErrorBanner detail={error.message} onRetry={() => void refetch()} />}
      {isPending ? <KxSkeletonRows count={8} height={56} /> : data && (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.caption}>Newest first · Times shown in your local timezone</caption>
              <thead><tr><th scope="col">Filename</th><th scope="col">Activity</th><th scope="col">Recorded at</th></tr></thead>
              <tbody>{data.events.map((event) => (
                <tr key={event.event_id}>
                  <td className={styles.filename}>{event.filename}</td>
                  <td><span className={styles.badge} data-kind={event.kind}>{event.kind === "imported" ? "Added to library" : "Indexing completed"}</span></td>
                  <td className={styles.time}><time dateTime={event.occurred_at} title={event.occurred_at}>
                    {new Date(event.occurred_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}
                  </time></td>
                </tr>
              ))}</tbody>
            </table>
            {data.events.length === 0 && <p className={styles.empty}>{search ? "No activity matches that filename." : "No recorded activity yet."}</p>}
          </div>
          <div className={styles.pagination}>
            <button className={styles.button} disabled={!cursor || isFetching} onClick={() => setCursors((previous) => previous.slice(0, -1))}>Newer activity</button>
            {cursor && <button className={styles.button} onClick={() => setCursors([])}>Back to latest</button>}
            <button className={styles.button} disabled={!data.next_cursor || isFetching} onClick={() => {
              if (data.next_cursor) setCursors((previous) => [...previous, data.next_cursor!]);
            }}>Older activity</button>
          </div>
        </>
      )}
      <p className={styles.note}>“Added to library” is when Kindred created the catalog record, not when the photo was taken.
        Older records may reflect catalog migration. “Indexing completed” means analysis finished; it does not guarantee a face was found.
        This history records completed work, not failed attempts or files still waiting.</p>
      {dataUpdatedAt > 0 && <p className={styles.note}>Last checked {new Date(dataUpdatedAt).toLocaleTimeString()}</p>}
    </main>
  );
}
