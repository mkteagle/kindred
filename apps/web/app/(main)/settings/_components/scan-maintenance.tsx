"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BACKEND } from "@/lib/constants";

type Scan = { status: string };
type FlickrConnection = { connected: boolean; verified?: boolean };

async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND}${path}`, init);
  if (!response.ok) throw new Error("The library server could not complete that request.");
  return response.json() as Promise<T>;
}

export function ScanMaintenance() {
  const flickr = useQuery({
    queryKey: ["flickr-integration"],
    queryFn: ({ signal }) => read<FlickrConnection>("/integrations/flickr", { signal }),
  });
  const canScan = flickr.data?.connected && flickr.data.verified;
  const active = useQuery({
    queryKey: ["active-scan"],
    enabled: canScan === true,
    queryFn: ({ signal }) => read<Scan>("/jobs/active", { signal }),
    refetchInterval: (query) => query.state.data?.status === "running" ? 5000 : false,
  });
  const start = useMutation({
    mutationFn: () => read<{ job_id?: string }>("/scan/auto", { method: "POST" }),
    onSuccess: async () => { await active.refetch(); },
  });
  const running = active.data?.status === "running";

  return <section className="kx-card" aria-labelledby="library-maintenance-heading">
    <div className="kx-cardhead"><h2 id="library-maintenance-heading">Library maintenance</h2></div>
    <Link href="/pipelines" className="kx-setting-row">Indexing progress <span aria-hidden="true">›</span></Link>
    {canScan && <div className="kx-row">
      <span className="kx-row-info">
        <strong>Flickr library scan</strong>
        <span className="kx-mono" role="status">{running ? "A scan is running" : start.isPending ? "Starting scan…" :
          start.isSuccess ? (start.data.job_id ? "Scan requested" : "No photos found to scan") : "Check the connected Flickr library for new photos"}</span>
        {active.isError && <span role="alert">Couldn’t check scan status.</span>}
        {start.isError && <span role="alert">Couldn’t start the scan.</span>}
      </span>
      {active.isError ? (
        <button className="kx-button" disabled={active.isFetching} onClick={() => void active.refetch()}>Retry</button>
      ) : (
        <button className="kx-button" disabled={running || active.isPending || start.isPending}
          onClick={() => start.mutate()}>Start scan</button>
      )}
    </div>}
  </section>;
}
