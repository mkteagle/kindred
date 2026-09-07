"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/lib/use-user";
import { BACKEND, fmt } from "@/lib/constants";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface LightboxPhoto {
  photo_id: string;
  thumb_url: string;
  flickr_url?: string;
  photo_url?: string;
  photo_title?: string;
  date_taken?: string;
}

interface LightboxState {
  open: boolean;
  photoId: string | null;
  photos: LightboxPhoto[];
  index: number;
}

interface LightboxContextValue {
  openLightbox: (photoId: string, photos: LightboxPhoto[]) => void;
  closeLightbox: () => void;
}

interface PhotoMetadata {
  photo_id: string;
  date_taken?: string;
  latitude?: number;
  longitude?: number;
  location_name?: string;
  camera_make?: string;
  camera_model?: string;
  lens?: string;
  focal_length?: string;
  aperture?: string;
  shutter_speed?: string;
  iso?: number;
  width?: number;
  height?: number;
  tags?: string;
}

interface PhotoDetection {
  id: string;
  category: string;
  subtype: string;
  det_score: number;
  chip: string;
  cluster_id: string | null;
  cluster_label: string | null;
}

interface PhotoDetectionsResponse {
  photo_id: string;
  photo_url: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
  detections: PhotoDetection[];
}

/* ── Context ────────────────────────────────────────────────────────── */

const LightboxContext = createContext<LightboxContextValue>({
  openLightbox: () => {},
  closeLightbox: () => {},
});

export function useLightbox() {
  return useContext(LightboxContext);
}

