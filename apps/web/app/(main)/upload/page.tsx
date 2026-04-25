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

/** Parse Flickr upload XML response to extract photo_id */
function parseFlickrResponse(xml: string): { ok: boolean; photoId?: string; error?: string } {
  // Success: <photoid>12345</photoid>
  const idMatch = xml.match(/<photoid>(\d+)<\/photoid>/);
  if (idMatch) return { ok: true, photoId: idMatch[1] };

  // Error: <err code="N" msg="..." />
  const errMatch = xml.match(/msg="([^"]+)"/);
  const statMatch = xml.match(/stat="(\w+)"/);
  if (statMatch && statMatch[1] === "fail") {
    return { ok: false, error: errMatch?.[1] || "Upload failed" };
  }

  return { ok: false, error: "Unexpected response from Flickr" };
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

  // Summary counters
  const totalCount = queue.length;
  const doneCount = queue.filter((q) => q.status === "done").length;
  const failedCount = queue.filter((q) => q.status === "failed").length;
  const processedCount = queue.filter((q) => q.processed).length;

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
    // 1. Sign the request
    const signResp = await fetch("/api/flickr/upload/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: item.title }),
    });
    if (!signResp.ok) {
      const err = await signResp.json().catch(() => ({ error: "Sign request failed" }));
      return { error: err.error || "Sign request failed" };
    }
    const oauthParams = await signResp.json();
    if (oauthParams.error) return { error: oauthParams.error };

    // 2. Build multipart form
    const formData = new FormData();
    // Add OAuth params first
    for (const [key, value] of Object.entries(oauthParams)) {
      formData.append(key, String(value));
    }
    // Add the photo last (Flickr requirement)
    formData.append("photo", item.file);

    // 3. Upload to Flickr
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
        const parsed = parseFlickrResponse(xhr.responseText);
        if (parsed.ok && parsed.photoId) {
          resolve({ photoId: parsed.photoId });
        } else {
          resolve({ error: parsed.error || "Upload failed" });
        }
      });

      xhr.addEventListener("error", () => resolve({ error: "Network error during upload" }));
      xhr.addEventListener("abort", () => resolve({ error: "Upload cancelled" }));

      xhr.open("POST", "https://up.flickr.com/services/upload/");
      xhr.send(formData);
    });

    return result;
  }

  /* ── Process photo on backend ────────────────────────────────────── */

  async function processPhoto(photoId: string): Promise<boolean> {
    try {
      const resp = await fetch(`${BACKEND}/process-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: photoId }),
      });
      return resp.ok;
    } catch {
      return false;
    }
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

        // Trigger ML processing in background
        processPhoto(result.photoId).then((ok) => {
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, processed: ok } : q))
          );
        });
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
            Drag and drop photos or use the file picker. Photos upload directly to Flickr,
            then get analyzed by the ML pipeline.
          </p>
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
