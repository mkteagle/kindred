"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDemoCategory, PEOPLE_CLUSTERS, type DemoCluster } from "../../demo-data";

const fmt = new Intl.NumberFormat();

export default function DemoClusterDetailPage() {
  const params = useParams();
  const categoryId = (params.category as string) || "people";
  const clusterId = params.clusterId as string;
  const catInfo = getDemoCategory(categoryId);
  const cluster = catInfo?.clusters.find((c) => c.id === clusterId);

  const [lbOpen, setLbOpen] = useState(false);
  const [lbIndex, setLbIndex] = useState(0);

  const openLightbox = useCallback((idx: number) => {
    setLbIndex(idx);
    setLbOpen(true);
  }, []);

  if (!catInfo || !cluster) {
    return (
      <div className="app-shell">
        <main className="page">
          <div className="empty-state">
            <div>
              <h2>Not found</h2>
              <p>This group doesn&apos;t exist in the demo.</p>
              <Link href="/demo" className="button primary" style={{ textDecoration: "none", marginTop: 12, display: "inline-block" }}>
                Back to library
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  /* Appears with — for people category, show other people who share photos */
  const appearsWith: DemoCluster[] = categoryId === "people"
    ? PEOPLE_CLUSTERS.filter((p) => p.id !== cluster.id).slice(0, 3)
    : [];

  return (
    <div className="app-shell">
      <main className="page">
        {/* Breadcrumb */}
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--mist)" }}>
          <Link href="/demo" style={{ color: "var(--pine)", textDecoration: "none", fontWeight: 600 }}>Library</Link>
          <span>/</span>
          <Link href={`/demo/${categoryId}`} style={{ color: "var(--pine)", textDecoration: "none", fontWeight: 600 }}>{catInfo.label}</Link>
          <span>/</span>
          <span style={{ color: "var(--ash)", fontWeight: 600 }}>{cluster.label}</span>
        </div>

        <div className="content-head">
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <img
              src={cluster.avatar}
              alt=""
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                objectFit: "cover",
                border: "3px solid var(--card)",
                boxShadow: "0 8px 24px rgba(42,32,27,.15)",
              }}
            />
            <div>
              <h2 style={{ marginBottom: 0 }}>{cluster.label}</h2>
              <p style={{ margin: "4px 0 0" }}>
                {fmt.format(cluster.photoCount)} photos in this group
              </p>
            </div>
          </div>
        </div>

        {/* Appears with section (people only) */}
        {appearsWith.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: "0 0 8px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--mist)" }}>
              Appears with
            </p>
            <div className="appears-with-grid">
              {appearsWith.map((other) => (
                <Link key={other.id} href={`/demo/${categoryId}/${other.id}`} className="appears-with-card">
                  <img
                    src={other.avatar}
                    alt=""
                    style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{other.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Photo grid */}
        <div className="clip-results-grid">
          {cluster.photos.map((photo, i) => (
            <button
              key={i}
              className="clip-result-card"
              onClick={() => openLightbox(i)}
              style={{ border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
            >
              <img src={photo} alt="" />
              <div className="clip-result-info">
                <span className="clip-result-title">{cluster.label} #{i + 1}</span>
              </div>
            </button>
          ))}
        </div>

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>Kindling builds useful software with character.</p>
        </footer>
      </main>

      {/* Lightbox */}
      {lbOpen && (
        <DemoLightbox
          photos={cluster.photos}
          index={lbIndex}
          title={cluster.label}
          onClose={() => setLbOpen(false)}
          onPrev={() => setLbIndex((i) => Math.max(0, i - 1))}
          onNext={() => setLbIndex((i) => Math.min(cluster.photos.length - 1, i + 1))}
          onGo={(idx) => setLbIndex(idx)}
        />
      )}
    </div>
  );
}

/* ── Lightbox ─────────────────────────────────────────────────────── */

function DemoLightbox({
  photos,
  index,
  title,
  onClose,
  onPrev,
  onNext,
  onGo,
}: {
  photos: string[];
  index: number;
  title: string;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onGo: (idx: number) => void;
}) {
  return (
    <div className="lb-overlay" onClick={onClose}>
      {/* Top bar */}
      <div className="lb-topbar">
        <button className="lb-close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <span className="lb-counter">{index + 1} / {photos.length}</span>
        <span className="lb-title">{title}</span>
      </div>

      {/* Arrows */}
      {index > 0 && (
        <button className="lb-arrow lb-arrow-prev" onClick={(e) => { e.stopPropagation(); onPrev(); }} aria-label="Previous">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      )}
      {index < photos.length - 1 && (
        <button className="lb-arrow lb-arrow-next" onClick={(e) => { e.stopPropagation(); onNext(); }} aria-label="Next">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      )}

      {/* Image */}
      <div className="lb-image-area" onClick={(e) => e.stopPropagation()}>
        <img
          src={photos[index].replace("w=400", "w=1200")}
          alt=""
          className="lb-main-image is-loaded"
        />
      </div>

      {/* Thumb strip */}
      <div className="lb-thumb-strip">
        {photos.map((p, i) => (
          <button
            key={i}
            className={`lb-thumb ${i === index ? "is-active" : ""}`}
            onClick={(e) => { e.stopPropagation(); onGo(i); }}
          >
            <img src={p} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
