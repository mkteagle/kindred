"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Spinner } from "@/components/ui";
import { BACKEND, fmt } from "@/lib/constants";

/* ── Types ──────────────────────────────────────────────────────────── */

interface PhotoDetection {
  id: string;
  category: string;
  subtype: string;
  bbox: number[] | null; // [x1, y1, x2, y2] in original image pixels
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

interface NamedCluster {
  id: string;
  category: string;
  label: string;
  avatar: string | null;
}

interface TagPayload {
  bbox: number[];
  category: string;
  subtype: string;
  cluster_id?: string;
  new_label?: string;
}

interface TagResponse {
  detection_id: string;
  cluster_id: string;
  chip: string;
}

/* ── Color mapping ──────────────────────────────────────────────────── */

const CATEGORY_FILL: Record<string, string> = {
  people: "rgba(109, 60, 36, 0.18)",
  pets: "rgba(201, 85, 28, 0.18)",
  vehicles: "rgba(233, 184, 93, 0.18)",
};

const CATEGORY_BORDER: Record<string, string> = {
  people: "var(--pine)",
  pets: "var(--ember)",
  vehicles: "var(--gold)",
};

const CATEGORY_LABEL_BG: Record<string, string> = {
  people: "var(--pine)",
  pets: "var(--ember)",
  vehicles: "var(--gold)",
};

const CATEGORY_OPTIONS = [
  { value: "people", label: "People" },
  { value: "pets", label: "Animals" },
  { value: "vehicles", label: "Vehicles" },
];

/* ── Helpers ─────────────────────────────────────────────────────────── */

function bboxToPercent(
  bbox: number[],
  natW: number,
  natH: number
): { left: string; top: string; width: string; height: string } {
  const [x1, y1, x2, y2] = bbox;
  return {
    left: `${(x1 / natW) * 100}%`,
    top: `${(y1 / natH) * 100}%`,
    width: `${((x2 - x1) / natW) * 100}%`,
    height: `${((y2 - y1) / natH) * 100}%`,
  };
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

/* ── Main component ──────────────────────────────────────────────────── */

export default function PhotoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const photoId = params.photoId as string;

  // Image sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageError, setImageError] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  useEffect(() => { setImageError(false); setImageAttempt(0); }, [photoId]);
  const [natSize, setNatSize] = useState<{ w: number; h: number } | null>(null);

  // Selection
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Draw mode
  const [drawMode, setDrawMode] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  const [drawnBbox, setDrawnBbox] = useState<number[] | null>(null);

  // Tag form
  const [tagCategory, setTagCategory] = useState("people");
  const [tagSubtype, setTagSubtype] = useState("");
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [clusterSearch, setClusterSearch] = useState("");
  const [useNewLabel, setUseNewLabel] = useState(false);

  /* ── Queries ────────────────────────────────────────────────────── */

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery<PhotoDetectionsResponse>({
    queryKey: ["photo-detections", photoId],
    queryFn: () =>
      fetch(`${BACKEND}/photos/${photoId}/detections`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load photo (${r.status})`);
        return r.json();
      }),
    enabled: !!photoId,
  });

  const { data: namedClusters } = useQuery<{ clusters: NamedCluster[] }>({
    queryKey: ["named-clusters", tagCategory],
    queryFn: () =>
      fetch(`${BACKEND}/clusters/named?category=${tagCategory}`).then((r) =>
        r.json()
      ),
    enabled: drawMode || !!drawnBbox,
  });

  /* ── Tag mutation ───────────────────────────────────────────────── */

  const tagMutation = useMutation<TagResponse, Error, TagPayload>({
    mutationFn: (payload) =>
      fetch(`${BACKEND}/photos/${photoId}/tag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => {
        if (!r.ok) throw new Error(`Tag failed (${r.status})`);
        return r.json();
      }),
    onSuccess: (result, payload) => {
      // Optimistically add the new detection to local data
      qc.setQueryData<PhotoDetectionsResponse>(
        ["photo-detections", photoId],
        (old) => {
          if (!old) return old;
          const newDet: PhotoDetection = {
            id: result.detection_id,
            category: payload.category,
            subtype: payload.subtype || "",
            bbox: payload.bbox,
            det_score: 1.0,
            chip: result.chip,
            cluster_id: result.cluster_id,
            cluster_label:
              payload.new_label ||
              namedClusters?.clusters.find((c) => c.id === payload.cluster_id)
                ?.label ||
              null,
          };
          return { ...old, detections: [...old.detections, newDet] };
        }
      );
      resetDrawState();
    },
  });

  /* ── Image load & resize ────────────────────────────────────────── */

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (img) {
      setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    // If cached image already loaded
    if (img.complete && img.naturalWidth > 0) {
      setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, [data?.photo_url]);

  // ResizeObserver to recalculate on window resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      // Force a re-render by touching state; the percent-based positioning
      // handles scaling automatically, but we need children to re-render
      // if any px-based calculations exist
      const img = imgRef.current;
      if (img && img.naturalWidth > 0) {
        setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  /* ── Drawing handlers ───────────────────────────────────────────── */

  const getRelativeCoords = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const img = imgRef.current;
      if (!img || !natSize) return null;
      const rect = img.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const y = clamp(e.clientY - rect.top, 0, rect.height);
      // Convert to original-image pixel coords
      const scaleX = natSize.w / rect.width;
      const scaleY = natSize.h / rect.height;
      return { x: x * scaleX, y: y * scaleY, relX: x, relY: y };
    },
    [natSize]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!drawMode || !natSize) return;
      e.preventDefault();
      const coords = getRelativeCoords(e);
      if (!coords) return;
      setDrawing(true);
      setDrawStart({ x: coords.x, y: coords.y });
      setDrawEnd({ x: coords.x, y: coords.y });
      setDrawnBbox(null);
    },
    [drawMode, natSize, getRelativeCoords]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!drawing || !drawMode) return;
      e.preventDefault();
      const coords = getRelativeCoords(e);
      if (!coords) return;
      setDrawEnd({ x: coords.x, y: coords.y });
    },
    [drawing, drawMode, getRelativeCoords]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!drawing || !drawStart || !drawEnd) return;
      e.preventDefault();
      setDrawing(false);

      const coords = getRelativeCoords(e);
      if (!coords) return;

      const x1 = Math.min(drawStart.x, coords.x);
      const y1 = Math.min(drawStart.y, coords.y);
      const x2 = Math.max(drawStart.x, coords.x);
      const y2 = Math.max(drawStart.y, coords.y);

      // Minimum 10px box in original-image space
      if (x2 - x1 < 10 || y2 - y1 < 10) {
        setDrawStart(null);
        setDrawEnd(null);
        return;
      }

      setDrawnBbox([
        Math.round(x1),
        Math.round(y1),
        Math.round(x2),
        Math.round(y2),
      ]);
      setDrawStart(null);
      setDrawEnd(null);
    },
    [drawing, drawStart, drawEnd, getRelativeCoords]
  );

  // Touch support for mobile draw
  const getTouchCoords = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const img = imgRef.current;
      if (!img || !natSize) return null;
      const touch = e.touches[0] || e.changedTouches[0];
      const rect = img.getBoundingClientRect();
      const x = clamp(touch.clientX - rect.left, 0, rect.width);
      const y = clamp(touch.clientY - rect.top, 0, rect.height);
      const scaleX = natSize.w / rect.width;
      const scaleY = natSize.h / rect.height;
      return { x: x * scaleX, y: y * scaleY };
    },
    [natSize]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!drawMode || !natSize) return;
      e.preventDefault();
      const coords = getTouchCoords(e);
      if (!coords) return;
      setDrawing(true);
      setDrawStart({ x: coords.x, y: coords.y });
      setDrawEnd({ x: coords.x, y: coords.y });
      setDrawnBbox(null);
    },
    [drawMode, natSize, getTouchCoords]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!drawing || !drawMode) return;
      e.preventDefault();
      const coords = getTouchCoords(e);
      if (!coords) return;
      setDrawEnd({ x: coords.x, y: coords.y });
    },
    [drawing, drawMode, getTouchCoords]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!drawing || !drawStart || !drawEnd) return;
      e.preventDefault();
      setDrawing(false);

      const coords = getTouchCoords(e);
      const endCoords = coords || drawEnd;

      const x1 = Math.min(drawStart.x, endCoords.x);
      const y1 = Math.min(drawStart.y, endCoords.y);
      const x2 = Math.max(drawStart.x, endCoords.x);
      const y2 = Math.max(drawStart.y, endCoords.y);

      if (x2 - x1 < 10 || y2 - y1 < 10) {
        setDrawStart(null);
        setDrawEnd(null);
        return;
      }

      setDrawnBbox([
        Math.round(x1),
        Math.round(y1),
        Math.round(x2),
        Math.round(y2),
      ]);
      setDrawStart(null);
      setDrawEnd(null);
    },
    [drawing, drawStart, drawEnd, getTouchCoords]
  );

  /* ── Reset helpers ──────────────────────────────────────────────── */

  function resetDrawState() {
    setDrawMode(false);
    setDrawing(false);
    setDrawStart(null);
    setDrawEnd(null);
    setDrawnBbox(null);
    setTagCategory("people");
    setTagSubtype("");
    setSelectedClusterId(null);
    setNewLabel("");
    setClusterSearch("");
    setUseNewLabel(false);
  }

  /* ── Submit tag ─────────────────────────────────────────────────── */

  function handleSubmitTag() {
    if (!drawnBbox) return;
    const payload: TagPayload = {
      bbox: drawnBbox,
      category: tagCategory,
      subtype: tagSubtype,
    };
    if (useNewLabel && newLabel.trim()) {
      payload.new_label = newLabel.trim();
    } else if (selectedClusterId) {
      payload.cluster_id = selectedClusterId;
    }
    tagMutation.mutate(payload);
  }

  /* ── Compute rubber-band rect ───────────────────────────────────── */

  const rubberBand =
    drawing && drawStart && drawEnd && natSize
      ? bboxToPercent(
          [
            Math.min(drawStart.x, drawEnd.x),
            Math.min(drawStart.y, drawEnd.y),
            Math.max(drawStart.x, drawEnd.x),
            Math.max(drawStart.y, drawEnd.y),
          ],
          natSize.w,
          natSize.h
        )
      : null;

  /* ── Derived data ───────────────────────────────────────────────── */

  const detections = data?.detections ?? [];
  const selectedDet = detections.find((d) => d.id === selectedId) ?? null;

  const filteredClusters = (namedClusters?.clusters ?? []).filter(
    (c) =>
      c.category === tagCategory &&
      (!clusterSearch ||
        c.label.toLowerCase().includes(clusterSearch.toLowerCase()))
  );

  /* ── Render ─────────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="app-shell">
        <main className="page">
          <div className="empty-state">
            <Spinner />
          </div>
        </main>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="app-shell">
        <main className="page">
          <div className="empty-state">
            <div>
              <h2>Photo not found</h2>
              <p>{error instanceof Error ? error.message : "Failed to load photo details."}</p>
              <Button variant="ghost" onClick={() => router.back()}>
                Go back
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="page">
        {/* ── Header ────────────────────────────────────────────── */}
        <div className="full-view-header">
          <div>
            <button
              className="back-link"
              onClick={() => router.back()}
              style={{ background: "none", border: "none", padding: 0 }}
            >
              &larr; Back
            </button>
            <h2
              style={{
                fontFamily: "var(--display)",
                fontSize: "clamp(22px, 3vw, 36px)",
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              {data.photo_title || "Untitled photo"}
            </h2>
            {data.flickr_url && (
              <a
                href={data.flickr_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 6,
                  color: "var(--pine)",
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                View on Flickr
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M4.5 1.5H2a.5.5 0 00-.5.5v8a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V7.5M7 1.5h3.5V5M6 6l4.5-4.5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              variant={drawMode ? "primary" : "ghost"}
              small
              onClick={() => {
                if (drawMode) {
                  resetDrawState();
                } else {
                  setDrawMode(true);
                  setSelectedId(null);
                }
              }}
            >
              {drawMode ? "Cancel tagging" : "Tag face"}
            </Button>
          </div>
        </div>

        {drawMode && !drawnBbox && (
          <div
            style={{
              padding: "10px 16px",
              marginBottom: 16,
              borderRadius: 8,
              background: "rgba(233, 184, 93, 0.15)",
              border: "1px solid rgba(233, 184, 93, 0.3)",
              color: "var(--ash)",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Click and drag on the photo to draw a bounding box around the face
            you want to tag.
          </div>
        )}

        {/* ── Layout: photo + panel ─────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 320px",
            gap: 24,
            alignItems: "start",
          }}
          className="pd-layout"
        >
          {/* ── Photo canvas ──────────────────────────────────── */}
          <div
            ref={containerRef}
            style={{
              position: "relative",
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid var(--line)",
              background: "rgba(18, 18, 24, 0.03)",
              cursor: drawMode ? "crosshair" : "default",
              userSelect: "none",
              WebkitUserSelect: "none",
              touchAction: drawMode ? "none" : "auto",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={`${BACKEND}/photos/${photoId}/image?size=h&retry=${imageAttempt}`}
              alt={data.photo_title || ""}
              onLoad={handleImageLoad}
              onError={() => setImageError(true)}
              draggable={false}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
              }}
            />
            {imageError && <p role="alert">Could not load this photo. <button onClick={() => { setImageError(false); setImageAttempt(n => n + 1); }}>Retry</button></p>}

            {/* Detection overlays */}
            {natSize &&
              detections.map((det) => {
                if (!det.bbox || det.bbox.length < 4) return null;
                const pos = bboxToPercent(det.bbox, natSize.w, natSize.h);
                const cat = det.category || "people";
                const isSelected = selectedId === det.id;
                return (
                  <div
                    key={det.id}
                    onClick={(e) => {
                      if (drawMode) return;
                      e.stopPropagation();
                      setSelectedId(isSelected ? null : det.id);
                    }}
                    style={{
                      position: "absolute",
                      ...pos,
                      border: `2px solid ${CATEGORY_BORDER[cat] || "var(--mist)"}`,
                      background: isSelected
                        ? (CATEGORY_FILL[cat] || "rgba(125,85,63,0.18)").replace(
                            "0.18",
                            "0.32"
                          )
                        : CATEGORY_FILL[cat] || "rgba(125,85,63,0.18)",
                      borderRadius: 4,
                      cursor: drawMode ? "crosshair" : "pointer",
                      transition: "background 0.15s, box-shadow 0.15s",
                      boxShadow: isSelected
                        ? `0 0 0 2px ${CATEGORY_BORDER[cat] || "var(--mist)"}`
                        : "none",
                      pointerEvents: drawMode ? "none" : "auto",
                      zIndex: isSelected ? 10 : 5,
                    }}
                  >
                    {/* Label tag */}
                    <span
                      style={{
                        position: "absolute",
                        top: -1,
                        left: -1,
                        transform: "translateY(-100%)",
                        padding: "2px 7px",
                        borderRadius: "4px 4px 0 0",
                        background:
                          CATEGORY_LABEL_BG[cat] || "var(--mist)",
                        color: "#fff",
                        fontSize: 10,
                        fontFamily: "var(--mono)",
                        fontWeight: 600,
                        letterSpacing: ".03em",
                        whiteSpace: "nowrap",
                        lineHeight: "16px",
                        pointerEvents: "none",
                      }}
                    >
                      {det.cluster_label || det.category}
                    </span>
                  </div>
                );
              })}

            {/* Rubber-band rectangle while drawing */}
            {rubberBand && (
              <div
                style={{
                  position: "absolute",
                  ...rubberBand,
                  border: "2px dashed var(--ember)",
                  background: "rgba(201, 85, 28, 0.12)",
                  borderRadius: 3,
                  pointerEvents: "none",
                  zIndex: 20,
                }}
              />
            )}

            {/* Drawn bbox preview (before submit) */}
            {drawnBbox && natSize && (
              <div
                style={{
                  position: "absolute",
                  ...bboxToPercent(drawnBbox, natSize.w, natSize.h),
                  border: "2px solid var(--ember)",
                  background: "rgba(201, 85, 28, 0.15)",
                  borderRadius: 3,
                  pointerEvents: "none",
                  zIndex: 20,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: -1,
                    left: -1,
                    transform: "translateY(-100%)",
                    padding: "2px 7px",
                    borderRadius: "4px 4px 0 0",
                    background: "var(--ember)",
                    color: "#fff",
                    fontSize: 10,
                    fontFamily: "var(--mono)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    lineHeight: "16px",
                  }}
                >
                  New tag
                </span>
              </div>
            )}
          </div>

          {/* ── Side panel ────────────────────────────────────── */}
          <div className="pd-panel">
            {/* Tag form (when a bbox has been drawn) */}
            {drawnBbox && (
              <div
                style={{
                  padding: 18,
                  borderRadius: 12,
                  border: "1px solid rgba(201, 85, 28, 0.24)",
                  background: "rgba(255, 248, 238, 0.8)",
                  marginBottom: 16,
                  animation: "rise 0.2s ease",
                }}
              >
                <h3
                  style={{
                    margin: "0 0 14px",
                    fontFamily: "var(--display)",
                    fontSize: 18,
                    color: "var(--ash)",
                  }}
                >
                  Tag detection
                </h3>

                {/* Category */}
                <label
                  style={{
                    display: "block",
                    marginBottom: 4,
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--mist)",
                  }}
                >
                  Category
                </label>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    marginBottom: 14,
                  }}
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setTagCategory(opt.value);
                        setSelectedClusterId(null);
                        setClusterSearch("");
                      }}
                      style={{
                        flex: 1,
                        padding: "7px 0",
                        border:
                          tagCategory === opt.value
                            ? `2px solid ${CATEGORY_BORDER[opt.value]}`
                            : "1px solid var(--line)",
                        borderRadius: 6,
                        background:
                          tagCategory === opt.value
                            ? CATEGORY_FILL[opt.value]
                            : "transparent",
                        color:
                          tagCategory === opt.value
                            ? "var(--ash)"
                            : "var(--mist)",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        transition: "all 0.12s",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Assign to cluster (for people) */}
                {tagCategory === "people" && (
                  <>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginBottom: 10,
                      }}
                    >
                      <button
                        onClick={() => setUseNewLabel(false)}
                        style={{
                          flex: 1,
                          padding: "6px 0",
                          border: !useNewLabel
                            ? "2px solid var(--pine)"
                            : "1px solid var(--line)",
                          borderRadius: 6,
                          background: !useNewLabel
                            ? "rgba(109, 60, 36, 0.08)"
                            : "transparent",
                          fontSize: 11,
                          fontWeight: 600,
                          color: !useNewLabel ? "var(--pine)" : "var(--mist)",
                          cursor: "pointer",
                        }}
                      >
                        Existing person
                      </button>
                      <button
                        onClick={() => {
                          setUseNewLabel(true);
                          setSelectedClusterId(null);
                        }}
                        style={{
                          flex: 1,
                          padding: "6px 0",
                          border: useNewLabel
                            ? "2px solid var(--pine)"
                            : "1px solid var(--line)",
                          borderRadius: 6,
                          background: useNewLabel
                            ? "rgba(109, 60, 36, 0.08)"
                            : "transparent",
                          fontSize: 11,
                          fontWeight: 600,
                          color: useNewLabel ? "var(--pine)" : "var(--mist)",
                          cursor: "pointer",
                        }}
                      >
                        New person
                      </button>
                    </div>

                    {!useNewLabel ? (
                      <>
                        <input
                          type="text"
                          placeholder="Search people..."
                          value={clusterSearch}
                          onChange={(e) => setClusterSearch(e.target.value)}
                          className="merge-search"
                          style={{ marginBottom: 8 }}
                        />
                        <div
                          className="merge-list"
                          style={{ maxHeight: 200, marginBottom: 12 }}
                        >
                          {filteredClusters.length === 0 && (
                            <p
                              style={{
                                textAlign: "center",
                                color: "var(--mist)",
                                fontSize: 12,
                                padding: "12px 0",
                                margin: 0,
                              }}
                            >
                              {clusterSearch
                                ? "No matches"
                                : "No named people yet"}
                            </p>
                          )}
                          {filteredClusters.map((cluster) => (
                            <button
                              key={cluster.id}
                              className="merge-option"
                              onClick={() =>
                                setSelectedClusterId(
                                  selectedClusterId === cluster.id
                                    ? null
                                    : cluster.id
                                )
                              }
                              style={{
                                background:
                                  selectedClusterId === cluster.id
                                    ? "rgba(109, 60, 36, 0.1)"
                                    : undefined,
                                borderRadius: 6,
                              }}
                            >
                              {cluster.avatar ? (
                                <img
                                  src={cluster.avatar}
                                  alt=""
                                  className="merge-option-avatar"
                                />
                              ) : (
                                <span className="merge-option-avatar merge-option-fallback">
                                  ?
                                </span>
                              )}
                              <span className="merge-option-name">
                                {cluster.label}
                              </span>
                              {selectedClusterId === cluster.id && (
                                <span
                                  style={{
                                    color: "var(--pine)",
                                    fontWeight: 700,
                                    fontSize: 14,
                                  }}
                                >
                                  &#10003;
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <input
                        type="text"
                        placeholder="Enter a name..."
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        className="merge-search"
                        style={{ marginBottom: 12 }}
                        autoFocus
                      />
                    )}
                  </>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="ghost"
                    small
                    onClick={resetDrawState}
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    small
                    onClick={handleSubmitTag}
                    disabled={
                      tagMutation.isPending ||
                      (tagCategory === "people" &&
                        !useNewLabel &&
                        !selectedClusterId) ||
                      (tagCategory === "people" &&
                        useNewLabel &&
                        !newLabel.trim())
                    }
                    style={{ flex: 1 }}
                  >
                    {tagMutation.isPending ? (
                      <Spinner />
                    ) : (
                      "Save tag"
                    )}
                  </Button>
                </div>

                {tagMutation.isError && (
                  <p
                    style={{
                      marginTop: 8,
                      color: "#a4324c",
                      fontSize: 12,
                      textAlign: "center",
                    }}
                  >
                    {tagMutation.error?.message || "Failed to save tag."}
                  </p>
                )}
              </div>
            )}

            {/* Selected detection detail */}
            {selectedDet && !drawnBbox && (
              <div
                style={{
                  padding: 18,
                  borderRadius: 12,
                  border: `1px solid ${CATEGORY_BORDER[selectedDet.category] || "var(--line)"}`,
                  background: "rgba(255, 253, 248, 0.9)",
                  marginBottom: 16,
                  animation: "rise 0.2s ease",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  {selectedDet.chip && (
                    <img
                      src={selectedDet.chip}
                      alt=""
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 8,
                        objectFit: "cover",
                        border: "1px solid var(--line)",
                      }}
                    />
                  )}
                  <div>
                    <h4
                      style={{
                        margin: 0,
                        fontFamily: "var(--display)",
                        fontSize: 16,
                        color: "var(--ash)",
                      }}
                    >
                      {selectedDet.cluster_label || "Unnamed"}
                    </h4>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: "var(--mono)",
                        fontWeight: 600,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: CATEGORY_BORDER[selectedDet.category] || "var(--mist)",
                      }}
                    >
                      {selectedDet.category}
                      {selectedDet.subtype ? ` / ${selectedDet.subtype}` : ""}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 0",
                    borderTop: "1px solid var(--line)",
                    fontSize: 12,
                    color: "var(--mist)",
                  }}
                >
                  <span>Confidence</span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontWeight: 600,
                      color: "var(--ash)",
                    }}
                  >
                    {(selectedDet.det_score * 100).toFixed(1)}%
                  </span>
                </div>
                {selectedDet.cluster_id && (
                  <Link
                    href={`/${selectedDet.category}/${selectedDet.cluster_id}`}
                    style={{
                      display: "block",
                      marginTop: 8,
                      textAlign: "center",
                      padding: "7px 0",
                      borderRadius: 6,
                      border: "1px solid var(--line)",
                      background: "rgba(255, 253, 248, 0.6)",
                      color: "var(--pine)",
                      fontSize: 12,
                      fontWeight: 700,
                      textDecoration: "none",
                      transition: "background 0.12s",
                    }}
                  >
                    View cluster &rarr;
                  </Link>
                )}
              </div>
            )}

            {/* Detection list */}
            <div
              style={{
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "rgba(255, 253, 248, 0.85)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "14px 18px 10px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontFamily: "var(--mono)",
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--mist)",
                  }}
                >
                  Detections
                  <span
                    style={{
                      marginLeft: 8,
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--ember)",
                    }}
                  >
                    {detections.length}
                  </span>
                </h3>
              </div>

              {detections.length === 0 ? (
                <div
                  style={{
                    padding: "32px 18px",
                    textAlign: "center",
                    color: "var(--mist)",
                    fontSize: 13,
                  }}
                >
                  No detections found.
                  <br />
                  Use &ldquo;Tag face&rdquo; to add one manually.
                </div>
              ) : (
                <div
                  style={{
                    maxHeight: 480,
                    overflowY: "auto",
                  }}
                >
                  {detections.map((det) => {
                    const cat = det.category || "people";
                    const isActive = selectedId === det.id;
                    return (
                      <button
                        key={det.id}
                        onClick={() =>
                          setSelectedId(isActive ? null : det.id)
                        }
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          width: "100%",
                          padding: "10px 18px",
                          border: "none",
                          borderBottom: "1px solid var(--line)",
                          background: isActive
                            ? CATEGORY_FILL[cat] || "rgba(125,85,63,0.08)"
                            : "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "background 0.12s",
                        }}
                      >
                        {/* Chip thumbnail */}
                        {det.chip ? (
                          <img
                            src={det.chip}
                            alt=""
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 6,
                              objectFit: "cover",
                              border: `1px solid ${CATEGORY_BORDER[cat] || "var(--line)"}`,
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 6,
                              background: "rgba(18, 18, 24, 0.04)",
                              display: "grid",
                              placeItems: "center",
                              color: "var(--mist)",
                              fontSize: 14,
                              flexShrink: 0,
                              border: "1px solid var(--line)",
                            }}
                          >
                            ?
                          </span>
                        )}

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--ash)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {det.cluster_label || "Unnamed"}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              fontFamily: "var(--mono)",
                              fontWeight: 600,
                              letterSpacing: ".05em",
                              textTransform: "uppercase",
                              color:
                                CATEGORY_BORDER[cat] || "var(--mist)",
                              marginTop: 2,
                            }}
                          >
                            {det.category}
                            {det.subtype ? ` / ${det.subtype}` : ""}
                          </div>
                        </div>

                        {/* Confidence score */}
                        <span
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 11,
                            fontWeight: 500,
                            color: "var(--muted)",
                            flexShrink: 0,
                          }}
                        >
                          {(det.det_score * 100).toFixed(0)}%
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ── Responsive styles ───────────────────────────────────── */}
      <style>{`
        .pd-layout {
          grid-template-columns: minmax(0, 1fr) 320px;
        }
        @media (max-width: 840px) {
          .pd-layout {
            grid-template-columns: 1fr !important;
          }
          .pd-panel {
            order: 2;
          }
        }
      `}</style>
    </div>
  );
}
