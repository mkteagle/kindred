// Cache-first image loading.
//
// A tile asks for a photo id and a variant and gets back an asset URL pointing
// at a file on this machine. If the file is not there yet, Rust fetches it and
// the tile fills in; if the server is unreachable, the tile stays a placeholder
// and says so. Nothing here ever holds an HTTP URL to the household server.
//
// Two things keep a fast scroll from melting: a module-level result map so a
// tile that scrolls out and back does not re-ask, and a small concurrency gate
// so six requests are in flight rather than six hundred.

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { desktop, type MediaVariant } from "./desktop";

export type MediaState = {
  /** Asset URL for the cached file, or null while missing. */
  src: string | null;
  cached: boolean;
  loading: boolean;
  error: string | null;
};

const PENDING: MediaState = { src: null, cached: false, loading: true, error: null };

const results = new Map<string, MediaState>();
const inFlight = new Map<string, Promise<MediaState>>();
const waiting: (() => void)[] = [];
let active = 0;

const MAX_CONCURRENT = 6;

function gate(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

function key(photoId: string, variant: MediaVariant) {
  return `${photoId}:${variant}`;
}

/** Fetch-or-hit, deduplicated across every tile that wants the same file. */
export function loadMedia(
  photoId: string,
  variant: MediaVariant,
  pin?: string,
): Promise<MediaState> {
  const id = key(photoId, variant);
  // A hit is final. A failure is not: the server may come back, so a later
  // mount is allowed to try again.
  const known = results.get(id);
  if (known?.cached) return Promise.resolve(known);
  const existing = inFlight.get(id);
  if (existing) return existing;

  const promise = gate()
    .then(() => desktop.mediaRef(photoId, variant, pin))
    .then((ref): MediaState => {
      const state: MediaState = ref.path
        ? { src: convertFileSrc(ref.path), cached: true, loading: false, error: null }
        : { src: null, cached: false, loading: false, error: ref.error };
      results.set(id, state);
      return state;
    })
    .catch((e): MediaState => {
      const state: MediaState = {
        src: null,
        cached: false,
        loading: false,
        error: String(e),
      };
      results.set(id, state);
      return state;
    })
    .finally(() => {
      release();
      inFlight.delete(id);
    });

  inFlight.set(id, promise);
  return promise;
}

/** Forget a cached answer so the next ask goes back to Rust. */
export function forgetMedia(photoId: string, variant: MediaVariant) {
  results.delete(key(photoId, variant));
}

export function forgetAllMedia() {
  results.clear();
}

/**
 * The asset URL for one photo, or null while it is not on this machine.
 *
 * `enabled` exists so a virtualised grid can mount a tile without asking for
 * its bytes — rows that are only in the overscan buffer stay quiet.
 */
export function useMedia(
  photoId: string | null,
  variant: MediaVariant,
  enabled = true,
  pin?: string,
): MediaState {
  const [state, setState] = useState<MediaState>(() =>
    photoId ? results.get(key(photoId, variant)) ?? PENDING : PENDING,
  );

  useEffect(() => {
    if (!photoId || !enabled) return;
    const known = results.get(key(photoId, variant));
    if (known) {
      setState(known);
      if (known.cached || known.error) return;
    } else {
      setState(PENDING);
    }
    let live = true;
    loadMedia(photoId, variant, pin).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [photoId, variant, enabled, pin]);

  return state;
}
