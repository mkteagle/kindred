import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SettingsView = {
  base_url: string | null;
  concurrency: number;
  api_key_set: boolean;
};

export type StatusCounts = {
  pending: number;
  uploading: number;
  done: number;
  failed: number;
  skipped: number;
  total_bytes_done: number;
  total_bytes_all: number;
};

export type FileRow = {
  id: number;
  path: string;
  size_bytes: number;
  status: string;
  flickr_photo_id: string | null;
  error: string | null;
  attempts: number;
};

export type ScanProgress = {
  scanned: number;
  queued: number;
  skipped: number;
  current_dir: string;
};

export type UploadEvent = {
  kind: "start" | "ok" | "fail";
  file_id: number;
  path: string;
  photo_id: string | null;
  error: string | null;
};

export type ScanTriggerResponse = {
  message: string;
  job_id: string | null;
  count: number;
};

export type Album = {
  id: string;
  title: string;
  photo_count: number;
  primary_photo_id: string | null;
};

export const api = {
  getSettings: () => invoke<SettingsView>("get_settings"),
  setSettings: (args: { baseUrl?: string; concurrency?: number; apiKey?: string }) =>
    invoke<void>("set_settings", args),
  testConnection: () => invoke<boolean>("test_connection"),
  triggerScan: () => invoke<ScanTriggerResponse>("trigger_scan"),

  startScan: (path: string, albumId: string | null) =>
    invoke<number>("start_scan", { path, albumId }),
  listAlbums: () => invoke<Album[]>("list_albums"),
  getStatus: () => invoke<StatusCounts>("get_status"),

  startUpload: () => invoke<void>("start_upload"),
  stopUpload: () => invoke<void>("stop_upload"),
  isRunning: () => invoke<boolean>("is_running"),

  listFailed: (limit?: number) => invoke<FileRow[]>("list_failed", { limit }),
  retryFailed: (id: number) => invoke<void>("retry_failed", { id }),
  clearQueue: () => invoke<void>("clear_queue"),
};

export const events = {
  onScanProgress: (cb: (p: ScanProgress) => void): Promise<UnlistenFn> =>
    listen<ScanProgress>("scan-progress", (e) => cb(e.payload)),
  onScanComplete: (cb: (p: ScanProgress) => void): Promise<UnlistenFn> =>
    listen<ScanProgress>("scan-complete", (e) => cb(e.payload)),
  onUploadEvent: (cb: (e: UploadEvent) => void): Promise<UnlistenFn> =>
    listen<UploadEvent>("upload-event", (e) => cb(e.payload)),
  onUploadStarted: (cb: () => void): Promise<UnlistenFn> =>
    listen<unknown>("upload-started", () => cb()),
  onUploadStopped: (cb: () => void): Promise<UnlistenFn> =>
    listen<unknown>("upload-stopped", () => cb()),
};
