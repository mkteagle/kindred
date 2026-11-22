"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BACKEND, fmt } from "@/lib/constants";
import { KxErrorBanner } from "@/components/kx/states";
import { useKxUi } from "@/components/kx/ui-state";

export default function AlbumsPage() {
  const [filter, setFilter] = useState("");
  const { setUploadOpen } = useKxUi();
  const query = useQuery<{ albums: { id: string; name: string; photo_count: number; description: string }[] }>({
    queryKey: ["kx-albums"], queryFn: async ({ signal }) => {
      const response = await fetch(`${BACKEND}/albums`, { signal });
      if (!response.ok) throw new Error("Albums could not be loaded.");
      return response.json();
    },
  });
  const albums = query.data?.albums.filter(album => album.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? [];
  return <main className="kx-page"><div className="kx-pagehead"><div><h1 className="kx-title">Albums</h1></div><button className="kx-button primary" style={{ marginLeft: "auto" }} onClick={() => setUploadOpen(true)}>Add to an album</button></div>
    <input className="kx-input" aria-label="Find an album" placeholder="Find an album…" value={filter} onChange={event => setFilter(event.target.value)} style={{ maxWidth: 360, marginBottom: 24 }} />
    {query.error && <KxErrorBanner detail={query.error.message} onRetry={() => void query.refetch()} />}
    {query.isPending && <p role="status">Opening your albums…</p>}
    {!query.isPending && !query.error && !albums.length && <p className="kx-lede">{filter ? "No albums match that name." : "Your albums will appear here. Add photos to create your first one."}</p>}
    <div className="kx-album-cards">{albums.map(album => <Link key={album.id} href={`/albums/${album.id}`} className="kx-album-card"><span className="kx-album-cover"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 16l5-5 5 5 3-3 5 5"/><circle cx="16" cy="8" r="1.5"/></svg></span><strong>{album.name}</strong><small>{fmt.format(album.photo_count)} items</small>{album.description && <p>{album.description}</p>}</Link>)}</div>
  </main>;
}
