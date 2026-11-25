"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { CloseIcon, UploadIcon } from "@/components/kx/icons";
import { avatarCrop, CENTERED_AVATAR, moveAvatar, type AvatarPosition } from "@/lib/avatar-crop";
import { BACKEND } from "@/lib/constants";
import { photoImageUrl } from "@/lib/image-delivery";
import { useSearchResults } from "@/lib/use-search-results";

interface AvatarEditorProps {
  currentAvatarUrl: string | null;
  displayName: string;
  userId: string;
  onSaved: (avatarUrl: string | null) => void;
  onClose: () => void;
}

type Photo = { photo_id: string; photo_title?: string | null; taken_at?: string | null };
type PhotoPage = { photos: Photo[]; next_cursor: string | null };
type PhotoSource = { label: string; url: string } | { label: string; file: File };
type GoogleSource = "available" | "linked" | "unlinked";

const AVATAR = BACKEND + "/users/me/avatar";
const GOOGLE_REFRESH = "/api/auth/google?link=1&return=" + encodeURIComponent("/settings?edit=photo");

async function requireOk(response: Response, message: string) {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.detail === "string" && response.status < 500 ? data.detail : message);
  }
  return response;
}

export function AvatarEditor({ currentAvatarUrl, displayName, userId, onSaved, onClose }: AvatarEditorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<PhotoSource | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState("");
  const [googlePhotoFailed, setGooglePhotoFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const sources = useQuery({
    queryKey: ["avatar-sources", userId],
    queryFn: async ({ signal }): Promise<{ google: GoogleSource }> => {
      const response = await fetch(AVATAR + "/sources", { signal });
      return (await requireOk(response, "Couldn’t check Google photo availability.")).json();
    },
    retry: false,
  });

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function decodePhoto(selected: PhotoSource) {
      try {
        const file = "file" in selected ? selected.file : await fetch(selected.url, { signal: controller.signal })
          .then((response) => requireOk(response, "Couldn’t open this photo."))
          .then((response) => response.blob());
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(file);
        const decoded = new Image();
        decoded.src = objectUrl;
        await decoded.decode();
        if (!controller.signal.aborted) setImage(decoded);
      } catch {
        if (!controller.signal.aborted) {
          const google = "url" in selected && selected.url === AVATAR + "/google";
          setSource(null);
          setGooglePhotoFailed(google);
          setError(google ? "Couldn’t open your Google photo. Refresh it or choose another photo."
            : "Couldn’t open this photo. Try another image.");
        }
      }
    }
    void decodePhoto(source);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  function choosePhoto(next: PhotoSource | null) {
    setError("");
    setGooglePhotoFailed(false);
    setImage(null);
    setSource(next);
  }

  async function saveAvatar(crop?: Promise<Blob>) {
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      const file = await crop;
      const body = file ? new FormData() : undefined;
      if (body && file) body.append("file", file, "profile-photo.png");
      const response = await fetch(AVATAR, { method: file ? "PUT" : "DELETE", body });
      await requireOk(response, file ? "Couldn’t save your profile photo." : "Couldn’t remove your profile photo.");
      onSaved(file ? (await response.json()).avatar_url : null);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t update your profile photo.");
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="avatar-editor" aria-labelledby="avatar-editor-title"
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <div className="avatar-editor-content">
      <header className="avatar-editor-header">
        <h2 id="avatar-editor-title">{source ? "Position your photo" : "Change profile photo"}</h2>
        <button type="button" className="kx-button avatar-editor-close" aria-label="Close photo editor" disabled={saving} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </header>

      {source ? (
        image
          ? <AvatarCrop image={image} label={source.label} saving={saving} error={error} onBack={() => choosePhoto(null)}
              onSave={saveAvatar} />
          : <div className="avatar-editor-body">
              <p role="status">Opening photo…</p>
              <button type="button" className="kx-button" onClick={() => choosePhoto(null)}>Back</button>
            </div>
      ) : (
        <div className="avatar-editor-body">
          <div className="avatar-editor-current">
            <span className="kx-avatar lg" aria-hidden="true">
              {currentAvatarUrl ? <img src={BACKEND + currentAvatarUrl} alt="" /> : displayName.charAt(0).toUpperCase()}
            </span>
            <div><strong>{displayName}</strong><span>{currentAvatarUrl ? "Current profile photo" : "No profile photo yet"}</span></div>
            {currentAvatarUrl && <button type="button" className="avatar-editor-remove" disabled={saving}
              onClick={() => void saveAvatar()}>Remove photo</button>}
          </div>
          <div className="avatar-editor-sources">
            <button type="button" className="kx-button" disabled={saving} onClick={() => fileInput.current?.click()}>
              <UploadIcon size={16} /> Upload photo
            </button>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                  setError("Choose a JPG, PNG, or WebP image under 5 MB.");
                  return;
                }
                choosePhoto({ file, label: file.name });
              }} />
            {sources.data?.google === "available" && !googlePhotoFailed && <button type="button" className="kx-button" disabled={saving}
              onClick={() => choosePhoto({ url: AVATAR + "/google", label: "Google profile photo" })}>Use Google photo</button>}
            {(sources.data?.google === "linked" || googlePhotoFailed) && !saving &&
              <a className="kx-button" href={GOOGLE_REFRESH}>Refresh Google photo</a>}
          </div>
          {error && <p className="avatar-editor-error" role="alert">{error}</p>}
          <AvatarLibrary disabled={saving} onChoose={(photo) => choosePhoto({
            url: photoImageUrl(photo.photo_id, 1280, "jpeg"), label: photo.photo_title || "Library photo",
          })} />
        </div>
      )}
    </div>
  </dialog>;
}

