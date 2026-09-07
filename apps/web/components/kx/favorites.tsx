"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";

/**
 * Favourites are per member, never per household — two people in the same
 * house keep different lists of the same library.
 *
 * The backend has `GET /favorites` (paged), `GET /favorites/count` and an
 * idempotent `PUT`/`DELETE /photos/{id}/favorite`. What it does not have is a
 * way to ask "is this one photo mine?", so this context keeps the ids the app
 * has actually seen: everything the /favorites screen has paged in, plus every
 * toggle made this session.
 *
 * TODO: the heart on a photo the member favourited in an earlier session and
 * has not scrolled past on /favorites will start empty. A `favorited` column on
 * `/library/photos` and `/search` rows would close this — one flag per row, no
 * extra request — and `seed()` would then be redundant.
 */

interface FavoritesValue {
  /** Ids known to be favourited. Never assume absence means "not favourited". */
  ids: ReadonlySet<string>;
  isFavorite: (photoId: string) => boolean;
  toggle: (photoId: string) => void;
  /** Adds a batch of ids the app has confirmed, e.g. a /favorites page. */
  seed: (photoIds: string[]) => void;
  /** The member's own total, for the sidebar row. */
  count: number | null;
  pending: boolean;
}

const FavoritesContext = createContext<FavoritesValue | null>(null);

export function useFavorites(): FavoritesValue {
  const value = useContext(FavoritesContext);
  if (!value) throw new Error("useFavorites must be used inside the Kindred app shell");
  return value;
}

export function KxFavoritesProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["favorites-count"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/favorites/count`);
      if (!response.ok) return { count: 0 };
      return response.json();
    },
    staleTime: 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async ({ photoId, on }: { photoId: string; on: boolean }) => {
      const response = await fetch(`${BACKEND}/photos/${photoId}/favorite`, {
        method: on ? "PUT" : "DELETE",
      });
      if (!response.ok) throw new Error("That could not be saved.");
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["favorites-count"] });
      void queryClient.invalidateQueries({ queryKey: ["favorites-mosaic"] });
    },
    onError: (_error, variables) => {
      // Put the heart back the way the server still has it.
      setIds((current) => {
        const next = new Set(current);
        if (variables.on) next.delete(variables.photoId);
        else next.add(variables.photoId);
        return next;
      });
    },
  });

  const toggle = useCallback(
    (photoId: string) => {
      let on = false;
      setIds((current) => {
        const next = new Set(current);
        on = !next.has(photoId);
        if (on) next.add(photoId);
        else next.delete(photoId);
        return next;
      });
      // The optimistic flip above has already decided which way this goes.
      mutation.mutate({ photoId, on });
    },
    [mutation],
  );

  const seed = useCallback((photoIds: string[]) => {
    if (photoIds.length === 0) return;
    setIds((current) => {
      const missing = photoIds.filter((id) => !current.has(id));
      if (missing.length === 0) return current;
      const next = new Set(current);
      for (const id of missing) next.add(id);
      return next;
    });
  }, []);

  const value = useMemo<FavoritesValue>(
    () => ({
      ids,
      isFavorite: (photoId: string) => ids.has(photoId),
      toggle,
      seed,
      count: countData?.count ?? null,
      pending: mutation.isPending,
    }),
    [ids, toggle, seed, countData?.count, mutation.isPending],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}
