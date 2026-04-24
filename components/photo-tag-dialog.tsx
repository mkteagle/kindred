"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "./ui";
import { BACKEND } from "@/lib/constants";

/* ── Types ──────────────────────────────────────────────────────────── */

interface PhotoDetection {
  id: string;
  category: string;
  subtype: string;
  bbox: number[] | null;
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

/* ── Props ───────────────────────────────────────────────────────────── */

interface PhotoTagDialogProps {
  photoId: string;
  onClose: () => void;
  /** Pre-select a cluster to assign to (e.g. when opened from a cluster detail page) */
  preselectedClusterId?: string;
  preselectedCategory?: string;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function PhotoTagDialog({
  photoId,
  onClose,
  preselectedClusterId,
  preselectedCategory,
}: PhotoTagDialogProps) {
  const qc = useQueryClient();

  // Image sizing
  const imgRef = useRef<HTMLImageElement>(null);
  const [natSize, setNatSize] = useState<{ w: number; h: number } | null>(null);

  // Draw state — start in draw mode immediately
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  const [drawnBbox, setDrawnBbox] = useState<number[] | null>(null);

  // Tag form
  const [tagCategory, setTagCategory] = useState(preselectedCategory || "people");
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    preselectedClusterId || null
  );
  const [newLabel, setNewLabel] = useState("");
  const [clusterSearch, setClusterSearch] = useState("");
  const [useNewLabel, setUseNewLabel] = useState(false);

  // Success feedback
  const [justTagged, setJustTagged] = useState(false);

  /* ── Queries ────────────────────────────────────────────────────── */

  const { data, isLoading } = useQuery<PhotoDetectionsResponse>({
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
      // Invalidate cluster queries so counts update
      qc.invalidateQueries({ queryKey: ["clusters-summary"] });
      qc.invalidateQueries({ queryKey: ["cluster-detail"] });
      resetDraw();
      setJustTagged(true);
      setTimeout(() => setJustTagged(false), 2000);
    },
  });

