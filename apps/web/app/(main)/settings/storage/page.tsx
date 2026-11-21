"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { StorageCard } from "@/components/kx/storage-card";
import { useStorageStatus } from "@/components/kx/use-library";
import { BACKEND } from "@/lib/constants";
import { useUser } from "@/lib/use-user";
import { NavIcon } from "@/components/kx/icons";

const AUTO_CHECK_KEY = "kindred-storage-auto-check";

export default function StorageSettingsPage() {
  const { isAdmin } = useUser();
  const [autoCheck, setAutoCheck] = useState(true);
  useEffect(() => {
    try { setAutoCheck(localStorage.getItem(AUTO_CHECK_KEY) !== "off"); } catch { /* Storage disabled. */ }
  }, []);

  const { data: nas, isPending, error, isFetching, refetch } = useStorageStatus(autoCheck ? 15 * 60_000 : false);
  const flickr = useQuery<{ connected: boolean; verified?: boolean }>({
    queryKey: ["flickr-integration"],
    enabled: isAdmin,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${BACKEND}/integrations/flickr`, { signal });
      if (!response.ok) throw new Error("Flickr status unavailable");
      return response.json();
    },
    refetchInterval: autoCheck ? 15 * 60_000 : false,
  });
  const nasStatus = isPending ? "Checking…" : error ? "Status unavailable" : nas?.available ? "Connected" : nas?.configured ? "Offline" : "Not configured";
  const flickrStatus = flickr.isPending ? "Checking…" : flickr.isError ? "Status unavailable" : flickr.data?.verified ? "Connected" : flickr.data?.connected ? "Needs verification" : "Not connected";

  return <>
    <h2 className="kx-setting-title">Storage</h2>
    <details className="kx-setting-detail">
      <summary className="kx-setting-row">
        <NavIcon d="M3 7h18v12H3z M6 15h.01 M10 15h.01" /> {nas?.name || "Home NAS"}
        <small>{nasStatus}</small>
      </summary>
      <div className="kx-setting-detail-content">
        <button className="kx-button" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? "Checking…" : "Check connection"}</button>
        {isAdmin && <Link href="/storage" className="kx-button">Browse NAS folders</Link>}
      </div>
    </details>
    {isAdmin && <Link className="kx-setting-row" href="/settings/integrations#storage-connections">
      <NavIcon d="M9 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z M19 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" /> Household Flickr
      <small>{flickrStatus}</small><span aria-hidden="true">›</span>
    </Link>}
    <label className="kx-setting-toggle">
      <span><strong>Check connections automatically</strong><small>Refreshes storage status every 15 minutes while this page is open.</small></span>
      <input type="checkbox" role="switch" checked={autoCheck} onChange={(event) => {
        const checked = event.target.checked;
        setAutoCheck(checked);
        try { localStorage.setItem(AUTO_CHECK_KEY, checked ? "on" : "off"); } catch { /* Storage disabled. */ }
      }} />
    </label>
    <details className="kx-setting-detail">
      <summary className="kx-setting-row">Device space</summary>
      <StorageCard full />
    </details>
    <details className="kx-setting-detail">
      <summary className="kx-setting-row">Server connection</summary>
      <div className="kx-setting-detail-content">
        <p role="status">{nas?.detail || nasStatus}</p>
        <button className="kx-button" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? "Checking…" : "Check again"}</button>
      </div>
    </details>
    <Link className="kx-manage-connections" href="/settings/integrations#storage-connections">Manage connections</Link>
  </>;
}
