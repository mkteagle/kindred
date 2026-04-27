"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Spinner } from "./ui";
import { ConfirmDialog, MergeDialog } from "./dialogs";
import type { ClusterSummary, ClusterDetail, Detection } from "@/types";
import { BACKEND, CATEGORIES, fmt, toBackendCategory } from "@/lib/constants";

const getUniquePhotos = (items: Detection[]): Detection[] => {
  const photoMap = new Map<string, Detection>();
  items.forEach((item) => {
    if (!photoMap.has(item.photo_id)) photoMap.set(item.photo_id, item);
  });
  return Array.from(photoMap.values());
};

interface ClusterCardProps {
  category: string;
  cluster: ClusterSummary;
  onDismiss: (category: string, clusterId: string) => void;
  onLabel: (category: string, clusterId: string, name: string) => void;
  onMerge: (category: string, sourceId: string, targetId: string) => void;
  onRemoveDetections: (
    category: string,
    clusterId: string,
    detectionIds: string[]
  ) => void;
  allClusters: ClusterSummary[];
  processing?: boolean;
  gridSelecting?: boolean;
  gridSelected?: boolean;
  onGridToggle?: (clusterId: string) => void;
}

export const ClusterCard = ({
  category,
  cluster,
  onDismiss,
  onLabel,
  onMerge,
  onRemoveDetections,
  allClusters,
  processing,
  gridSelecting,
  gridSelected,
  onGridToggle,
}: ClusterCardProps): React.ReactNode => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cluster.label || "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const categoryInfo =
    CATEGORIES.find((item) => item.id === category) || CATEGORIES[0];

  const { data: detail, isLoading: detailLoading } = useQuery<ClusterDetail>({
    queryKey: ["cluster-detail", category, cluster.id],
    queryFn: () =>
      fetch(`${BACKEND}/clusters/${toBackendCategory(category)}/${cluster.id}`).then((response) =>
        response.json()
      ),
    enabled: expanded,
  });

  useEffect(() => {
    setDraft(cluster.label || "");
  }, [cluster.id, cluster.label]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const items = detail?.items || [];
  const uniquePhotos = getUniquePhotos(items);
  const canDismiss = !cluster.label;
  const name = cluster.label || `Unnamed ${categoryInfo.singular}`;

  const save = () => {
    const value = draft.trim();
    if (value) onLabel(category, cluster.id, value);
    setEditing(false);
  };

  return (
    <article
      className={`cluster-card ${gridSelected ? "grid-selected" : ""} ${processing ? "cluster-card-processing" : ""}`}
      data-cluster-id={cluster.id}
      onClick={
        gridSelecting ? () => onGridToggle?.(cluster.id) : undefined
      }
      style={
        gridSelecting
          ? { cursor: "pointer", userSelect: "none" }
          : undefined
      }
    >
      {processing && (
        <div className="card-spinner">
          <Spinner />
        </div>
      )}
      {gridSelecting && (
        <span className={`grid-check ${gridSelected ? "checked" : ""}`}>
          {gridSelected ? "\u2713" : ""}
        </span>
      )}

      <Link href={`/${category}/${cluster.id}`} className="card-cover" style={{ display: "block" }}>
        {(() => {
          // A real cover photo is a URL, not a base64 data URI
          const coverUrl = cluster.photo_url || cluster.thumb_url;
          const hasRealCover = coverUrl && !coverUrl.startsWith("data:");
          if (hasRealCover) {
            return (
              <>
                <img
                  src={coverUrl}
                  alt=""
                  className="cover-photo"
                  style={cluster.cover_crop ? {
                    objectPosition: `${cluster.cover_crop.x}% ${cluster.cover_crop.y}%`,
                  } : undefined}
                />
                {cluster.avatar && (
                  <img src={cluster.avatar} alt="" className="card-face-pip" />
                )}
              </>
            );
          }
          // No real photo — show avatar as small circle, not blown up
          const avatarSrc = cluster.avatar || coverUrl;
          if (avatarSrc) {
            return (
              <div className="cover-avatar-only">
                <img src={avatarSrc} alt="" className="cover-avatar-small" />
              </div>
            );
          }
          return <div className="avatar-fallback">?</div>;
        })()}
        <div className="cover-badge">
          {fmt.format(cluster.photo_count)} photos
        </div>
      </Link>

      <div className="card-body">
        <div className="name-row">
          {editing ? (
            <div className="edit-row">
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") save();
                  if (event.key === "Escape") setEditing(false);
                }}
                placeholder={`Name this ${categoryInfo.singular}`}
              />
              <Button small variant="primary" onClick={save}>
                Save
              </Button>
              <Button
                small
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <button
              className={`name ${cluster.label ? "" : "unnamed"}`}
              onClick={() => {
                setDraft(cluster.label || "");
                setEditing(true);
              }}
              title="Rename"
            >
              {name}
            </button>
          )}
        </div>

        <div className="card-meta">
          <span>{fmt.format(cluster.det_count)} detections</span>
          <span>{fmt.format(cluster.photo_count)} photos</span>
        </div>

        <div className="card-actions">
          <Button
            small
            variant="dark"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Collapse" : "Preview"}
          </Button>
          <Button
            small
            variant="ghost"
            onClick={() => setMergeOpen(true)}
          >
            Merge
          </Button>
          {canDismiss && (
            <Button
              small
              variant="danger"
              onClick={() => setConfirmOpen(true)}
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="photo-strip">
          {detailLoading ? (
            <Spinner />
          ) : (
            <>
              <div className="chip-toolbar">
                <Button
                  small
                  variant={selecting ? "primary" : "ghost"}
                  onClick={() => {
                    setSelecting(!selecting);
                    setSelected(new Set());
                  }}
                >
                  {selecting ? `${selected.size} selected` : "Select"}
                </Button>
                {selecting && selected.size > 0 && (
                  <>
                    <Button
                      small
                      variant="danger"
                      onClick={() => {
                        onRemoveDetections(
                          category,
                          cluster.id,
                          [...selected]
                        );
                        setSelected(new Set());
                        setSelecting(false);
                      }}
                    >
                      Remove {selected.size}
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </Button>
                  </>
                )}
                {selecting && (
                  <Button
                    small
                    variant="ghost"
                    onClick={() => {
                      setSelected(new Set(items.map((i) => i.id)));
                    }}
                  >
                    Select all
                  </Button>
                )}
              </div>
              <div
                className={`chip-row ${selecting ? "chip-row-select" : ""}`}
              >
                {items
                  .slice(0, selecting ? items.length : 16)
                  .map((item) => (
                    <div
                      key={item.id}
                      className={`chip-wrap ${
                        selected.has(item.id) ? "chip-selected" : ""
                      }`}
                      onClick={
                        selecting
                          ? () => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              });
                            }
                          : undefined
                      }
                    >
                      <img
                        src={
                          item.chip || item.thumb_url || item.photo_url
                        }
                        alt=""
                        onClick={
                          !selecting
                            ? () =>
                                window.open(
                                  item.flickr_url || item.photo_url,
                                  "_blank"
                                )
                            : undefined
                        }
                      />
                      {!selecting && (
                        <button
                          className="chip-remove"
                          title="Remove from this group"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveDetections(category, cluster.id, [
                              item.id,
                            ]);
                          }}
                        >
                          &times;
                        </button>
                      )}
                      {selecting && selected.has(item.id) && (
                        <span className="chip-check">&#10003;</span>
                      )}
                    </div>
                  ))}
                {!selecting && items.length > 16 && (
                  <div className="chip-more">+{items.length - 16}</div>
                )}
              </div>
              <div className="thumb-grid">
                {uniquePhotos.slice(0, 6).map((item) => (
                  <button
                    key={item.photo_id}
                    className="thumb"
                    onClick={() =>
                      window.open(
                        item.flickr_url || item.photo_url,
                        "_blank"
                      )
                    }
                    title={item.photo_title || "Open photo"}
                  >
                    <img
                      src={item.thumb_url || item.photo_url}
                      alt={item.photo_title || ""}
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <MergeDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        onSelect={(targetId) => onMerge(category, cluster.id, targetId)}
        sourceCluster={cluster}
        clusters={allClusters}
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => onDismiss(category, cluster.id)}
        avatar={cluster.avatar}
        title={`Dismiss ${name}?`}
        message={`This removes ${fmt.format(
          cluster.det_count
        )} face detections from this library and remembers not to show similar faces again.`}
      />
    </article>
  );
};
