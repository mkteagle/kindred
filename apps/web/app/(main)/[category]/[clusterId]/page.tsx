"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Spinner } from "@/components/ui";
import { PhotoTagDialog } from "@/components/photo-tag-dialog";
import { FocalPointDialog } from "@/components/focal-point-dialog";
import type { ClustersSummaryResponse, ClusterDetail, Detection } from "@/types";
import { BACKEND, fmt, toBackendCategory } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

const getUniquePhotos = (items: Detection[]): Detection[] => {
  const photoMap = new Map<string, Detection>();
  items.forEach((item) => {
    if (!photoMap.has(item.photo_id)) photoMap.set(item.photo_id, item);
  });
  return Array.from(photoMap.values());
};

export default function ClusterDetailPage() {
  const params = useParams();
  const category = (params.category as string) || "people";
  const backendCat = toBackendCategory(category);
  const clusterId = (params.clusterId as string) || "";
  const qc = useQueryClient();
  const { openLightbox } = useLightbox();

  const [coverPickMode, setCoverPickMode] = useState(false);
  const [focalPickPhoto, setFocalPickPhoto] = useState<string | null>(null);
  const [tagPhotoId, setTagPhotoId] = useState<string | null>(null);

  const { data: summary } = useQuery<ClustersSummaryResponse>({
    queryKey: ["clusters-summary", category],
    queryFn: () =>
      fetch(`${BACKEND}/clusters/${backendCat}/summary`).then((r) => r.json()),
  });

  const cluster = summary?.clusters?.find((c) => c.id === clusterId);

  const { data: detail, isLoading } = useQuery<ClusterDetail>({
    queryKey: ["cluster-detail", category, clusterId],
    queryFn: () =>
      fetch(`${BACKEND}/clusters/${backendCat}/${clusterId}`).then((r) =>
        r.json()
      ),
  });

  const setAvatarMutation = useMutation({
    mutationFn: (payload: {
      avatar_detection_id?: string | null;
      cover_photo_id?: string | null;
      cover_crop?: { x: number; y: number } | null;
    }) =>
      fetch(`${BACKEND}/clusters/set-avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: backendCat,
          cluster_id: clusterId,
          ...payload,
        }),
      }).then((r) => {
        if (!r.ok) throw new Error(`set-avatar failed: ${r.status}`);
        return r.json();
      }),
    onSuccess: (_result, payload) => {
      // Optimistically update cluster detail
      qc.setQueryData<ClusterDetail>(
        ["cluster-detail", category, clusterId],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            avatar_detection_id:
              payload.avatar_detection_id !== undefined
                ? payload.avatar_detection_id
                : old.avatar_detection_id,
            cover_photo_id:
              payload.cover_photo_id !== undefined
                ? payload.cover_photo_id
                : old.cover_photo_id,
            cover_crop:
              payload.cover_crop !== undefined
                ? payload.cover_crop
                : old.cover_crop,
          };
        }
      );
      // Optimistically update the summary cache so the card on the grid page reflects changes immediately
      qc.setQueryData<ClustersSummaryResponse>(
        ["clusters-summary", category],
        (old) => {
          if (!old?.clusters) return old;
          const detail = qc.getQueryData<ClusterDetail>(["cluster-detail", category, clusterId]);
          return {
            ...old,
            clusters: old.clusters.map((c) => {
              if (c.id !== clusterId) return c;
              const updated = { ...c };
              if (payload.cover_photo_id !== undefined && detail) {
                const photo = detail.items.find((i) => i.photo_id === payload.cover_photo_id);
                if (photo) {
                  updated.thumb_url = photo.thumb_url;
                  updated.photo_url = photo.photo_url;
                }
              }
              if (payload.cover_crop !== undefined) {
                updated.cover_crop = payload.cover_crop;
              }
              if (payload.avatar_detection_id !== undefined && detail) {
                const det = detail.items.find((i) => i.id === payload.avatar_detection_id);
                if (det) {
                  updated.avatar = det.chip || det.thumb_url || det.photo_url;
                }
              }
              return updated;
            }),
          };
        }
      );
    },
  });

  const handleRemoveDetections = async (detectionIds: string[]) => {
    const idSet = new Set(detectionIds);
    qc.setQueryData<ClusterDetail>(
      ["cluster-detail", category, clusterId],
      (old) => {
        if (!old) return old;
        return { ...old, items: old.items.filter((i) => !idSet.has(i.id)) };
      }
    );
    fetch(`${BACKEND}/clusters/remove-detections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: backendCat,
        cluster_id: clusterId,
        detection_ids: detectionIds,
      }),
    }).then(() => {
      qc.invalidateQueries({ queryKey: ["clusters-summary"] });
    });
  };

  const handleSetAvatar = (detectionId: string) => {
    setAvatarMutation.mutate({ avatar_detection_id: detectionId });
  };

  const handleClearAvatar = () => {
    setAvatarMutation.mutate({ avatar_detection_id: null });
  };

  const handleSetCover = (photoId: string) => {
    // Find the best detection from this photo to use as the avatar
    const bestDet = items
      .filter((i) => i.photo_id === photoId)
      .sort((a, b) => b.det_score - a.det_score)[0];
    setAvatarMutation.mutate({
      cover_photo_id: photoId,
      avatar_detection_id: bestDet?.id || undefined,
    });
    setCoverPickMode(false);
    setFocalPickPhoto(photoId);
  };

  const handleClearCover = () => {
    setAvatarMutation.mutate({ cover_photo_id: null, cover_crop: null });
    setFocalPickPhoto(null);
  };

  const items = detail?.items || [];
  const uniquePhotos = getUniquePhotos(items);
  const name = detail?.label || cluster?.label || "Unnamed";

  // Determine current avatar detection — custom or highest det_score
  const avatarDetectionId = detail?.avatar_detection_id || null;
  const coverPhotoId = detail?.cover_photo_id || null;
  const coverCrop = detail?.cover_crop || null;

  // Resolve cover photo URL from items
  const coverPhoto = coverPhotoId
    ? items.find((i) => i.photo_id === coverPhotoId)
    : null;
  const coverUrl = coverPhoto?.photo_url || coverPhoto?.thumb_url || null;

  // Resolve avatar chip
  const avatarDet = avatarDetectionId
    ? items.find((i) => i.id === avatarDetectionId)
    : items.length > 0
    ? [...items].sort((a, b) => b.det_score - a.det_score)[0]
    : null;

  return (
    <div className="app-shell">
      <main className="page">
        {/* Cover photo hero */}
        {coverUrl && (
          <div
            onClick={() => {
              const el = document.querySelector(`[data-photo-id="${coverPhotoId}"]`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            style={{
              position: "relative",
              width: "100%",
              height: 220,
              borderRadius: 12,
              overflow: "hidden",
              marginBottom: -32,
              cursor: "pointer",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverUrl}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: coverCrop
                  ? `${coverCrop.x}% ${coverCrop.y}%`
                  : "center",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(transparent 40%, rgba(18,18,24,.5))",
              }}
            />
          </div>
        )}

        <div className="full-view-header">
          <div>
            <Link href={`/${category}`} className="back-link">
              &larr; Back
            </Link>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
              {avatarDet && (
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "2px solid var(--line)",
                  flexShrink: 0,
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarDet.chip || avatarDet.thumb_url || avatarDet.photo_url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
              )}
              <div>
                <h2 style={{ margin: 0 }}>{name}</h2>
                <p style={{ margin: "2px 0 0" }}>
                  {fmt.format(items.length)} detections across{" "}
                  {fmt.format(uniquePhotos.length)} photos
                </p>
              </div>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="empty-state">
            <Spinner />
          </div>
        ) : (
          <>
            {/* Face detection chips */}
            <details className="full-view-chips">
              <summary>
                <h3 style={{ display: "inline" }}>
                  Face detections ({items.length})
                </h3>
              </summary>
              <div
                className="chip-row"
                style={{ flexWrap: "wrap", marginTop: 12 }}
              >
                {items.map((item) => {
                  const isAvatar = avatarDetectionId === item.id;
                  return (
                    <ChipWithMenu
                      key={item.id}
                      item={item}
                      isAvatar={isAvatar}
                      onSetAvatar={() => handleSetAvatar(item.id)}
                      onClearAvatar={handleClearAvatar}
                      onRemove={() => handleRemoveDetections([item.id])}
                    />
                  );
                })}
              </div>
            </details>

            {/* Photos section */}
            <div className="full-view-photos">
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Photos</h3>
                <button
                  onClick={() => {
                    setCoverPickMode(!coverPickMode);
                    if (coverPickMode) setFocalPickPhoto(null);
                  }}
                  style={{
                    padding: "3px 10px",
                    border: coverPickMode
                      ? "1.5px solid var(--gold)"
                      : "1px solid var(--line)",
                    borderRadius: 5,
                    background: coverPickMode
                      ? "rgba(233, 184, 93, 0.12)"
                      : "transparent",
                    color: coverPickMode ? "var(--gold)" : "var(--mist)",
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    fontWeight: 600,
                    letterSpacing: ".04em",
                    cursor: "pointer",
                    transition: "all .15s",
                  }}
                >
                  {coverPickMode ? "Done" : "Set cover"}
                </button>
                {coverPhotoId && (
                  <button
                    onClick={handleClearCover}
                    style={{
                      padding: "3px 8px",
                      border: "1px solid var(--line)",
                      borderRadius: 5,
                      background: "transparent",
                      color: "var(--mist)",
                      fontSize: 11,
                      fontFamily: "var(--mono)",
                      cursor: "pointer",
                    }}
                  >
                    Reset cover
                  </button>
                )}
              </div>

              {coverPickMode && (
                <div
                  style={{
                    padding: "8px 14px",
                    marginBottom: 12,
                    borderRadius: 6,
                    background: "rgba(233, 184, 93, 0.08)",
                    border: "1px solid rgba(233, 184, 93, 0.2)",
                    color: "var(--mist)",
                    fontSize: 12,
                  }}
                >
                  Click a photo to set it as the cover image for this person&apos;s card.
                </div>
              )}

              <div className="full-thumb-grid">
                {uniquePhotos.map((item) => {
                  const isCover = coverPhotoId === item.photo_id;

                  return (
                    <PhotoThumb
                      key={item.photo_id}
                      item={item}
                      isCover={isCover}
                      coverPickMode={coverPickMode}
                      onSetCover={() => handleSetCover(item.photo_id)}
                      onToggleFocalPick={() =>
                        setFocalPickPhoto(item.photo_id)
                      }
                      onTagPhoto={() => setTagPhotoId(item.photo_id)}
                      onOpenLightbox={() => {
                        const lbPhotos: LightboxPhoto[] = uniquePhotos.map((p) => ({
                          photo_id: p.photo_id,
                          thumb_url: p.thumb_url || p.photo_url,
                          flickr_url: p.flickr_url,
                          photo_url: p.photo_url,
                          photo_title: p.photo_title,
                        }));
                        openLightbox(item.photo_id, lbPhotos);
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {category === "people" && clusterId && (
              <AppearsWithSection clusterId={clusterId} />
            )}
          </>
        )}

        {/* Photo tag dialog */}
        {tagPhotoId && (
          <PhotoTagDialog
            photoId={tagPhotoId}
            onClose={() => setTagPhotoId(null)}
            preselectedClusterId={clusterId}
            preselectedCategory={backendCat}
          />
        )}

        {/* Focal point dialog */}
        {focalPickPhoto && (() => {
          const photo = uniquePhotos.find((p) => p.photo_id === focalPickPhoto);
          if (!photo) return null;
          return (
            <FocalPointDialog
              photoUrl={photo.photo_url || photo.thumb_url}
              photoTitle={photo.photo_title || ""}
              initialCrop={coverCrop}
              onSetFocalPoint={(crop) =>
                setAvatarMutation.mutate({ cover_crop: crop })
              }
              onClose={() => setFocalPickPhoto(null)}
            />
          );
        })()}
      </main>
    </div>
  );
}

/* ── Chip with hover menu ──────────────────────────────────────────── */

function ChipWithMenu({
  item,
  isAvatar,
  onSetAvatar,
  onClearAvatar,
  onRemove,
}: {
  item: Detection;
  isAvatar: boolean;
  onSetAvatar: () => void;
  onClearAvatar: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  return (
    <div
      ref={wrapRef}
      className="chip-wrap"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      style={{ position: "relative" }}
    >
      <img
        src={item.chip || item.thumb_url || item.photo_url}
        alt=""
        onClick={() =>
          window.open(item.flickr_url || item.photo_url, "_blank")
        }
        style={isAvatar ? {
          boxShadow: "0 0 0 2px var(--gold)",
          borderColor: "var(--gold)",
        } : undefined}
      />

      {/* Avatar star badge */}
      {isAvatar && (
        <span
          style={{
            position: "absolute",
            bottom: -3,
            left: -3,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "var(--gold)",
            display: "grid",
            placeItems: "center",
            fontSize: 10,
            lineHeight: 1,
            color: "#fff",
            boxShadow: "0 1px 4px rgba(0,0,0,.2)",
            zIndex: 3,
          }}
          title="Current avatar"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </span>
      )}

      {/* Remove button (shows on hover) */}
      <button
        className="chip-remove"
        title="Remove from this group"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        &times;
      </button>

      {/* Context menu */}
      {menuOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            zIndex: 50,
            minWidth: 150,
            background: "#fff",
            border: "1px solid var(--line)",
            borderRadius: 8,
            boxShadow: "0 4px 20px rgba(42, 32, 27, .12), 0 1px 4px rgba(42, 32, 27, .08)",
            overflow: "hidden",
            animation: "rise .15s ease",
          }}
        >
          {isAvatar ? (
            <button
              onClick={() => { onClearAvatar(); setMenuOpen(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "9px 14px",
                border: "none",
                background: "transparent",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--mist)",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(42, 32, 27, .04)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              Remove as avatar
            </button>
          ) : (
            <button
              onClick={() => { onSetAvatar(); setMenuOpen(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "9px 14px",
                border: "none",
                background: "transparent",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--gold)",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(233, 184, 93, .06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              Set as avatar
            </button>
          )}
          <button
            onClick={() => { onRemove(); setMenuOpen(false); }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "9px 14px",
              border: "none",
              borderTop: "1px solid var(--line)",
              background: "transparent",
              fontSize: 12,
              fontWeight: 600,
              color: "#b73e57",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(183, 62, 87, .04)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Remove detection
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Photo thumbnail with cover selection + focal point ─────────── */

function PhotoThumb({
  item,
  isCover,
  coverPickMode,
  onSetCover,
  onToggleFocalPick,
  onTagPhoto,
  onOpenLightbox,
}: {
  item: Detection;
  isCover: boolean;
  coverPickMode: boolean;
  onSetCover: () => void;
  onToggleFocalPick: () => void;
  onTagPhoto: () => void;
  onOpenLightbox: () => void;
}) {
  return (
    <div
      className="thumb"
      data-photo-id={item.photo_id}
      onClick={() => {
        if (coverPickMode) {
          onSetCover();
        } else {
          onOpenLightbox();
        }
      }}
      title={
        coverPickMode
          ? "Set as cover photo"
          : item.photo_title || "Open photo"
      }
      style={{
        position: "relative",
        border: isCover ? "2px solid var(--gold)" : undefined,
        cursor: coverPickMode ? "pointer" : "pointer",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.thumb_url || item.photo_url}
        alt={item.photo_title || ""}
      />

      {/* Cover badge */}
      {isCover && (
        <span
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            padding: "2px 7px",
            borderRadius: 4,
            background: "var(--gold)",
            color: "#fff",
            fontSize: 9,
            fontFamily: "var(--mono)",
            fontWeight: 700,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            zIndex: 3,
            boxShadow: "0 1px 4px rgba(0,0,0,.15)",
          }}
        >
          Cover
        </span>
      )}

      {/* Tag button (shows on hover) */}
      {!coverPickMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTagPhoto();
          }}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            padding: "3px 8px",
            borderRadius: 4,
            border: "none",
            background: "rgba(0, 0, 0, .55)",
            color: "#fff",
            fontSize: 10,
            fontFamily: "var(--mono)",
            fontWeight: 600,
            cursor: "pointer",
            opacity: 0,
            transition: "opacity .15s",
            zIndex: 3,
          }}
          className="focal-btn"
          title="Tag faces in this photo"
        >
          Tag
        </button>
      )}

      {/* Focal point adjust button (for current cover) */}
      {isCover && !coverPickMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFocalPick();
          }}
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            padding: "3px 8px",
            borderRadius: 4,
            border: "none",
            background: "rgba(0, 0, 0, .55)",
            color: "#fff",
            fontSize: 10,
            fontFamily: "var(--mono)",
            fontWeight: 600,
            cursor: "pointer",
            opacity: 0,
            transition: "opacity .15s",
            zIndex: 3,
          }}
          className="focal-btn"
        >
          Adjust crop
        </button>
      )}

      {/* Hover overlay in cover pick mode */}
      {coverPickMode && !isCover && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(233, 184, 93, .08)",
            borderRadius: "inherit",
            display: "grid",
            placeItems: "center",
            opacity: 0,
            transition: "opacity .15s",
            pointerEvents: "none",
          }}
          className="cover-pick-overlay"
        />
      )}
    </div>
  );
}