  /* ── Image load ─────────────────────────────────────────────────── */

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (img) setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, [data?.photo_url]);

  /* ── Drawing handlers ───────────────────────────────────────────── */

  const getRelativeCoords = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const img = imgRef.current;
      if (!img || !natSize) return null;
      const rect = img.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const y = clamp(e.clientY - rect.top, 0, rect.height);
      const scaleX = natSize.w / rect.width;
      const scaleY = natSize.h / rect.height;
      return { x: x * scaleX, y: y * scaleY };
    },
    [natSize]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!natSize || drawnBbox) return;
      e.preventDefault();
      const coords = getRelativeCoords(e);
      if (!coords) return;
      setDrawing(true);
      setDrawStart(coords);
      setDrawEnd(coords);
    },
    [natSize, drawnBbox, getRelativeCoords]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!drawing) return;
      e.preventDefault();
      const coords = getRelativeCoords(e);
      if (coords) setDrawEnd(coords);
    },
    [drawing, getRelativeCoords]
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

      if (x2 - x1 < 10 || y2 - y1 < 10) {
        setDrawStart(null);
        setDrawEnd(null);
        return;
      }

      setDrawnBbox([Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]);
      setDrawStart(null);
      setDrawEnd(null);
    },
    [drawing, drawStart, drawEnd, getRelativeCoords]
  );

  /* ── Escape key ─────────────────────────────────────────────────── */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drawnBbox) resetDraw();
        else onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [drawnBbox, onClose]);

  /* ── Reset ──────────────────────────────────────────────────────── */

  function resetDraw() {
    setDrawing(false);
    setDrawStart(null);
    setDrawEnd(null);
    setDrawnBbox(null);
    if (!preselectedClusterId) {
      setSelectedClusterId(null);
    }
    setNewLabel("");
    setClusterSearch("");
    setUseNewLabel(false);
  }

  /* ── Submit ─────────────────────────────────────────────────────── */

  function handleSubmitTag() {
    if (!drawnBbox) return;
    const payload: TagPayload = {
      bbox: drawnBbox,
      category: tagCategory,
      subtype: "face",
    };
    if (useNewLabel && newLabel.trim()) {
      payload.new_label = newLabel.trim();
    } else if (selectedClusterId) {
      payload.cluster_id = selectedClusterId;
    }
    tagMutation.mutate(payload);
  }

  /* ── Rubber-band ────────────────────────────────────────────────── */

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

  const detections = data?.detections ?? [];
  const filteredClusters = (namedClusters?.clusters ?? []).filter(
    (c) =>
      c.category === tagCategory &&
      (!clusterSearch || c.label.toLowerCase().includes(clusterSearch.toLowerCase()))
  );

  /* ── Render ─────────────────────────────────────────────────────── */

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(18, 18, 24, .65)",
        backdropFilter: "blur(6px)",
        animation: "rise .2s ease",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(95vw, 1100px)",
          maxHeight: "92vh",
          background: "var(--paper, #fffdf8)",
          borderRadius: 14,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,.25), 0 4px 16px rgba(0,0,0,.1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--display)",
                fontSize: 18,
                color: "var(--ash)",
              }}
            >
              Tag faces
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--mist)" }}>
              {data?.photo_title || "Loading..."}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {justTagged && (
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--pine)",
                animation: "rise .2s ease",
              }}>
                Tagged!
              </span>
            )}
            <button
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "transparent",
                fontSize: 18,
                color: "var(--mist)",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: drawnBbox ? "1fr 280px" : "1fr",
            flex: 1,
            overflow: "hidden",
          }}
        >
          {/* Photo canvas */}
          <div
            style={{
              position: "relative",
              overflow: "auto",
              cursor: drawnBbox ? "default" : "crosshair",
              userSelect: "none",
              background: "rgba(18, 18, 24, .03)",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            {isLoading ? (
              <div style={{ display: "grid", placeItems: "center", minHeight: 300 }}>
                <Spinner />
              </div>
            ) : (
              <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={data?.photo_url || ""}
                  alt=""
                  onLoad={handleImageLoad}
                  draggable={false}
                  style={{ display: "block", width: "100%", height: "auto" }}
                />

                {/* Existing detections */}
                {natSize &&
                  detections.map((det) => {
                    if (!det.bbox || det.bbox.length < 4) return null;
                    const pos = bboxToPercent(det.bbox, natSize.w, natSize.h);
                    const cat = det.category || "people";
                    return (
                      <div
                        key={det.id}
                        style={{
                          position: "absolute",
                          ...pos,
                          border: `2px solid ${CATEGORY_BORDER[cat] || "var(--mist)"}`,
                          background: CATEGORY_FILL[cat] || "rgba(125,85,63,0.18)",
                          borderRadius: 4,
                          pointerEvents: "none",
                          zIndex: 5,
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
                            background: CATEGORY_LABEL_BG[cat] || "var(--mist)",
                            color: "#fff",
                            fontSize: 10,
                            fontFamily: "var(--mono)",
                            fontWeight: 600,
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

                {/* Rubber-band */}
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

                {/* Drawn bbox */}
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

                {/* Instruction overlay when no bbox drawn */}
                {!drawnBbox && !drawing && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 16,
                      left: "50%",
                      transform: "translateX(-50%)",
                      padding: "6px 16px",
                      borderRadius: 8,
                      background: "rgba(18, 18, 24, .7)",
                      backdropFilter: "blur(4px)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      pointerEvents: "none",
                      zIndex: 30,
                    }}
                  >
                    Draw a box around a face to tag it
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Side panel — only when bbox is drawn */}
          {drawnBbox && (
            <div
              style={{
                padding: 18,
                borderLeft: "1px solid var(--line)",
                overflowY: "auto",
                animation: "rise .15s ease",
              }}
            >
              <h4
                style={{
                  margin: "0 0 14px",
                  fontFamily: "var(--display)",
                  fontSize: 16,
                  color: "var(--ash)",
                }}
              >
                Assign tag
              </h4>

              {/* Category */}
              <label
                style={{
                  display: "block",
                  marginBottom: 4,
                  fontSize: 10,
                  fontFamily: "var(--mono)",
                  fontWeight: 600,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--mist)",
                }}
              >
                Category
              </label>
              <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                {CATEGORY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setTagCategory(opt.value);
                      if (!preselectedClusterId) setSelectedClusterId(null);
                      setClusterSearch("");
                    }}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      border:
                        tagCategory === opt.value
                          ? `2px solid ${CATEGORY_BORDER[opt.value]}`
                          : "1px solid var(--line)",
                      borderRadius: 5,
                      background:
                        tagCategory === opt.value
                          ? CATEGORY_FILL[opt.value]
                          : "transparent",
                      color:
                        tagCategory === opt.value ? "var(--ash)" : "var(--mist)",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Assign mode toggle */}
              {tagCategory === "people" && (
                <>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    <button
                      onClick={() => setUseNewLabel(false)}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        border: !useNewLabel
                          ? "2px solid var(--pine)"
                          : "1px solid var(--line)",
                        borderRadius: 5,
                        background: !useNewLabel
                          ? "rgba(109, 60, 36, 0.08)"
                          : "transparent",
                        fontSize: 11,
                        fontWeight: 600,
                        color: !useNewLabel ? "var(--pine)" : "var(--mist)",
                        cursor: "pointer",
                      }}
                    >
                      Existing
                    </button>
                    <button
                      onClick={() => {
                        setUseNewLabel(true);
                        setSelectedClusterId(null);
                      }}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        border: useNewLabel
                          ? "2px solid var(--pine)"
                          : "1px solid var(--line)",
                        borderRadius: 5,
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
                        style={{ marginBottom: 6, fontSize: 12 }}
                      />
                      <div
                        className="merge-list"
                        style={{ maxHeight: 180, marginBottom: 12 }}
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
                            {clusterSearch ? "No matches" : "No named people yet"}
                          </p>
                        )}
                        {filteredClusters.map((cluster) => (
                          <button
                            key={cluster.id}
                            className="merge-option"
                            onClick={() =>
                              setSelectedClusterId(
                                selectedClusterId === cluster.id ? null : cluster.id
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
                            <span className="merge-option-name">{cluster.label}</span>
                            {selectedClusterId === cluster.id && (
                              <span style={{ color: "var(--pine)", fontWeight: 700, fontSize: 14 }}>
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
                      style={{ marginBottom: 12, fontSize: 12 }}
                      autoFocus
                    />
                  )}
                </>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  variant="ghost"
                  small
                  onClick={resetDraw}
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
                    (tagCategory === "people" && !useNewLabel && !selectedClusterId) ||
                    (tagCategory === "people" && useNewLabel && !newLabel.trim())
                  }
                  style={{ flex: 1 }}
                >
                  {tagMutation.isPending ? <Spinner /> : "Save tag"}
                </Button>
              </div>

              {tagMutation.isError && (
                <p style={{ marginTop: 8, color: "#a4324c", fontSize: 12, textAlign: "center" }}>
                  {tagMutation.error?.message || "Failed to save tag."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
