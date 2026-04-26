"use client";

import { useEffect, useRef, useState } from "react";
import { BACKEND } from "@/lib/constants";

interface AvatarEditorProps {
  currentAvatarUrl: string | null;
  displayName: string;
  onSaved: (newAvatarUrl: string | null) => void;
  onClose: () => void;
}

interface LibraryPhoto {
  photo_id: string;
  thumb_url: string;
  photo_url: string;
  photo_title: string;
}

export function AvatarEditor({ currentAvatarUrl, displayName, onSaved, onClose }: AvatarEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"library" | "upload">("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [photos, setPhotos] = useState<LibraryPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Load recent photos or search results
  useEffect(() => {
    setLoading(true);
    const url = debouncedQuery.length > 1
      ? `${BACKEND}/search?q=${encodeURIComponent(debouncedQuery)}&limit=24`
      : `${BACKEND}/timeline?limit=24`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (debouncedQuery.length > 1) {
          // Search results
          setPhotos(
            (data || []).map((r: Record<string, string>) => ({
              photo_id: r.photo_id,
              thumb_url: r.thumb_url || r.photo_url,
              photo_url: r.photo_url,
              photo_title: r.photo_title || "",
            }))
          );
        } else {
          // Timeline — flatten months
          const months = data?.months || [];
          const allPhotos: LibraryPhoto[] = [];
          for (const m of months) {
            for (const p of m.photos || []) {
              allPhotos.push({
                photo_id: p.photo_id,
                thumb_url: p.thumb_url || "",
                photo_url: p.thumb_url || "",
                photo_title: p.photo_title || "",
              });
              if (allPhotos.length >= 24) break;
            }
            if (allPhotos.length >= 24) break;
          }
          setPhotos(allPhotos);
        }
      })
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  }, [debouncedQuery]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be under 5MB");
      return;
    }
    setUploadFile(file);
    const reader = new FileReader();
    reader.onload = () => setUploadPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (tab === "library" && selectedPhotoId) {
        const resp = await fetch(`${BACKEND}/users/me/avatar`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photo_id: selectedPhotoId }),
        });
        const data = await resp.json();
        if (resp.ok) {
          onSaved(data.avatar_url);
          onClose();
        }
      } else if (tab === "upload" && uploadFile) {
        const formData = new FormData();
        formData.append("file", uploadFile);
        const resp = await fetch(`${BACKEND}/users/me/avatar`, {
          method: "PUT",
          body: formData,
        });
        const data = await resp.json();
        if (resp.ok) {
          onSaved(data.avatar_url);
          onClose();
        }
      }
    } catch (err) {
      console.error("Failed to save avatar:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await fetch(`${BACKEND}/users/me/avatar`, { method: "DELETE" });
      onSaved(null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    (tab === "library" && selectedPhotoId) ||
    (tab === "upload" && uploadFile);

  const initial = (displayName || "?").charAt(0).toUpperCase();

  return (
    <dialog
      ref={dialogRef}
      className="avatar-editor"
      onClose={onClose}
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="avatar-editor-content">
        <div className="avatar-editor-header">
          <h3>Change profile photo</h3>
          <button className="avatar-editor-close" onClick={onClose}>&times;</button>
        </div>

        {/* Current avatar preview */}
        <div className="avatar-editor-preview">
          {currentAvatarUrl ? (
            <img
              src={`${BACKEND}${currentAvatarUrl}?t=${Date.now()}`}
              alt="Current avatar"
              className="avatar-editor-current"
            />
          ) : (
            <div className="avatar-editor-initials">{initial}</div>
          )}
          {currentAvatarUrl && (
            <button className="avatar-editor-remove" onClick={handleRemove} disabled={saving}>
              Remove photo
            </button>
          )}
        </div>

        {/* Tab switcher */}
        <div className="avatar-editor-tabs">
          <button
            className={`avatar-editor-tab ${tab === "library" ? "active" : ""}`}
            onClick={() => setTab("library")}
          >
            From library
          </button>
          <button
            className={`avatar-editor-tab ${tab === "upload" ? "active" : ""}`}
            onClick={() => setTab("upload")}
          >
            Upload
          </button>
        </div>

        {/* Tab content */}
        <div className="avatar-editor-body">
          {tab === "library" && (
            <>
              <div className="avatar-editor-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mist)"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search your photos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="avatar-editor-clear" onClick={() => setSearchQuery("")}>&times;</button>
                )}
              </div>
              <div className="avatar-editor-grid">
                {loading && <div className="avatar-editor-loading">Loading...</div>}
                {!loading && photos.length === 0 && (
                  <div className="avatar-editor-empty">No photos found</div>
                )}
                {!loading && photos.map((p) => (
                  <button
                    key={p.photo_id}
                    className={`avatar-editor-photo ${selectedPhotoId === p.photo_id ? "selected" : ""}`}
                    onClick={() => setSelectedPhotoId(p.photo_id)}
                  >
                    <img src={p.thumb_url} alt={p.photo_title} />
                    {selectedPhotoId === p.photo_id && (
                      <div className="avatar-editor-check">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                          stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === "upload" && (
            <div className="avatar-editor-upload">
              {uploadPreview ? (
                <div className="avatar-editor-upload-preview">
                  <div className="avatar-editor-crop-frame">
                    <img src={uploadPreview} alt="Preview" />
                  </div>
                  <button
                    className="avatar-editor-change-file"
                    onClick={() => { setUploadFile(null); setUploadPreview(null); }}
                  >
                    Choose different image
                  </button>
                </div>
              ) : (
                <label className="avatar-editor-dropzone">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--mist)"
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>Click to choose an image</span>
                  <span className="avatar-editor-hint">JPG, PNG, or WebP. Max 5MB.</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />
                </label>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="avatar-editor-footer">
          <button className="button ghost" onClick={onClose}>Cancel</button>
          <button
            className="button primary"
            disabled={!canSave || saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