/* ── Appears-with section ──────────────────────────────────────────── */

interface AppearsWithPerson {
  cluster_id: string;
  category?: string;
  label: string | null;
  shared_photos: number;
  avatar: string | null;
}

interface TogetherPhoto {
  photo_id: string;
  photo_url: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
}

function SharedPhotos({ clusterId, otherClusterId }: { clusterId: string; otherClusterId: string }) {
  const { openLightbox } = useLightbox();
  const { data, isLoading } = useQuery<{ photos: TogetherPhoto[] }>({
    queryKey: ["together", clusterId, otherClusterId],
    queryFn: () => fetch(`${BACKEND}/photos/together?people=${clusterId},${otherClusterId}&limit=30`).then((r) => r.json()),
  });

  if (isLoading) return <div style={{ padding: 12 }}><Spinner /></div>;

  const photos = data?.photos || [];
  if (photos.length === 0) return <p style={{ color: "var(--mist)", fontSize: 12, padding: "8px 0" }}>No shared photos found.</p>;

  const lbPhotos: LightboxPhoto[] = photos.map((p) => ({
    photo_id: p.photo_id,
    thumb_url: p.thumb_url || p.photo_url,
    flickr_url: p.flickr_url,
    photo_url: p.photo_url,
    photo_title: p.photo_title,
  }));

  return (
    <div className="clip-results-grid" style={{ marginTop: 8, marginBottom: 12 }}>
      {photos.map((photo) => (
        <button key={photo.photo_id} className="clip-result-card" onClick={() => openLightbox(photo.photo_id, lbPhotos)} style={{ border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
          <img src={photo.thumb_url || photo.photo_url} alt={photo.photo_title || ""} />
        </button>
      ))}
    </div>
  );
}

function AppearsWithSection({ clusterId }: { clusterId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ appears_with: AppearsWithPerson[] }>({
    queryKey: ["appears-with", clusterId],
    queryFn: () => fetch(`${BACKEND}/photos/appears-with?cluster_id=${clusterId}`).then((r) => r.json()),
  });

  const people = (data?.appears_with || []).filter((p) => p.label || p.category === "pets" || p.category === "animals");

  if (isLoading || people.length === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 13, color: "var(--mist)", textTransform: "uppercase", letterSpacing: ".08em", margin: "0 0 12px" }}>
        Often appears with
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {people.map((person) => (
          <div key={person.cluster_id}>
            <button
              className="appears-with-card"
              onClick={() => setExpanded(expanded === person.cluster_id ? null : person.cluster_id)}
              style={{ width: "100%", border: "none", cursor: "pointer", textAlign: "left" }}
            >
              {person.avatar ? (
                <img src={person.avatar} alt="" className="appears-with-avatar" />
              ) : (
                <span className="appears-with-avatar appears-with-fallback">?</span>
              )}
              <span className="appears-with-name">
                {person.label || (person.category === "pets" ? "Animal" : "Unknown")}
                {person.category === "pets" && (
                  <span style={{ fontSize: 9, color: "var(--mist)", marginLeft: 4, textTransform: "uppercase", letterSpacing: ".05em" }}>animal</span>
                )}
              </span>
              <span className="appears-with-count">{fmt.format(person.shared_photos)} shared</span>
              <span style={{
                marginLeft: "auto",
                fontSize: 11,
                fontWeight: 600,
                color: expanded === person.cluster_id ? "var(--pine)" : "var(--mist)",
                padding: "4px 10px",
                borderRadius: 6,
                background: expanded === person.cluster_id ? "rgba(35,96,106,.08)" : "rgba(18,18,24,.04)",
              }}>
                {expanded === person.cluster_id ? "Hide" : "Preview"}
              </span>
            </button>
            <Link
              href={`/together?people=${clusterId},${person.cluster_id}`}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--pine)",
                padding: "4px 10px",
                borderRadius: 6,
                background: "rgba(35,96,106,.06)",
                textDecoration: "none",
                marginLeft: 4,
                marginBottom: 4,
                display: "inline-block",
              }}
            >
              View all {fmt.format(person.shared_photos)}{" "}photos &rarr;
            </Link>
            {expanded === person.cluster_id && (
              <SharedPhotos clusterId={clusterId} otherClusterId={person.cluster_id} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
