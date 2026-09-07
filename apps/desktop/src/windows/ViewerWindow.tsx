// Window 2 — Viewer. 1080×700.
//
// A dark stage, a 50px filmstrip along the bottom, and a docked 300px
// inspector. It is a real window: ⌘⇧N tears off another one on the same photo,
// and each keeps its own position in the strip.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  Button,
  ChevronLeft,
  ChevronRight,
  Eyebrow,
  HeartIcon,
  Kbd,
  KbdHint,
  QuietEyebrow,
  TitleBar,
} from "../desktop/Chrome";
import { desktop, onMenuCommand, type MediaRef } from "../lib/desktop";
import { formatBytes, formatStamp } from "../lib/format";
import { library, type Detection, type PhotoMetadata } from "../lib/library";
import { useMedia } from "../lib/media";

type ViewerParams = { photoId?: string; photoIds?: string[] };

export function ViewerWindow({ params }: { params: ViewerParams }) {
  const ids = useMemo(
    () => (params.photoIds?.length ? params.photoIds : params.photoId ? [params.photoId] : []),
    [params],
  );
  const [index, setIndex] = useState(() => {
    const at = params.photoId ? ids.indexOf(params.photoId) : 0;
    return at < 0 ? 0 : at;
  });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const photoId = ids[index] ?? null;
  const media = useMedia(photoId, "preview");

  const step = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(ids.length - 1, Math.max(0, current + delta)));
    },
    [ids.length],
  );

  // Bare keys: ← → step, F full screen. These are DOM listeners rather than
  // menu accelerators so a single letter never gets stolen from a text field.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        const window_ = getCurrentWindow();
        void window_
          .isFullscreen()
          .then((full) => window_.setFullscreen(!full))
          .catch(() => {});
      } else if (event.key === "Escape") {
        void getCurrentWindow().setFullscreen(false).catch(() => {});
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step]);

  useEffect(() => {
    const unlisten = onMenuCommand((id) => {
      if (id === "step-next") step(1);
      else if (id === "step-previous") step(-1);
      else if (id === "toggle-inspector") setInspectorOpen((open) => !open);
      else if (id === "new-window" && photoId) {
        void desktop.openWindow("viewer", { photoId, photoIds: ids });
      } else if (id === "reveal" && photoId) {
        void revealSelected(photoId).catch((e) => setNotice(String(e)));
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [step, photoId, ids]);

  const title = photoId ? `${index + 1} of ${ids.length}` : "Nothing to show";

  return (
    <div className="k-root">
      <TitleBar title={`Kindred — ${title}`} />
      <div className="k-body" style={{ background: "var(--k-stage)" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              flex: "1 1 auto",
              display: "grid",
              placeItems: "center",
              padding: 24,
              minHeight: 0,
            }}
          >
            {media.src ? (
              <img
                src={media.src}
                alt=""
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  borderRadius: 3,
                  boxShadow: "0 30px 80px rgba(0,0,0,.6)",
                }}
              />
            ) : (
              <p style={{ color: "var(--k-ink-4)", fontSize: 13, textAlign: "center" }}>
                {media.loading
                  ? "Fetching from the server…"
                  : "Not kept offline, and the server did not answer."}
              </p>
            )}
          </div>
          <Filmstrip ids={ids} index={index} onPick={setIndex} onStep={step} />
        </div>
        {inspectorOpen && photoId ? (
          <Inspector
            photoId={photoId}
            notice={notice}
            onNotice={setNotice}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ── Filmstrip ────────────────────────────────────────────────────────── */

function Filmstrip({
  ids,
  index,
  onPick,
  onStep,
}: {
  ids: string[];
  index: number;
  onPick: (index: number) => void;
  onStep: (delta: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Keep the current frame in view as ← / → walk the strip.
  useEffect(() => {
    const current = stripRef.current?.querySelector<HTMLElement>('[data-current="true"]');
    current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [index]);

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderTop: "1px solid var(--k-line)",
      }}
    >
      <button
        type="button"
        className="k-btn k-btn-quiet"
        style={{ width: 30, padding: 0 }}
        aria-label="Previous photo"
        onClick={() => onStep(-1)}
      >
        <ChevronLeft size={16} />
      </button>
      <div
        ref={stripRef}
        role="listbox"
        aria-label="Filmstrip"
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 3,
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {ids.map((id, at) => (
          <Frame key={id} photoId={id} current={at === index} onPick={() => onPick(at)} />
        ))}
      </div>
      <button
        type="button"
        className="k-btn k-btn-quiet"
        style={{ width: 30, padding: 0 }}
        aria-label="Next photo"
        onClick={() => onStep(1)}
      >
        <ChevronRight size={16} />
      </button>
      <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
        <KbdHint keys={["←", "→"]} label="step" />
        <KbdHint keys={["F"]} label="full screen" />
        <KbdHint keys={["⌘⇧N"]} label="new window" />
      </span>
    </div>
  );
}

function Frame({
  photoId,
  current,
  onPick,
}: {
  photoId: string;
  current: boolean;
  onPick: () => void;
}) {
  const media = useMedia(photoId, "thumb");
  const size = current ? 58 : 50;
  return (
    <button
      type="button"
      role="option"
      aria-selected={current}
      data-current={current}
      onClick={onPick}
      style={{
        width: size,
        height: size,
        flex: "none",
        padding: 0,
        border: "none",
        borderRadius: 3,
        background: "var(--k-tile)",
        overflow: "hidden",
        opacity: current ? 1 : 0.5,
        outline: current ? "2px solid var(--k-terracotta)" : undefined,
        outlineOffset: current ? -2 : undefined,
      }}
    >
      {media.src ? (
        <img src={media.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
    </button>
  );
}

/* ── Inspector ────────────────────────────────────────────────────────── */

async function revealSelected(photoId: string) {
  const ref: MediaRef = await desktop.mediaRef(photoId, "original");
  if (!ref.path) {
    // Reveal only makes sense once the file is actually here.
    const paths = await desktop.prepareOriginals([photoId]);
    await revealItemInDir(paths[0]);
    return;
  }
  await revealItemInDir(ref.path);
}

function Inspector({
  photoId,
  notice,
  onNotice,
}: {
  photoId: string;
  notice: string | null;
  onNotice: (message: string | null) => void;
}) {
  const [metadata, setMetadata] = useState<PhotoMetadata | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [cached, setCached] = useState<MediaRef | null>(null);
  // TODO: there is no per-photo favourite flag on any read endpoint —
  // /favorites is a paged list, so knowing whether *this* photo is a favourite
  // means walking it. A `favorited` boolean on /photos/{id}/metadata, or a
  // `GET /photos/{id}/favorite`, would let this open in the right state.
  const [favorited, setFavorited] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setMetadata(null);
    setDetections([]);
    setCached(null);
    library
      .photoMetadata(photoId)
      .then((m) => live && setMetadata(m))
      .catch(() => {});
    library
      .photoDetections(photoId)
      .then((d) => live && setDetections(d.detections ?? []))
      .catch(() => {});
    // What the cache actually holds, so the "Kept offline" line tells the
    // truth. `cachedMedia` never fetches, so asking first means opening a
    // photo does not quietly pull a 40 MB original.
    desktop
      .cachedMedia([photoId], "original")
      .then((ids) => {
        if (!live || ids.length === 0) return;
        return desktop.mediaRef(photoId, "original").then((ref) => {
          if (live) setCached(ref);
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [photoId]);

  const people = detections.filter((d) => d.category === "people" && d.cluster_label);
  const objects = Array.from(
    new Set(detections.filter((d) => d.subtype).map((d) => d.subtype as string)),
  ).slice(0, 8);

  const toggleFavorite = async () => {
    setBusy(true);
    try {
      // Server-confirmed: the pill only flips once the write lands.
      await library.setFavorite(photoId, !favorited);
      setFavorited((f) => !f);
      onNotice(null);
    } catch (e) {
      onNotice(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      aria-label="Photo details"
      style={{
        width: 300,
        flex: "none",
        borderLeft: "1px solid var(--k-line)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: "var(--k-bg)",
        overflowY: "auto",
      }}
    >
      <Eyebrow>Photo</Eyebrow>
      <strong
        className="k-display"
        style={{ fontSize: 19, lineHeight: 1.2, fontFamily: "var(--font-display)" }}
      >
        {metadata?.description || "Untitled"}
      </strong>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="k-mono-11">{formatStamp(metadata?.date_taken)}</span>
        <span className="k-mono-11">
          {metadata?.location_name ??
            (metadata?.latitude != null && metadata?.longitude != null
              ? `${metadata.latitude.toFixed(4)}, ${metadata.longitude.toFixed(4)}`
              : "No place recorded")}
        </span>
        <span className="k-mono-11">
          {cached?.bytes ? formatBytes(cached.bytes) : "Size unknown until downloaded"}
        </span>
        {/* TODO: camera settings — "f/1.8 · 1/60s · ISO 800". photo_metadata
            has no aperture/shutter/ISO columns and /photos/{id}/metadata does
            not return them; an EXIF passthrough on that endpoint would close it. */}
        <span className="k-mono-11">
          {cached ? "Kept offline · original on the server" : "Not kept offline"}
        </span>
      </div>

      {people.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <QuietEyebrow>People here</QuietEyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {people.map((person) => (
              <span key={person.id} className="k-pill k-pill-outline k-pill-name">
                {person.chip ? (
                  <img
                    src={person.chip}
                    alt=""
                    style={{ width: 20, height: 20, borderRadius: 999, objectFit: "cover" }}
                  />
                ) : null}
                {person.cluster_label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {objects.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <QuietEyebrow>Also in view</QuietEyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {objects.map((object) => (
              <span key={object} className="k-pill">
                {object}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {notice ? (
        <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--k-ink-3)" }}>
          {notice}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
        <Button
          variant="primary"
          onClick={() =>
            onNotice(
              // TODO: POST /shares takes an album reference, not a photo id.
              "Sharing a single photo needs /shares to accept photo ids.",
            )
          }
        >
          Share
        </Button>
        <Button onClick={() => void toggleFavorite()} disabled={busy} aria-pressed={favorited}>
          <HeartIcon size={14} filled={favorited} />
          {favorited ? "Favorited" : "Favorite"}
        </Button>
        <Button onClick={() => void revealSelected(photoId).catch((e) => onNotice(String(e)))}>
          Reveal in Finder
        </Button>
      </div>
      <span style={{ display: "flex", gap: 8 }}>
        <Kbd>⌘I</Kbd>
        <span className="k-mono">hide this panel</span>
      </span>
    </aside>
  );
}
