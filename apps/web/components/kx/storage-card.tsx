"use client";

import Link from "next/link";
import { useLibraryCounts, useStorageStatus } from "./use-library";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });
export function storageSize(bytes: number) {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TiB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
}

export function StorageCard({ full = false }: { full?: boolean }) {
  const { data, isPending, error, refetch } = useStorageStatus(false);
  const { data: counts } = useLibraryCounts();
  const known = data?.available && data.total_bytes !== null && data.total_bytes > 0 && data.used_bytes !== null;
  const percent = known ? Math.min(100, Math.max(0, Math.round(data.used_bytes! / data.total_bytes! * 100))) : null;
  return <section className={`kx-storage-card ${full ? "is-full" : ""}`} aria-label="Storage usage">
    <div className="kx-storage-heading"><strong>{data?.name || "Your storage"}</strong><span>{percent === null ? "" : `${percent}%`}</span></div>
    <small className="kx-storage-scope">Whole NAS volume · all apps and files</small>
    <p>{known ? `${storageSize(data.used_bytes!)} / ${storageSize(data.total_bytes!)} used` : isPending ? "Checking storage…" : error ? "Storage status unavailable" : data?.configured ? "Storage is offline" : "NAS not connected"}</p>
    {percent !== null && <div className="kx-storage-meter" role="meter" aria-label="NAS storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>}
    <small>{known && data.free_bytes !== null ? `${storageSize(data.free_bytes)} available · not just this photo library` : data?.detail || "Connect your own storage in Integrations."}</small>
    <div className="kx-storage-counts">
      <span><small>PHOTOS</small><strong>{counts ? compact.format(counts.photos) : "—"}</strong></span>
      <span><small>VIDEOS</small><strong>{counts ? compact.format(counts.videos) : "—"}</strong></span>
    </div>
    {error ? <button onClick={() => void refetch()}>Try again</button> : <Link href="/settings/integrations">{full ? "Manage storage & integrations →" : "Manage storage →"}</Link>}
  </section>;
}
