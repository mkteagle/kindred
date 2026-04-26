"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "./ui";
import { MergeDialog } from "./dialogs";
import type { ClusterSummary, ClusterDetail, Detection } from "@/types";
import { BACKEND, CATEGORIES, fmt, toBackendCategory } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

const getUniquePhotos = (items: Detection[]): Detection[] => {
  const seen = new Map<string, Detection>();
  items.forEach((i) => { if (!seen.has(i.photo_id)) seen.set(i.photo_id, i); });
  return Array.from(seen.values());
};

/* ── Props ──────────────────────────────────────────────────────────── */

interface ReviewModeProps {
  category: string;
  clusters: ClusterSummary[];
  allClusters: ClusterSummary[];
  onDismiss: (category: string, clusterId: string) => void;
  onLabel: (category: string, clusterId: string, name: string) => void;
  onMerge: (category: string, sourceId: string, targetId: string) => void;
  onRemoveDetections: (category: string, clusterId: string, detectionIds: string[]) => void;
  onDeleteDetection: (detectionId: string) => void;
  onClose: () => void;
}

export function ReviewMode({
  category,
  clusters,
  allClusters,
  onDismiss,
  onLabel,
  onMerge,
  onRemoveDetections,
  onDeleteDetection,
  onClose,
}: ReviewModeProps) {
  const { openLightbox } = useLightbox();
  const backendCat = toBackendCategory(category);
  const categoryInfo = CATEGORIES.find((c) => c.id === category) || CATEGORIES[0];

  const [acted, setActed] = useState<Set<string>>(new Set());
  const remaining = clusters.filter((c) => !acted.has(c.id));
  const [index, setIndex] = useState(0);
  const current = remaining[index] || null;

  const [transitioning, setTransitioning] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  const { data: detail, isLoading: detailLoading, isError, error, refetch } = useQuery<ClusterDetail>({
    queryKey: ["cluster-detail", category, current?.id],
    queryFn: () =>
      fetch(`${BACKEND}/clusters/${backendCat}/${current!.id}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`);
        return r.json();
      }),
    enabled: !!current,
    retry: 1,
  });

  const qc = useQueryClient();
  const next = remaining[index + 1] || null;
  useEffect(() => {
    if (next) {
      qc.prefetchQuery({
        queryKey: ["cluster-detail", category, next.id],
        queryFn: () =>
          fetch(`${BACKEND}/clusters/${backendCat}/${next.id}`).then((r) => r.json()),
      });
    }
  }, [next?.id, category, backendCat, qc]);

  const items = detail?.items || [];
  const uniquePhotos = getUniquePhotos(items);

  useEffect(() => { if (naming) setTimeout(() => inputRef.current?.focus(), 50); }, [naming]);

  const doTransition = useCallback((fn: () => void) => {
    setTransitioning(true);
    setNaming(false);
    setDraft("");
    setTimeout(() => { fn(); setTransitioning(false); }, 180);
  }, []);

  const handleDismiss = useCallback(() => {
    if (!current) return;
    const id = current.id;
    doTransition(() => { setActed((p) => new Set(p).add(id)); onDismiss(category, id); });
  }, [current, category, onDismiss, doTransition]);

  const handleName = useCallback(() => {
    if (!current || !draft.trim()) return;
    const id = current.id;
    const name = draft.trim();
    doTransition(() => { setActed((p) => new Set(p).add(id)); onLabel(category, id, name); });
  }, [current, draft, category, onLabel, doTransition]);

  const handleMerge = useCallback((targetId: string) => {
    if (!current) return;
    const id = current.id;
    setMergeOpen(false);
    doTransition(() => { setActed((p) => new Set(p).add(id)); onMerge(category, id, targetId); });
  }, [current, category, onMerge, doTransition]);

  const handleSkip = useCallback(() => {
    setNaming(false); setDraft("");
    setIndex((i) => Math.min(i + 1, remaining.length - 1));
  }, [remaining.length]);

  const handleBack = useCallback(() => {
    setNaming(false); setDraft("");
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (naming) { if (e.key === "Escape") { setNaming(false); setDraft(""); } return; }
      if (mergeOpen) return;
      if (e.key === "d" || e.key === "D") { e.preventDefault(); handleDismiss(); }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setNaming(true); setDraft(""); }
      if (e.key === "m" || e.key === "M") { e.preventDefault(); setMergeOpen(true); }
      if (e.key === "ArrowRight" || e.key === "s" || e.key === " ") { e.preventDefault(); handleSkip(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); handleBack(); }
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [naming, mergeOpen, handleDismiss, handleSkip, handleBack, onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  /* ── All done ─────────────────────────────────────────────────────── */

  if (remaining.length === 0 || !current) {
    return (
      <div className="rv">
        <div className="rv-done">
          <div className="rv-done-ring">
            <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="none" stroke="rgba(102,187,106,.3)" strokeWidth="3" />
              <circle cx="24" cy="24" r="20" fill="none" stroke="#66bb6a" strokeWidth="3"
                strokeDasharray="126" strokeDashoffset="0" strokeLinecap="round"
                style={{ transition: "stroke-dashoffset .6s ease" }} /></svg>
            <span>&#10003;</span>
          </div>
          <h2>All caught up</h2>
          <p>Reviewed {acted.size} unnamed {categoryInfo.cards}.</p>
          <button className="rv-done-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  const progress = clusters.length - remaining.length;
  const total = clusters.length;
  const pct = ((progress + index + 1) / total) * 100;
  const showSkeleton = transitioning || (detailLoading && !detail);

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <div className="rv">
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <header className="rv-top">
        <button className="rv-x" onClick={onClose} aria-label="Exit">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="rv-track">
          <div className="rv-track-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="rv-pos">{progress + index + 1}&thinsp;/&thinsp;{total}</span>
        <div className="rv-keys">
          <kbd>D</kbd><span>dismiss</span>
          <kbd>N</kbd><span>name</span>
          <kbd>M</kbd><span>merge</span>
          <kbd>&rarr;</kbd><span>skip</span>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="rv-stage">
        {showSkeleton ? (
          <div className="rv-card" key="skeleton">
            <div className="rv-hero">
              <div className="rv-skel rv-skel-hero" />
            </div>
            <div className="rv-side">
              <div className="rv-faces-wrap">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="rv-skel rv-skel-face" />
                ))}
              </div>
              <div className="rv-grid-skel">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rv-skel rv-skel-ph" />
                ))}
              </div>
              <div className="rv-act-skel">
                <div className="rv-skel rv-skel-btn" />
                <div className="rv-skel rv-skel-btn" />
                <div className="rv-skel rv-skel-btn" />
              </div>
            </div>
          </div>
        ) : isError ? (
          <div className="rv-card rv-card-err">
            <div className="rv-err">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--ember-soft)"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h3>Couldn&rsquo;t load this one</h3>
              <p>{error instanceof Error ? error.message : "Unknown error"}</p>
              <button className="rv-err-retry" onClick={() => refetch()}>Retry</button>
            </div>
          </div>
        ) : (
          <div className="rv-card" key={current.id}>
            {/* Left: hero photo */}
            <div className="rv-hero">
              {current.photo_url || current.thumb_url ? (
                <img src={current.photo_url || current.thumb_url} alt="" draggable={false} />
              ) : current.avatar ? (
                <img src={current.avatar} alt="" draggable={false}
                  style={{ objectFit: "contain", background: "rgba(74,40,26,.06)" }} />
              ) : (
                <div className="rv-hero-empty">
                  <span>?</span>
                </div>
              )}
            </div>

            {/* Right: info + actions */}
            <div className="rv-side">
              {/* Stats */}
              <div className="rv-meta">
                <span className="rv-meta-pill">{fmt.format(current.det_count)} detection{current.det_count !== 1 ? "s" : ""}</span>
                <span className="rv-meta-pill">{fmt.format(current.photo_count)} photo{current.photo_count !== 1 ? "s" : ""}</span>
                {items[0]?.subtype && <span className="rv-meta-pill rv-meta-subtype">{items[0].subtype}</span>}
              </div>

              {/* Face chips — THE important part */}
              {items.length > 0 && (
                <div className="rv-faces">
                  <label className="rv-label">Detections</label>
                  <div className="rv-faces-wrap">
                    {items.slice(0, 24).map((item) => (
                      <div key={item.id} className="rv-face-wrap">
                        <img
                          src={item.chip || item.thumb_url || item.photo_url}
                          alt="" className="rv-face"
                          onClick={() => window.open(item.flickr_url || item.photo_url, "_blank")}
                        />
                        <button className="rv-face-rm"
                          title="Wrong detection — remove"
                          onClick={() => onDeleteDetection(item.id)}>
                          &times;
                        </button>
                      </div>
                    ))}
                    {items.length > 24 && (
                      <span className="rv-face-more">+{items.length - 24}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Photo thumbnails */}
              {uniquePhotos.length > 1 && (
                <div className="rv-photos">
                  <label className="rv-label">Photos</label>
                  <div className="rv-photos-grid">
                    {uniquePhotos.slice(0, 6).map((p) => {
                      const lbPhotos: LightboxPhoto[] = uniquePhotos.map((ph) => ({
                        photo_id: ph.photo_id,
                        thumb_url: ph.thumb_url || ph.photo_url,
                        flickr_url: ph.flickr_url,
                        photo_url: ph.photo_url,
                        photo_title: ph.photo_title,
                      }));
                      return (
                        <button key={p.photo_id} className="rv-ph"
                          onClick={() => openLightbox(p.photo_id, lbPhotos)}>
                          <img src={p.thumb_url || p.photo_url} alt={p.photo_title || ""} />
                        </button>
                      );
                    })}
                    {uniquePhotos.length > 6 && (
                      <span className="rv-ph-more">+{uniquePhotos.length - 6}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Spacer pushes actions to bottom */}
              <div style={{ flex: 1 }} />

              {/* Action bar */}
              <div className="rv-actions">
                {naming ? (
                  <div className="rv-namer">
                    <input ref={inputRef} value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && draft.trim()) handleName();
                        if (e.key === "Escape") { setNaming(false); setDraft(""); }
                      }}
                      placeholder={`Name this ${categoryInfo.singular}...`}
                      className="rv-namer-input"
                    />
                    <button className="rv-btn rv-btn-go" onClick={handleName}
                      disabled={!draft.trim()}>Save</button>
                    <button className="rv-btn rv-btn-mute"
                      onClick={() => { setNaming(false); setDraft(""); }}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <button className="rv-btn rv-btn-dismiss" onClick={handleDismiss}
                      title={`Not a ${categoryInfo.singular} — dismiss all detections`}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      Not {categoryInfo.singular === "person" ? "a person" : `an ${categoryInfo.singular}`}
                    </button>
                    <button className="rv-btn rv-btn-name" onClick={() => { setNaming(true); setDraft(""); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Name
                    </button>
                    <button className="rv-btn rv-btn-merge" onClick={() => setMergeOpen(true)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
                      </svg>
                      Merge
                    </button>
                  </>
                )}
              </div>

              {/* Nav arrows */}
              <div className="rv-nav">
                <button className="rv-nav-btn" onClick={handleBack} disabled={index === 0}>&larr; Back</button>
                <button className="rv-nav-btn" onClick={handleSkip}
                  disabled={index >= remaining.length - 1}>Skip &rarr;</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <MergeDialog open={mergeOpen} onClose={() => setMergeOpen(false)}
        onSelect={handleMerge} sourceCluster={current} clusters={allClusters} />
    </div>
  );
}
