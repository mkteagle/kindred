"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BACKEND } from "@/lib/constants";

/* ── Types ──────────────────────────────────────────────────────────── */

type FileStatus = "pending" | "uploading" | "done" | "failed";

interface QueueItem {
  id: string;
  file: File;
  title: string;
  preview: string;
  status: FileStatus;
  progress: number;
  photoId?: string;
  error?: string;
  processed: boolean;
}

interface Album {
  id: string | null;
  name: string;
  slug: string | null;
  flickr_photoset_id: string | null;
  photo_count: number;
  nas_path: string | null;
  source: "kindred" | "flickr";
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const ACCEPT = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE = 200 * 1024 * 1024; // 200 MB Flickr limit

function fileId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/* ── Component ───────────────────────────────────────────────────────── */

export default function UploadPage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [aborted, setAborted] = useState(false);
  const abortRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Album destination. "" means "no album" — photos still land on the NAS and
  // Flickr, they just aren't grouped.
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumRef, setAlbumRef] = useState("");
  const [newAlbumName, setNewAlbumName] = useState("");
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [albumError, setAlbumError] = useState<string | null>(null);

  // Summary counters
  const totalCount = queue.length;
  const doneCount = queue.filter((q) => q.status === "done").length;
  const failedCount = queue.filter((q) => q.status === "failed").length;
  const processedCount = queue.filter((q) => q.processed).length;

  /* ── Albums ──────────────────────────────────────────────────────── */

  const loadAlbums = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND}/albums?include_flickr=true`);
      if (!res.ok) return;
      const data = await res.json();
      setAlbums(data.albums ?? []);
    } catch {
      // A missing album list shouldn't block uploading.
    }
  }, []);

  useEffect(() => {
    loadAlbums();
  }, [loadAlbums]);

  async function createAlbum() {
    const name = newAlbumName.trim();
    if (!name) return;
    setCreatingAlbum(true);
    setAlbumError(null);
    try {
      const res = await fetch(`${BACKEND}/albums`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAlbumError(data.detail || "Could not create album");
        return;
      }
      setAlbums((prev) => [data, ...prev]);
      setAlbumRef(data.id);
      setNewAlbumName("");
    } catch {
      setAlbumError("Could not reach the server");
    } finally {
      setCreatingAlbum(false);
    }
  }

  /* ── File handling ───────────────────────────────────────────────── */

  const addFiles = useCallback((files: FileList | File[]) => {
    const newItems: QueueItem[] = [];
    for (const file of Array.from(files)) {
      if (!ACCEPT.includes(file.type)) continue;
      if (file.size > MAX_SIZE) continue;
      newItems.push({
        id: fileId(),
        file,
        title: stripExt(file.name),
        preview: URL.createObjectURL(file),
        status: "pending",
        progress: 0,
        processed: false,
      });
    }
    if (newItems.length > 0) {
      setQueue((prev) => [...prev, ...newItems]);
    }
  }, []);

  const removeItem = useCallback((id: string) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((q) => q.id !== id);
    });
  }, []);

  const updateTitle = useCallback((id: string, title: string) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, title } : q)));
  }, []);

  // Cleanup previews on unmount
  useEffect(() => {
    return () => {
      queue.forEach((q) => URL.revokeObjectURL(q.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Drag & drop ─────────────────────────────────────────────────── */

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  /* ── Upload one file ─────────────────────────────────────────────── */

  async function uploadOne(item: QueueItem): Promise<{ photoId?: string; error?: string }> {
    const formData = new FormData();
    formData.append("title", item.title);
    formData.append("photo", item.file);

    const xhr = new XMLHttpRequest();
    const result = await new Promise<{ photoId?: string; error?: string }>((resolve) => {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, progress: pct } : q))
          );
        }
      });

      xhr.addEventListener("load", () => {
        let parsed: { photo_id?: string; detail?: string; error?: string } = {};
        try { parsed = JSON.parse(xhr.responseText); } catch { /* handled below */ }
        if (xhr.status >= 200 && xhr.status < 300 && parsed.photo_id) {
          resolve({ photoId: parsed.photo_id });
          return;
        }
        resolve({ error: parsed.detail || parsed.error || `Upload failed (${xhr.status})` });
      });

      xhr.addEventListener("error", () => resolve({ error: "Network error during upload" }));
      xhr.addEventListener("abort", () => resolve({ error: "Upload cancelled" }));

      const query = albumRef ? `?album_id=${encodeURIComponent(albumRef)}` : "";
      xhr.open("POST", `${BACKEND}/photos/upload${query}`);
      xhr.send(formData);
    });

    return result;
  }

  /* ── Batch upload ────────────────────────────────────────────────── */

  async function startUpload() {
    abortRef.current = false;
    setAborted(false);
    setUploading(true);

    const pending = queue.filter((q) => q.status === "pending" || q.status === "failed");

    for (const item of pending) {
      if (abortRef.current) break;

      // Mark uploading
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: "uploading" as FileStatus, progress: 0, error: undefined } : q))
      );

      const result = await uploadOne(item);

      if (result.photoId) {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: "done" as FileStatus, progress: 100, photoId: result.photoId }
              : q
          )
        );

        // The backend starts ML processing after the NAS and Flickr copies are safe.
      } else {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: "failed" as FileStatus, error: result.error }
              : q
          )
        );
      }
    }

    setUploading(false);
  }

  function cancelUpload() {
    abortRef.current = true;
    setAborted(true);
  }

  function clearDone() {
    setQueue((prev) => {
      prev.filter((q) => q.status === "done").forEach((q) => URL.revokeObjectURL(q.preview));
      return prev.filter((q) => q.status !== "done");
    });
  }

  const hasPending = queue.some((q) => q.status === "pending" || q.status === "failed");
  const allDone = queue.length > 0 && queue.every((q) => q.status === "done");
  const overallProgress =
    totalCount > 0 ? Math.round(((doneCount + failedCount) / totalCount) * 100) : 0;

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="page">
      <div className="upload-page">
        <div className="upload-header">
          <h1 className="upload-title">Upload Photos</h1>
          <p className="upload-subtitle">
            Drag and drop photos or use the file picker. Originals are saved to your NAS,
            mirrored to Flickr, then analyzed by the ML pipeline.
          </p>
        </div>

        {/* Album destination */}
        <div className="upload-album">
          <label className="upload-album-label" htmlFor="album-select">
            Album
          </label>
          <div className="upload-album-row">
            <select
              id="album-select"
              className="upload-album-select"
              value={albumRef}
              onChange={(e) => setAlbumRef(e.target.value)}
              disabled={uploading}
            >
              <option value="">No album</option>
              {albums.map((album) => {
                const value = album.id ?? album.flickr_photoset_id ?? "";
                return (
                  <option key={value} value={value}>
                    {album.name}
                    {album.photo_count > 0 ? ` (${album.photo_count})` : ""}
                    {album.source === "flickr" ? " — Flickr only" : ""}
                  </option>
                );
              })}
            </select>

            <input
              className="upload-album-input"
              type="text"
              placeholder="Or create a new album…"
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createAlbum();
                }
              }}
              disabled={uploading || creatingAlbum}
            />
            <button
              className="button small"
              onClick={createAlbum}
              disabled={uploading || creatingAlbum || !newAlbumName.trim()}
            >
              {creatingAlbum ? "Creating…" : "Create"}
            </button>
          </div>
          {albumError && <p className="upload-album-error">{albumError}</p>}
          {albumRef && (
            <p className="upload-album-hint">
              Photos will be filed into this album on the NAS and added to the
              matching Flickr album.
            </p>
          )}
        </div>

        {/* Total progress */}
        {uploading && totalCount > 0 && (
          <div className="upload-total-progress">
            <div className="upload-total-bar">
              <div className="upload-total-fill" style={{ width: `${overallProgress}%` }} />
            </div>
            <span className="upload-total-label">
              {doneCount + failedCount} / {totalCount} photos
            </span>
          </div>
        )}

        {/* Summary banner */}
        {allDone && !uploading && (
          <div className="upload-summary">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>
              {doneCount} photo{doneCount !== 1 ? "s" : ""} uploaded
              {processedCount > 0 && `, ${processedCount} processed`}
            </span>
            <button className="button small ghost" onClick={clearDone}>Clear completed</button>
          </div>
        )}

        {/* Drop zone */}
        <div
          ref={dropRef}
          className={`upload-dropzone ${dragOver ? "is-drag-over" : ""} ${queue.length > 0 ? "has-files" : ""}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT.join(",")}
            multiple
            className="upload-file-input"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="upload-dropzone-content">
            <svg className="upload-dropzone-icon" width="48" height="48" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="upload-dropzone-text">
              Drop photos here or <span className="upload-dropzone-link">browse files</span>
            </p>
            <p className="upload-dropzone-hint">
              JPG, PNG, GIF, WEBP up to 200 MB each
            </p>
          </div>
        </div>

        {/* Queue */}
        {queue.length > 0 && (
          <>
            <div className="upload-queue-header">
              <span className="upload-queue-count">
                {totalCount} file{totalCount !== 1 ? "s" : ""} in queue
              </span>
              <div className="upload-queue-actions">
                {!uploading && hasPending && (
                  <button className="button primary" onClick={startUpload}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Upload all
                  </button>
                )}
                {uploading && (
                  <button className="button danger" onClick={cancelUpload}>
                    Cancel
                  </button>
                )}
                {!uploading && doneCount > 0 && (
                  <button className="button small ghost" onClick={clearDone}>
                    Clear completed
                  </button>
                )}
              </div>
            </div>

            <div className="upload-queue">
              {queue.map((item) => (
                <div key={item.id} className={`upload-item upload-item-${item.status}`}>
                  <img src={item.preview} alt="" className="upload-item-thumb" />
                  <div className="upload-item-info">
                    <div className="upload-item-top">
                      {item.status === "pending" ? (
                        <input
                          type="text"
                          className="upload-item-title-input"
                          value={item.title}
                          onChange={(e) => updateTitle(item.id, e.target.value)}
                          placeholder="Photo title"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="upload-item-title">{item.title || item.file.name}</span>
                      )}
                      <span className="upload-item-size">{humanSize(item.file.size)}</span>
                    </div>
                    {/* Progress bar */}
                    {(item.status === "uploading" || item.status === "done") && (
                      <div className="upload-item-progress">
                        <div
                          className={`upload-item-progress-fill ${item.status === "done" ? "is-done" : ""}`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}
                    {/* Status line */}
                    <div className="upload-item-status">
                      {item.status === "pending" && (
                        <span className="upload-status-pending">Pending</span>
                      )}
                      {item.status === "uploading" && (
                        <span className="upload-status-uploading">
                          <span className="spinner" style={{ width: 12, height: 12 }} /> Uploading {item.progress}%
                        </span>
                      )}
                      {item.status === "done" && (
                        <span className="upload-status-done">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Uploaded
                          {item.photoId && (
                            <a
                              href={`https://www.flickr.com/photos/upload/edit/?ids=${item.photoId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="upload-flickr-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View on Flickr
                            </a>
                          )}
                          {item.processed && (
                            <span className="upload-processed-badge">ML processed</span>
                          )}
                        </span>
                      )}
                      {item.status === "failed" && (
                        <span className="upload-status-failed">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                          </svg>
                          {item.error || "Failed"}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Remove button (only when not uploading) */}
                  {item.status !== "uploading" && (
                    <button
                      className="upload-item-remove"
                      onClick={() => removeItem(item.id)}
                      title="Remove from queue"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Empty state link */}
        {queue.length === 0 && !uploading && (
          <div className="upload-empty-hint">
            <p>Your uploaded photos will appear in the library after ML processing.</p>
            <Link href="/people" className="button ghost">
              Go to library
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