function AvatarLibrary({ disabled, onChoose }: { disabled: boolean; onChoose: (photo: Photo) => void }) {
  const [query, setQuery] = useState("");
  const [searchText, setSearchText] = useState("");
  const trimmed = query.trim();
  const searching = trimmed.length >= 2;
  useEffect(() => {
    const timer = setTimeout(() => setSearchText(trimmed), 250);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const recent = useInfiniteQuery({
    queryKey: ["avatar-library"],
    enabled: !searching,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }): Promise<PhotoPage> => {
      const params = new URLSearchParams({ media: "photo", sort: "newest", limit: "30" });
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(BACKEND + "/library/photos?" + params, { signal });
      return (await requireOk(response, "Couldn’t open your library.")).json();
    },
    getNextPageParam: (page) => page.next_cursor || undefined,
    retry: false,
  });

  const settled = searchText === trimmed;
  const search = useSearchResults(new URLSearchParams({ q: searchText, media: "photo" }).toString(), 48, searching && settled, false);
  const photos: Photo[] = searching ? (settled ? search.results : []) : recent.data?.pages.flatMap((page) => page.photos) ?? [];
  const loading = searching ? !settled || search.loading : recent.isPending;
  const failed = searching ? settled && search.error : recent.isError;

  return <section className="avatar-editor-library" aria-labelledby="avatar-library-heading">
    <div className="avatar-editor-library-heading">
      <h3 id="avatar-library-heading">From your library</h3>
      <input type="search" aria-label="Search library photos" placeholder="Search photos" value={query}
        disabled={disabled} onChange={(event) => setQuery(event.target.value)} />
    </div>
    {loading && <p role="status">Loading photos…</p>}
    {failed && <div className="avatar-editor-retry">
      <p role="alert">Couldn’t load photos.</p>
      <button className="kx-button" type="button" disabled={disabled || recent.isFetchingNextPage}
        onClick={() => void (searching ? search.retry() : recent.isFetchNextPageError ? recent.fetchNextPage() : recent.refetch())}>Retry</button>
    </div>}
    {!failed && !loading && !photos.length && <p>{searching ? "No matching photos." : "No photos in your library yet."}</p>}
    {!!photos.length && <div className="avatar-editor-grid">
      {photos.map((photo) => (
        <button key={photo.photo_id} type="button" disabled={disabled} onClick={() => onChoose(photo)}
          aria-label={photo.photo_title || (photo.taken_at ? "Photo taken " + photo.taken_at.slice(0, 10) : "Library photo")}>
          <img src={photoImageUrl(photo.photo_id, 160)} alt="" loading="lazy" />
        </button>
      ))}
    </div>}
    {!searching && recent.hasNextPage && !failed && <button type="button" className="kx-button avatar-editor-more"
      disabled={disabled || recent.isFetchingNextPage} onClick={() => void recent.fetchNextPage()}>
      {recent.isFetchingNextPage ? "Loading photos…" : "Load more photos"}
    </button>}
  </section>;
}

