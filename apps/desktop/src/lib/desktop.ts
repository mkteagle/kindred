// The whole surface the view layer has on the Rust side of the redesign.
//
// Nothing here talks to the household server directly. The base URL and API
// key live in Rust (`settings.rs`) and never reach the webview; every read and
// write goes through `api_get`/`api_send`, and every pixel comes from a file
// the cache put on this machine. See `src-tauri/src/api.rs` for the path
// allowlist and `src-tauri/src/cache.rs` for where the files land.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type MediaVariant = "thumb" | "preview" | "clip" | "original";

export type MediaRef = {
  photo_id: string;
  variant: string;
  /** Absolute path on this machine, or null when the photo is not kept offline. */
  path: string | null;
  bytes: number;
  cached: boolean;
  from_cache: boolean;
  error: string | null;
};

export type CacheStats = {
  used_bytes: number;
  limit_bytes: number;
  entries: number;
  favorites_bytes: number;
  recent_bytes: number;
  shared_bytes: number;
  evictable_bytes: number;
  root: string;
};

export type CachePrefs = {
  limit_bytes: number;
  keep_favorites: boolean;
  keep_recent: boolean;
  keep_recent_days: number;
  wifi_only: boolean;
  pause_on_battery: boolean;
};

export type ServerStatus = {
  configured: boolean;
  base_url: string | null;
  reachable: boolean;
  checked_at: number | null;
  last_ok: number | null;
  last_error: string | null;
};

export type ExportResult = { written: string[]; failed: string[] };

export type WindowKind = "library" | "viewer" | "review" | "settings" | "uploader";

export type WindowContext = {
  label: string;
  kind: WindowKind;
  params: unknown;
};

type Query = Record<string, string | number | boolean | null | undefined>;

/** Drop empties and stringify — the Rust side takes a flat string map. */
function normalizeQuery(query?: Query): Record<string, string> | undefined {
  if (!query) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    out[key] = String(value);
  }
  return Object.keys(out).length ? out : undefined;
}

export const desktop = {
  apiGet: <T>(path: string, query?: Query) =>
    invoke<T>("api_get", { path, query: normalizeQuery(query) }),

  apiSend: <T>(method: string, path: string, body?: unknown, query?: Query) =>
    invoke<T>("api_send", {
      method,
      path,
      query: normalizeQuery(query),
      body: body ?? null,
    }),

  serverStatus: () => invoke<ServerStatus>("server_status"),
  pingServer: () => invoke<ServerStatus>("ping_server"),

  mediaRef: (photoId: string, variant: MediaVariant, pin?: string) =>
    invoke<MediaRef>("media_ref", { photoId, variant, pin: pin ?? null }),
  cachedMedia: (photoIds: string[], variant: MediaVariant) =>
    invoke<string[]>("cached_media", { photoIds, variant }),

  /** Materialise originals and hand back their paths, for the OS drag. */
  prepareOriginals: (photoIds: string[]) =>
    invoke<string[]>("prepare_originals", { photoIds }),
  exportOriginals: (photoIds: string[], titles: string[], destination: string) =>
    invoke<ExportResult>("export_originals", { photoIds, titles, destination }),

  cacheStats: () => invoke<CacheStats>("cache_stats"),
  clearCache: () => invoke<number>("clear_media_cache"),
  cachePrefs: () => invoke<CachePrefs>("get_cache_prefs"),
  setCachePrefs: (prefs: CachePrefs) => invoke<CacheStats>("set_cache_prefs", { prefs }),

  videoStreamUrl: (photoId: string) => invoke<string>("video_stream_url", { photoId }),

  openWindow: (kind: WindowKind, params?: unknown) =>
    invoke<string>("open_window", { kind, params: params ?? null }),
  windowContext: () => invoke<WindowContext | null>("window_context"),
  appVersion: () => invoke<string>("app_version"),
};

/**
 * A menu selection, delivered to every window.
 *
 * Tauri has no "send to the key window" primitive, so `menu.rs` broadcasts and
 * each window filters on `document.hasFocus()`. Without that filter, ⌘A in the
 * viewer would also select every photo in the library window behind it.
 */
export function onMenuCommand(handler: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>("menu-command", (event) => {
    if (!document.hasFocus()) return;
    handler(event.payload);
  });
}

/** Fresh params handed to a singleton window that was already open. */
export function onWindowContext(handler: (params: unknown) => void): Promise<UnlistenFn> {
  return listen<unknown>("window-context", (event) => handler(event.payload));
}
