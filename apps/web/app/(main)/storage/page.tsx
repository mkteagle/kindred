"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BACKEND } from "@/lib/constants";
import { useUser } from "@/lib/use-user";
import { StorageCard, storageSize } from "@/components/kx/storage-card";
import { KxErrorBanner } from "@/components/kx/states";

interface Entry { name: string; path: string; kind: "folder" | "photo" | "video"; byte_size: number | null; modified_at: number; }
interface FolderPage { path: string; name: string; display_root: string; entries: Entry[]; next_cursor: string | null; }
const FolderIcon = () => <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M3 7V5a2 2 0 012-2h5l2 3h7a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>;
function FolderGrid({ entries, open, fetchMore, hasMore, fetching, failed }: { entries: Entry[]; open: (entry: Entry) => void; fetchMore: () => void; hasMore: boolean; fetching: boolean; failed: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 900, top: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const scroller = node.closest<HTMLElement>(".kx-content");
      const r = node.getBoundingClientRect();
      setBox({ width: r.width, top: r.top - (scroller?.getBoundingClientRect().top ?? 0) + (scroller?.scrollTop ?? 0) });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    if (node.parentElement) observer.observe(node.parentElement);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(2, Math.floor((box.width + 14) / 190));
  const rows = Math.ceil(entries.length / columns);
  const virtualizer = useVirtualizer({ count: rows, getScrollElement: () => ref.current?.closest<HTMLElement>(".kx-content") ?? null,
    estimateSize: () => 218, overscan: 3, scrollMargin: box.top, getItemKey: index => entries[index * columns]?.path ?? index });
  const visible = virtualizer.getVirtualItems();
  const last = visible[visible.length - 1]?.index ?? -1;
  useEffect(() => { if (hasMore && !fetching && !failed && last >= rows - 3) fetchMore(); }, [hasMore, fetching, failed, last, rows, fetchMore]);
  return <div ref={ref} className="kx-folder-grid" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
    {visible.map(row => <div key={row.key} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start - box.top}px)`, display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`, gap: 14 }}>
      {entries.slice(row.index * columns, (row.index + 1) * columns).map(entry => <button className="kx-file-card" key={entry.path} onClick={() => open(entry)} title={entry.name}>
        <span className={`kx-file-preview ${entry.kind === "folder" ? "is-folder" : ""}`}>
          {entry.kind === "folder" ? <FolderIcon /> : <img src={`${BACKEND}/storage/browse/preview?${new URLSearchParams({ path: entry.path, v: String(entry.modified_at) })}`} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />}
          {entry.kind === "video" && <span className="kx-file-video">Video</span>}
        </span>
        <strong>{entry.name}</strong><small>{entry.kind === "folder" ? "Open folder" : entry.byte_size === null ? entry.kind : storageSize(entry.byte_size)}</small>
      </button>)}
    </div>)}
  </div>;
}
function StorageBrowser() {
  const router = useRouter();
  const params = useSearchParams();
  const folder = params.get("path") || "";
  const { isAdmin, isLoading } = useUser();
  const [selected, setSelected] = useState<Entry | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const query = useInfiniteQuery<FolderPage>({ queryKey: ["nas-browser", folder], initialPageParam: null as string | null,
    enabled: isAdmin,
    queryFn: async ({ pageParam, signal }) => {
      const qs = new URLSearchParams({ path: folder, limit: "100" });
      if (pageParam) qs.set("cursor", String(pageParam));
      const response = await fetch(`${BACKEND}/storage/browse?${qs}`, { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "This folder could not be opened.");
      return data;
    }, getNextPageParam: page => page.next_cursor || undefined,
  });
  const entries = useMemo(() => Array.from(new Map(query.data?.pages.flatMap(page => page.entries).map(entry => [entry.path, entry]) ?? []).values()), [query.data]);
  const info = query.data?.pages[0];
  const go = (path: string) => { router.push(path ? `/storage?${new URLSearchParams({ path })}` : "/storage"); document.querySelector<HTMLElement>(".kx-content")?.scrollTo({ top: 0 }); };
  useEffect(() => { if (selected) dialogRef.current?.showModal(); }, [selected]);
  if (isLoading) return <main className="kx-page"><p role="status">Opening your storage…</p></main>;
  if (!isAdmin) return <main className="kx-page"><h1 className="kx-title">Your NAS, kept private.</h1><p className="kx-lede">The library owner can browse the connected media folders here.</p></main>;
  const parts = folder.split("/").filter(Boolean);
  const selectedPath = selected ? [info?.display_root, selected.path].filter(Boolean).join("/") : "";
  return <main className="kx-page kx-storage-page">
    <div className="kx-pagehead"><div><h1 className="kx-title">NAS storage</h1><p className="kx-lede">Explore your folders. Find the originals. Know where every moment lives.</p></div><button className="kx-button" onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh</button></div>
    {!folder && <StorageCard full />}
    <nav className="kx-folder-breadcrumbs" aria-label="Folder path"><button onClick={() => go("")}>{info?.name || "Home NAS"}</button>{parts.map((part, index) => <span key={index}><span aria-hidden="true">/</span><button aria-current={index === parts.length - 1 ? "location" : undefined} onClick={() => go(parts.slice(0, index + 1).join("/"))}>{part}</button></span>)}</nav>
    {info?.display_root && <p className="kx-folder-location">{info.display_root}{folder ? `/${folder}` : ""}</p>}
    <p className="kx-connection-help">Folders and media files only. Browsing doesn’t move or change originals. Previews are cached separately as you open folders.</p>
    {query.error && <KxErrorBanner detail={query.error.message} onRetry={() => void query.refetch()} />}
    {query.isPending && <p role="status">Reading this folder…</p>}
    {!query.isPending && !query.error && !entries.length && <p className="kx-status">No photo, video, or subfolder in this folder.</p>}
    <FolderGrid entries={entries} open={entry => { if (entry.kind === "folder") go(entry.path); else { setCopied(false); setSelected(entry); } }} fetchMore={() => void query.fetchNextPage()} hasMore={!!query.hasNextPage} fetching={query.isFetching} failed={!!query.error} />
    {query.isFetchingNextPage && <p role="status">Reading more files…</p>}
    {query.hasNextPage && <button className="kx-button" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>Show more files</button>}
    {selected && <dialog ref={dialogRef} className="kx-file-dialog" onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
      <div className="kx-file-dialog-head"><h2>{selected.name}</h2><button className="kx-button" onClick={() => dialogRef.current?.close()}>Close</button></div>
      <img src={`${BACKEND}/storage/browse/preview?${new URLSearchParams({ path: selected.path, v: String(selected.modified_at) })}`} alt={selected.name} />
      <p className="kx-connection-help">{selected.kind === "video" ? "Video poster preview" : "Photo preview"} · {selected.byte_size !== null ? storageSize(selected.byte_size) : ""}</p>
      <label>Location on NAS<code>{selectedPath}</code></label><button className="kx-button" onClick={async () => { try { await navigator.clipboard.writeText(selectedPath); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy file location"}</button>
    </dialog>}
  </main>;
}
export default function StoragePage() { return <Suspense fallback={<main className="kx-page"><p>Opening storage…</p></main>}><StorageBrowser /></Suspense>; }