/* ── Provider ───────────────────────────────────────────────────────── */

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const [state, setState] = useState<LightboxState>({
    open: false,
    photoId: null,
    photos: [],
    index: 0,
  });

  // Sync from URL query param on mount
  useEffect(() => {
    const paramId = searchParams.get("photo");
    if (paramId && !state.open) {
      setState((s) => ({
        ...s,
        open: true,
        photoId: paramId,
        index: s.photos.findIndex((p) => p.photo_id === paramId),
      }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openLightbox = useCallback(
    (photoId: string, photos: LightboxPhoto[]) => {
      const idx = photos.findIndex((p) => p.photo_id === photoId);
      setState({
        open: true,
        photoId,
        photos,
        index: idx >= 0 ? idx : 0,
      });
      // Push query param for shareability
      const url = new URL(window.location.href);
      url.searchParams.set("photo", photoId);
      window.history.pushState({}, "", url.toString());
    },
    []
  );

  const closeLightbox = useCallback(() => {
    setState({ open: false, photoId: null, photos: [], index: 0 });
    // Remove query param
    const url = new URL(window.location.href);
    url.searchParams.delete("photo");
    window.history.pushState({}, "", url.toString());
  }, []);

  const goTo = useCallback(
    (newIndex: number) => {
      const photos = state.photos;
      if (newIndex < 0 || newIndex >= photos.length) return;
      const photo = photos[newIndex];
      setState((s) => ({
        ...s,
        photoId: photo.photo_id,
        index: newIndex,
      }));
      const url = new URL(window.location.href);
      url.searchParams.set("photo", photo.photo_id);
      window.history.replaceState({}, "", url.toString());
    },
    [state.photos]
  );

  // Handle browser back button
  useEffect(() => {
    const handlePop = () => {
      const url = new URL(window.location.href);
      const paramId = url.searchParams.get("photo");
      if (!paramId) {
        setState({ open: false, photoId: null, photos: [], index: 0 });
      }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  return (
    <LightboxContext.Provider value={{ openLightbox, closeLightbox }}>
      {children}
      {state.open && state.photoId && (
        <PhotoLightboxOverlay
          photoId={state.photoId}
          photos={state.photos}
          index={state.index}
          onClose={closeLightbox}
          onGoTo={goTo}
        />
      )}
    </LightboxContext.Provider>
  );
}

/* ── Lightbox Overlay ───────────────────────────────────────────────── */

function PhotoLightboxOverlay({
  photoId,
  photos,
  index,
  onClose,
  onGoTo,
}: {
  photoId: string;
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onGoTo: (idx: number) => void;
}) {
  const { isAdmin } = useUser();
  const [infoOpen, setInfoOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const thumbStripRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  const currentPhoto = photos[index] || null;
  const total = photos.length;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  // Fetch metadata
  const { data: metadata } = useQuery<PhotoMetadata>({
    queryKey: ["photo-metadata", photoId],
    queryFn: () =>
      fetch(`${BACKEND}/photos/${photoId}/metadata`).then((r) => {
        if (!r.ok) return null;
        return r.json();
      }),
    enabled: !!photoId,
    staleTime: 10 * 60 * 1000,
  });

  // Fetch detections (people tags)
  const { data: detections } = useQuery<PhotoDetectionsResponse>({
    queryKey: ["photo-detections-lb", photoId],
    queryFn: () =>
      fetch(`${BACKEND}/photos/${photoId}/detections`).then((r) => {
        if (!r.ok) return null;
        return r.json();
      }),
    enabled: !!photoId,
    staleTime: 10 * 60 * 1000,
  });

  // Reset state on photo change
  useEffect(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setImageLoaded(false);
    setImageError(false);
    setImageAttempt(0);
    setMoreOpen(false);
    setShareOpen(false);
    setCopySuccess(false);
  }, [photoId]);

  // Scroll active thumb into view
  useEffect(() => {
    if (!thumbStripRef.current) return;
    const active = thumbStripRef.current.querySelector(".lb-thumb.is-active");
    if (active) {
      active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [index]);

  // Close popovers on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture if a popover input is focused
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          if (hasPrev) onGoTo(index - 1);
          break;
        case "ArrowRight":
          if (hasNext) onGoTo(index + 1);
          break;
        case "+":
        case "=":
          e.preventDefault();
          setZoom((z) => (z >= 4 ? 1 : z * 2));
          setPanOffset({ x: 0, y: 0 });
          break;
        case "-":
          e.preventDefault();
          setZoom((z) => (z <= 1 ? 1 : z / 2));
          setPanOffset({ x: 0, y: 0 });
          break;
        case "0":
          setZoom(1);
          setPanOffset({ x: 0, y: 0 });
          break;
        case "i":
          setInfoOpen((v) => !v);
          break;
        case "h":
          // Heart toggle — placeholder, no backend endpoint yet
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, onGoTo, index, hasPrev, hasNext]);

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Zoom on click
  const handleImageClick = useCallback(() => {
    if (dragging) return;
    setZoom((z) => {
      const next = z >= 4 ? 1 : z * 2;
      if (next === 1) setPanOffset({ x: 0, y: 0 });
      return next;
    });
  }, [dragging]);

  // Zoom on scroll wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      setZoom((z) => Math.min(4, z * 1.25));
    } else {
      setZoom((z) => {
        const next = Math.max(1, z / 1.25);
        if (next <= 1) setPanOffset({ x: 0, y: 0 });
        return next;
      });
    }
  }, []);

  // Pan when zoomed
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1) return;
      e.preventDefault();
      setDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    },
    [zoom, panOffset]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    },
    [dragging, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Touch pan support
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (zoom <= 1) return;
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX - panOffset.x, y: t.clientY - panOffset.y };
    },
    [zoom, panOffset]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || zoom <= 1) return;
      e.preventDefault();
      const t = e.touches[0];
      setPanOffset({
        x: t.clientX - touchStartRef.current.x,
        y: t.clientY - touchStartRef.current.y,
      });
    },
    [zoom]
  );

  // Download handler
  const handleDownload = useCallback(() => {
    const url = `${BACKEND}/photos/${photoId}/image?size=o`;
    const a = document.createElement("a");
    a.href = url;
    a.download = currentPhoto?.photo_title || `photo-${photoId}`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [photoId, currentPhoto]);

  // Copy link
  const handleCopyLink = useCallback(async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("photo", photoId);
      await navigator.clipboard.writeText(url.toString());
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      /* clipboard API not available */
    }
  }, [photoId]);

  // People detections (cluster-labeled)
  const peopleTags = useMemo(() => {
    if (!detections?.detections) return [];
    return detections.detections.filter(
      (d) => d.category === "people" && d.cluster_label
    );
  }, [detections]);

  // Group all detections by category
  const groupedDetections = useMemo(() => {
    if (!detections?.detections) return {};
    const groups: Record<string, PhotoDetection[]> = {};
    for (const d of detections.detections) {
      if (!groups[d.category]) groups[d.category] = [];
      groups[d.category].push(d);
    }
    return groups;
  }, [detections]);

  const imageUrl = `${BACKEND}/photos/${photoId}/image?size=h`;
  const thumbUrl = currentPhoto?.thumb_url || "";

  return (
    <div
      className="lb-overlay"
      ref={containerRef}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
    >
      {/* ── Top bar ─────────────────────────────────────────── */}
      <div className="lb-topbar">
        <button className="lb-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {total > 0 && (
          <span className="lb-counter">
            {fmt.format(index + 1)} / {fmt.format(total)}
          </span>
        )}

        <span className="lb-title">
          {currentPhoto?.photo_title || detections?.photo_title || ""}
        </span>

        <div className="lb-actions">
          {/* Share */}
          <div className="lb-action-wrap" ref={shareRef}>
            <button
              className="lb-action-btn"
              onClick={() => { setShareOpen(!shareOpen); setMoreOpen(false); }}
              aria-label="Share"
              title="Share"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
            {shareOpen && (
              <div className="lb-popover">
                <button className="lb-popover-row" onClick={handleCopyLink}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  {copySuccess ? "Copied!" : "Copy private link"}
                </button>
                <button className="lb-popover-row" onClick={handleDownload}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download original
                </button>
              </div>
            )}
          </div>

          {/* Download */}
          <button className="lb-action-btn" onClick={handleDownload} aria-label="Download" title="Download original">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          {/* Info toggle */}
          <button
            className={`lb-action-btn ${infoOpen ? "is-active" : ""}`}
            onClick={() => setInfoOpen(!infoOpen)}
            aria-label="Info"
            title="Toggle info (I)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>

          {/* More */}
          <div className="lb-action-wrap" ref={moreRef}>
            <button
              className="lb-action-btn"
              onClick={() => { setMoreOpen(!moreOpen); setShareOpen(false); }}
              aria-label="More"
              title="More actions"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
              </svg>
            </button>
            {moreOpen && (
              <div className="lb-popover">
                {currentPhoto?.flickr_url && (
                  <a
                    href={currentPhoto.flickr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lb-popover-row"
                    onClick={() => setMoreOpen(false)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    Open in Flickr
                  </a>
                )}
                {isAdmin && (
                  <>
                    <div className="lb-popover-divider" />
                    <span className="lb-popover-admin-label">ADMIN</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Prev arrow ──────────────────────────────────────── */}
      {hasPrev && (
        <button
          className="lb-arrow lb-arrow-prev"
          onClick={() => onGoTo(index - 1)}
          aria-label="Previous photo"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* ── Next arrow ──────────────────────────────────────── */}
      {hasNext && (
        <button
          className={`lb-arrow lb-arrow-next ${infoOpen ? "lb-arrow-next-shifted" : ""}`}
          onClick={() => onGoTo(index + 1)}
          aria-label="Next photo"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* ── Main image ──────────────────────────────────────── */}
      <div
        className={`lb-image-area ${infoOpen ? "lb-image-area-with-info" : ""}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        style={{ cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in" }}
      >
        {/* Blur-up placeholder */}
        {!imageLoaded && thumbUrl && (
          <img
            src={thumbUrl}
            alt=""
            className="lb-placeholder"
            style={{ filter: "blur(20px)", transform: "scale(1.1)" }}
          />
        )}

        {/* Full image */}
        <img
          ref={imageRef}
          src={`${imageUrl}&retry=${imageAttempt}`}
          alt={currentPhoto?.photo_title || ""}
          className={`lb-main-image ${imageLoaded ? "is-loaded" : ""}`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          onClick={handleImageClick}
          draggable={false}
          style={{
            transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
            transition: dragging ? "none" : "transform 0.2s ease",
          }}
        />

        {/* Loading caption */}
        {!imageLoaded && !imageError && (
          <div className="lb-loading-caption">
            <span className="lb-loading-dot" />
            Loading full resolution...
          </div>
        )}
        {imageError && <div className="lb-loading-caption" role="alert">
          Could not load this photo. <button onClick={() => { setImageError(false); setImageAttempt(n => n + 1); }}>Retry</button>
        </div>}

        {/* Zoom indicator */}
        {zoom > 1 && (
          <div className="lb-zoom-chip">
            {zoom.toFixed(1)}x &middot; click to reset
          </div>
        )}
      </div>

      {/* ── Side meta panel ─────────────────────────────────── */}
      {infoOpen && (
        <aside className="lb-info-panel">
          {/* People */}
          {peopleTags.length > 0 && (
            <section className="lb-info-section">
              <h4 className="lb-info-label">People</h4>
              <div className="lb-info-chips">
                {peopleTags.map((d) => (
                  <span key={d.id} className="lb-person-chip">
                    {d.chip && (
                      <img src={d.chip} alt="" className="lb-person-chip-img" />
                    )}
                    {d.cluster_label}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Other detections */}
          {Object.entries(groupedDetections)
            .filter(([cat]) => cat !== "people")
            .map(([cat, dets]) => (
              <section key={cat} className="lb-info-section">
                <h4 className="lb-info-label">{cat.charAt(0).toUpperCase() + cat.slice(1)}</h4>
                <div className="lb-info-chips">
                  {dets.map((d) => (
                    <span key={d.id} className="lb-tag-chip">
                      {d.cluster_label || d.subtype || cat}
                    </span>
                  ))}
                </div>
              </section>
            ))}

          {/* When */}
          {(metadata?.date_taken || currentPhoto?.date_taken) && (
            <section className="lb-info-section">
              <h4 className="lb-info-label">When</h4>
              <p className="lb-info-value">
                {new Date(metadata?.date_taken || currentPhoto?.date_taken || "").toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </section>
          )}

          {/* Where */}
          {metadata?.location_name && (
            <section className="lb-info-section">
              <h4 className="lb-info-label">Where</h4>
              <p className="lb-info-value">{metadata.location_name}</p>
              {metadata.latitude && metadata.longitude && (
                <p className="lb-info-coords">
                  {metadata.latitude.toFixed(4)}, {metadata.longitude.toFixed(4)}
                </p>
              )}
            </section>
          )}

          {/* Camera */}
          {(metadata?.camera_make || metadata?.camera_model) && (
            <section className="lb-info-section">
              <h4 className="lb-info-label">Camera</h4>
              <div className="lb-exif-grid">
                {metadata.camera_model && (
                  <div className="lb-exif-row">
                    <span>Model</span>
                    <span>{metadata.camera_model}</span>
                  </div>
                )}
                {metadata.lens && (
                  <div className="lb-exif-row">
                    <span>Lens</span>
                    <span>{metadata.lens}</span>
                  </div>
                )}
                {metadata.focal_length && (
                  <div className="lb-exif-row">
                    <span>Focal</span>
                    <span>{metadata.focal_length}</span>
                  </div>
                )}
                {metadata.aperture && (
                  <div className="lb-exif-row">
                    <span>Aperture</span>
                    <span>f/{metadata.aperture}</span>
                  </div>
                )}
                {metadata.shutter_speed && (
                  <div className="lb-exif-row">
                    <span>Shutter</span>
                    <span>{metadata.shutter_speed}</span>
                  </div>
                )}
                {metadata.iso && (
                  <div className="lb-exif-row">
                    <span>ISO</span>
                    <span>{metadata.iso}</span>
                  </div>
                )}
                {metadata.width && metadata.height && (
                  <div className="lb-exif-row">
                    <span>Size</span>
                    <span>{metadata.width} x {metadata.height}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Tags */}
          {metadata?.tags && (
            <section className="lb-info-section">
              <h4 className="lb-info-label">Tags</h4>
              <div className="lb-info-chips">
                {(Array.isArray(metadata.tags) ? metadata.tags : String(metadata.tags || "").split(","))
                  .map((t: string) => t.trim())
                  .filter(Boolean)
                  .map((tag) => (
                    <span key={tag} className="lb-tag-chip">
                      {tag}
                    </span>
                  ))}
              </div>
            </section>
          )}
        </aside>
      )}

      {/* ── Thumb strip ─────────────────────────────────────── */}
      {total > 1 && (
        <div className={`lb-thumb-strip ${infoOpen ? "lb-thumb-strip-with-info" : ""}`} ref={thumbStripRef}>
          {photos.map((p, i) => (
            <button
              key={p.photo_id}
              className={`lb-thumb ${i === index ? "is-active" : ""}`}
              onClick={() => onGoTo(i)}
              aria-label={`Photo ${i + 1}`}
            >
              <img src={p.thumb_url} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
