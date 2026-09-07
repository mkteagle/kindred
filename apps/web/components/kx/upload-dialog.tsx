"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { CloseIcon, UploadIcon } from "./icons";

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
}

interface Album {
  id: string | null;
  name: string;
  photo_count: number;
}

const ACCEPT = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE = 200 * 1024 * 1024; // Flickr's per-file ceiling

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

/**
 * The topbar's upload dialog. It mirrors the /upload flow — NAS original,
 * Flickr mirror, then the local ML pass — and posts to the same endpoint;
 * /upload stays as the full-page version for a long import.
 */
export function KxUploadDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumRef, setAlbumRef] = useState("");
  const [namingAlbum, setNamingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [albumError, setAlbumError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/albums?include_flickr=true`)
      .then((r) => (r.ok ? r.json() : { albums: [] }))
      .then((data) => setAlbums(data.albums ?? []))
      .catch(() => {
        // A missing album list should not block uploading.
      });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Object URLs are only valid while the dialog is open.
  useEffect(
    () => () => {
      setQueue((current) => {
        current.forEach((item) => URL.revokeObjectURL(item.preview));
        return current;
      });
    },
    [],
  );

  const addFiles = useCallback((files: FileList | File[]) => {
    const additions: QueueItem[] = [];
    for (const file of Array.from(files)) {
      if (!ACCEPT.includes(file.type) || file.size > MAX_SIZE) continue;
      additions.push({
        id: fileId(),
        file,
        title: stripExt(file.name),
        preview: URL.createObjectURL(file),
        status: "pending",
        progress: 0,
      });
    }
    if (additions.length) setQueue((prev) => [...prev, ...additions]);
  }, []);

  const removeItem = (id: string) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((q) => q.id !== id);
    });
  };

  async function createAlbum() {
    const name = newAlbumName.trim();
    if (!name) return;
    setAlbumError(null);
    try {
      const response = await fetch(`${BACKEND}/albums`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAlbumError(data.detail || "Could not create that album.");
        return;
      }
      setAlbums((prev) => [data, ...prev]);
      setAlbumRef(data.id);
      setNewAlbumName("");
      setNamingAlbum(false);
    } catch {
      setAlbumError("Could not reach the server.");
    }
  }

  function uploadOne(item: QueueItem): Promise<{ photoId?: string; error?: string }> {
    const formData = new FormData();
    formData.append("title", item.title);
    formData.append("photo", item.file);

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.round((event.loaded / event.total) * 100);
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, progress: pct } : q)));
      });
      xhr.addEventListener("load", () => {
        let parsed: { photo_id?: string; detail?: string; error?: string } = {};
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch {
          /* handled below */
        }
        if (xhr.status >= 200 && xhr.status < 300 && parsed.photo_id) resolve({ photoId: parsed.photo_id });
        else resolve({ error: parsed.detail || parsed.error || `Upload failed (${xhr.status})` });
      });
      xhr.addEventListener("error", () => resolve({ error: "Network error during upload" }));
      xhr.addEventListener("abort", () => resolve({ error: "Upload cancelled" }));
      const query = albumRef ? `?album_id=${encodeURIComponent(albumRef)}` : "";
      xhr.open("POST", `${BACKEND}/photos/upload${query}`);
      xhr.send(formData);
    });
  }

  async function startUpload() {
    abortRef.current = false;
    setUploading(true);
    // Snapshot: the queue changes underneath as each file reports progress.
    const pending = queue.filter((q) => q.status === "pending" || q.status === "failed");

    for (const item of pending) {
      if (abortRef.current) break;
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: "uploading", progress: 0, error: undefined } : q)),
      );
      const result = await uploadOne(item);
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? result.photoId
              ? { ...q, status: "done", progress: 100, photoId: result.photoId }
              : { ...q, status: "failed", error: result.error }
            : q,
        ),
      );
    }

    setUploading(false);
    // The library and its counts have both moved on.
    queryClient.invalidateQueries({ queryKey: ["library-mosaic"] });
    queryClient.invalidateQueries({ queryKey: ["library-counts"] });
  }

  const doneCount = queue.filter((q) => q.status === "done").length;
  const hasPending = queue.some((q) => q.status === "pending" || q.status === "failed");

  const statusLine = (item: QueueItem): { text: string; className: string } => {
    switch (item.status) {
      case "done":
        return { text: "Uploaded · analyzing", className: "done" };
      case "uploading":
        return { text: `Uploading ${item.progress}%`, className: "" };
      case "failed":
        return { text: item.error || "Upload failed", className: "failed" };
      default:
        return { text: "Pending", className: "" };
    }
  };

  return (
    <div
      className="kx-overlay upload"
      role="dialog"
      aria-modal="true"
      aria-label="Add to the library"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="kx-dialog upload">
        <div className="kx-dialog-head">
          <div>
            <span className="kx-eyebrow">Upload</span>
            <h2>Add to the library</h2>
            <p>Originals are saved to your NAS, mirrored to Flickr, then analyzed on your server.</p>
          </div>
          <button className="kx-iconbutton square" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="kx-albumrow">
          <span className="kx-eyebrow quiet">Album</span>
          {namingAlbum ? (
            <>
              <input
                className="kx-input"
                style={{ flex: "1 1 auto" }}
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                placeholder="Album name"
                aria-label="New album name"
                autoFocus
              />
              <button className="kx-button" onClick={createAlbum} disabled={!newAlbumName.trim()}>
                Create
              </button>
              <button className="kx-button" onClick={() => setNamingAlbum(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <select
                className="kx-select"
                value={albumRef}
                onChange={(e) => setAlbumRef(e.target.value)}
                aria-label="Album"
              >
                <option value="">No album</option>
                {albums.map((album) => (
                  <option key={album.id ?? album.name} value={album.id ?? ""}>
                    {album.name} ({fmt.format(album.photo_count)})
                  </option>
                ))}
              </select>
              <button className="kx-button" onClick={() => setNamingAlbum(true)}>
                New album
              </button>
            </>
          )}
        </div>
        {albumError && <p className="kx-note error">{albumError}</p>}

        <button
          className={`kx-dropzone ${dragOver ? "is-over" : ""}`.trim()}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          <UploadIcon size={34} />
          <span className="kx-dropzone-title">Drop photos here or browse files</span>
          <span className="kx-mono">JPG, PNG, GIF, WEBP up to 200 MB each</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT.join(",")}
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {queue.length > 0 && (
          <>
            <div className="kx-queuehead">
              <span className="kx-eyebrow quiet">
                {fmt.format(queue.length)} file{queue.length === 1 ? "" : "s"} in queue
              </span>
              <span className="kx-mono" style={{ marginLeft: "auto" }}>
                {fmt.format(doneCount)} / {fmt.format(queue.length)} uploaded
              </span>
            </div>

            <div className="kx-queue">
              {queue.map((item) => {
                const status = statusLine(item);
                return (
                  <div key={item.id} className="kx-queuerow">
                    <img src={item.preview} alt="" />
                    <span className="kx-queuerow-body">
                      <span className="kx-queuerow-name">
                        {item.title}
                        <span className="kx-mono">{humanSize(item.file.size)}</span>
                      </span>
                      {item.status !== "pending" && (
                        <span className={`kx-progress ${item.status === "done" ? "done" : ""}`.trim()}>
                          <span style={{ width: `${item.status === "done" ? 100 : item.progress}%` }} />
                        </span>
                      )}
                      <span className={`kx-mono ${status.className}`.trim()}>{status.text}</span>
                    </span>
                    {item.status === "pending" && (
                      <button
                        className="kx-removebutton"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remove ${item.title}`}
                      >
                        <CloseIcon size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="kx-dialog-foot">
          <button className="kx-button primary tall" onClick={startUpload} disabled={uploading || !hasPending}>
            {uploading ? "Uploading…" : "Upload all"}
          </button>
          <button className="kx-button tall" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
