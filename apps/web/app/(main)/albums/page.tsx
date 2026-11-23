"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BACKEND, fmt } from "@/lib/constants";
import { KxErrorBanner } from "@/components/kx/states";
import { useKxUi } from "@/components/kx/ui-state";
import { OptimizedPhoto } from "@/components/optimized-photo";
import { useUser } from "@/lib/use-user";

type Album = {
  id: string;
  name: string;
  photo_count: number;
  description: string;
  cover_photo_id?: string | null;
  cover_media_kind?: "photo" | "video" | null;
};

type FlickrImport = { albums: number; matched_items: number; unmatched_items: number };

export default function AlbumsPage() {
  const [filter, setFilter] = useState("");
  const { setUploadOpen } = useKxUi();
  const { isAdmin } = useUser();
  const queryClient = useQueryClient();
  const query = useQuery<{ albums: Album[] }>({
    queryKey: ["kx-albums"],
    queryFn: async ({ signal }) => {
      const response = await fetch(`${BACKEND}/albums`, { signal });
      if (!response.ok) throw new Error("Albums could not be loaded.");
      return response.json();
    },
  });
  const flickrImport = useMutation({
    mutationFn: async (): Promise<FlickrImport> => {
      const response = await fetch(`${BACKEND}/albums/import-flickr`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : "Flickr albums could not be imported.");
      }
      return response.json();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["kx-albums"] }),
  });
  const albums = query.data?.albums.filter(album => album.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? [];
  const imported = flickrImport.data;

  return (
    <main className="kx-page">
      <div className="kx-pagehead">
        <h1 className="kx-title">Albums</h1>
        <div className="kx-pagehead-pills" style={{ marginLeft: "auto" }}>
          {isAdmin && (
            <button className="kx-button" disabled={flickrImport.isPending} onClick={() => flickrImport.mutate()}>
              {flickrImport.isPending ? "Importing…" : "Import Flickr albums"}
            </button>
          )}
          <button className="kx-button primary" onClick={() => setUploadOpen(true)}>Add to an album</button>
        </div>
      </div>
      {flickrImport.error && <KxErrorBanner detail={flickrImport.error.message} onRetry={() => flickrImport.mutate()} />}
      {imported && (
        <p role="status" className="kx-lede">
          {imported.albums === 0 ? "No Flickr albums found." :
            `Synced ${fmt.format(imported.albums)} Flickr albums with ${fmt.format(imported.matched_items)} matched items.`}
          {imported.unmatched_items > 0 && ` ${fmt.format(imported.unmatched_items)} album items have no match in Kindred.`}
        </p>
      )}
      <input className="kx-input" aria-label="Find an album" placeholder="Find an album…" value={filter}
        onChange={event => setFilter(event.target.value)} style={{ maxWidth: 360, marginBottom: 24 }} />
      {query.error && <KxErrorBanner detail={query.error.message} onRetry={() => void query.refetch()} />}
      {query.isPending && <p role="status">Opening your albums…</p>}
      {!query.isPending && !query.error && !albums.length && (
        <p className="kx-lede">{filter ? "No albums match that name." : "Your albums will appear here. Add photos to create your first one."}</p>
      )}
      <div className="kx-album-cards">
        {albums.map(album => (
          <Link key={album.id} href={`/albums/${album.id}`} className="kx-album-card">
            <span className="kx-album-cover" aria-hidden="true">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 16l5-5 5 5 3-3 5 5"/><circle cx="16" cy="8" r="1.5"/>
              </svg>
              {album.cover_photo_id && <OptimizedPhoto photoId={album.cover_photo_id} video={album.cover_media_kind === "video"} />}
            </span>
            <strong>{album.name}</strong>
            <small>{fmt.format(album.photo_count)} items</small>
            {album.description && <p>{album.description}</p>}
          </Link>
        ))}
      </div>
    </main>
  );
}