function AvatarCrop({ image, label, saving, error, onBack, onSave }: {
  image: HTMLImageElement;
  label: string;
  saving: boolean;
  error: string;
  onBack: () => void;
  onSave: (file: Promise<Blob>) => Promise<void>;
}) {
  const [position, setPosition] = useState<AvatarPosition>(CENTERED_AVATAR);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const { naturalWidth: width, naturalHeight: height } = image;
  const crop = avatarCrop(width, height, position);

  useEffect(() => { frame.current?.focus(); }, []);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (saving || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function dragPhoto(event: PointerEvent<HTMLDivElement>) {
    const started = drag.current;
    if (!started || started.id !== event.pointerId) return;
    const scale = crop.size / event.currentTarget.getBoundingClientRect().width;
    const dx = (event.clientX - started.x) * scale;
    const dy = (event.clientY - started.y) * scale;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setPosition((current) => moveAvatar(width, height, current, dx, dy));
  }

  function saveCrop() {
    if (saving) return;
    void onSave(new Promise<Blob>((resolve, reject) => {
      const failure = new Error("Couldn’t crop this photo. Try another image.");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const context = canvas.getContext("2d");
      if (!context) throw failure;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, crop.left, crop.top, crop.size, crop.size, 0, 0, 512, 512);
      canvas.toBlob((file) => { if (file) resolve(file); else reject(failure); }, "image/png");
    }));
  }

  return <>
    <div className="avatar-editor-body avatar-editor-crop">
      <p id="avatar-crop-instructions">Drag to position the photo, or use the arrow keys. Zoom to frame it.</p>
      <div ref={frame} className="avatar-editor-frame" role="group" tabIndex={0} aria-label="Crop preview" aria-describedby="avatar-crop-instructions"
        onPointerDown={startDrag} onPointerMove={dragPhoto} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          const direction = directions[event.key];
          if (saving || !direction) return;
          event.preventDefault();
          const step = crop.size * (event.shiftKey ? 0.1 : 0.025);
          setPosition((current) => moveAvatar(width, height, current, direction[0] * step, direction[1] * step));
        }}>
        <img src={image.src} alt={label} draggable={false}
          style={{ width: width / crop.size * 100 + "%", left: -crop.left / crop.size * 100 + "%", top: -crop.top / crop.size * 100 + "%" }} />
      </div>
      <div className="avatar-editor-zoom">
        <label htmlFor="avatar-photo-zoom">Zoom</label>
        <input id="avatar-photo-zoom" type="range" min="1" max="4" step="0.05" value={position.zoom} disabled={saving}
          onChange={(event) => {
            const zoom = Number(event.currentTarget.value);
            setPosition((current) => moveAvatar(width, height, { ...current, zoom }, 0, 0));
          }} />
        <button className="kx-button" type="button" disabled={saving} onClick={() => setPosition(CENTERED_AVATAR)}>Reset</button>
      </div>
      {error && <p className="avatar-editor-error" role="alert">{error}</p>}
    </div>
    <footer className="avatar-editor-footer">
      <button type="button" className="kx-button" disabled={saving} onClick={onBack}>Back</button>
      <button type="button" className="kx-button primary" disabled={saving} onClick={saveCrop}>
        {saving ? "Saving…" : "Save photo"}
      </button>
    </footer>
  </>;
}
