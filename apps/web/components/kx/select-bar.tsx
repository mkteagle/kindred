"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { useFavorites } from "./favorites";
import { HeartIcon } from "./icons";
import { useKxUi } from "./ui-state";

interface Album {
  id: string | null;
  name: string;
  slug: string | null;
  photo_count: number;
}

/**
 * The floating bar at the foot of the library mosaic. Two states: a hint while
 * select mode is on and nothing is picked, and the count bar once something is.
 */
export function KxSelectBar() {
  const { selecting, selected, setSelected, exitSelect } = useKxUi();
  const { toggle: toggleFavorite, isFavorite } = useFavorites();
  const queryClient = useQueryClient();
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const albumsRef = useRef<HTMLDivElement>(null);

  const ids = Array.from(selected);

  const { data: albums } = useQuery<Album[]>({
    queryKey: ["kx-albums"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/albums`);
      if (!response.ok) return [];
      const data: { albums?: Album[] } = await response.json();
      return (data.albums ?? []).filter((album) => album.id);
    },
    enabled: albumsOpen,
    staleTime: 60 * 1000,
  });

  const addToAlbum = useMutation({
    mutationFn: async (albumId: string) => {
      const response = await fetch(`${BACKEND}/albums/${albumId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (!response.ok) throw new Error("Those photos could not be added.");
      return response.json() as Promise<{ added: number; failed: unknown[] }>;
    },
    onSuccess: (result) => {
      setAlbumsOpen(false);
      setNote(
        `${fmt.format(result.added)} ${result.added === 1 ? "photo" : "photos"} added.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["kx-albums"] });
      exitSelect();
    },
    onError: (error: Error) => setNote(error.message),
  });

  // A confirmation that clears itself; nothing here is worth a dismissible
  // banner over the mosaic.
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(timer);
  }, [note]);

  useEffect(() => {
    if (!albumsOpen) return;
    const handler = (event: MouseEvent) => {
      if (albumsRef.current && !albumsRef.current.contains(event.target as Node)) {
        setAlbumsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [albumsOpen]);

  useEffect(() => {
    if (selected.size === 0) setAlbumsOpen(false);
  }, [selected.size]);

  if (note) {
    return (
      <div className="kx-floatbar hint" role="status">
        {note}
      </div>
    );
  }

  if (selecting && selected.size === 0) {
    return (
      <div className="kx-floatbar hint" role="status">
        Click to gather · drag to sweep · Esc to stop
      </div>
    );
  }

  if (selected.size === 0) return null;

  // Favouriting a mixed batch turns the whole batch on, which is the only
  // reading of the action that does not surprise anyone.
  const allFavorited = ids.every((id) => isFavorite(id));

  return (
    <div className="kx-floatbar">
      <span>
        {fmt.format(selected.size)} {selected.size === 1 ? "photo" : "photos"} selected
      </span>

      {/* TODO: POST /shares takes one photo or one album, never a list, so a
          selection cannot be shared in a single link yet. */}
      <button className="kx-barbutton" disabled title="Sharing a selection is not wired up yet">
        Share
      </button>

      <div className="kx-menu-anchor" ref={albumsRef}>
        <button
          className="kx-barbutton"
          aria-expanded={albumsOpen}
          aria-haspopup="menu"
          disabled={addToAlbum.isPending}
          onClick={() => setAlbumsOpen((open) => !open)}
        >
          {addToAlbum.isPending ? "Adding…" : "Add to album"}
        </button>
        {albumsOpen && (
          <div className="kx-menu above" role="menu">
            <span className="kx-eyebrow quiet" style={{ padding: "8px 10px 6px" }}>
              Add to
            </span>
            {(albums ?? []).length === 0 && (
              <span className="kx-menu-note">No albums yet. Make one from the upload dialog.</span>
            )}
            {(albums ?? []).map((album) => (
              <button
                key={album.id}
                className="kx-menu-item"
                role="menuitem"
                onClick={() => addToAlbum.mutate(album.id as string)}
              >
                <span>{album.name}</span>
                <span className="kx-navcount">{fmt.format(album.photo_count)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Reaching the viewer to favourite one photo at a time is a phone's
          worst path, so the batch action lives here where the thumbs are. */}
      <button
        className="kx-barbutton compact-only"
        aria-pressed={allFavorited}
        onClick={() => {
          for (const id of ids) {
            if (isFavorite(id) !== !allFavorited) toggleFavorite(id);
          }
        }}
      >
        <HeartIcon size={14} filled={allFavorited} />
        {allFavorited ? "Favorited" : "Favorite"}
      </button>

      <button className="kx-barbutton" onClick={() => setSelected(new Set())}>
        Clear
      </button>
      <button className="kx-barbutton primary" onClick={exitSelect}>
        Done
      </button>
    </div>
  );
}
