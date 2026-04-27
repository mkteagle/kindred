"use client";

import { useState, useMemo } from "react";
import { PEOPLE_CLUSTERS, PEXELS } from "../demo-data";

const fmt = new Intl.NumberFormat();

export default function DemoTogetherPage() {
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());

  const namedClusters = PEOPLE_CLUSTERS;

  const togglePerson = (id: string) => {
    setSelectedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedNames = namedClusters
    .filter((c) => selectedPeople.has(c.id))
    .map((c) => c.label)
    .join(" & ");

  /* Mock "together" results — pick photos that appear in both clusters */
  const togetherPhotos = useMemo(() => {
    if (selectedPeople.size < 2) return [];
    const selected = namedClusters.filter((c) => selectedPeople.has(c.id));
    if (selected.length < 2) return [];
    /* Find photos shared between any two selected people */
    const photoSets = selected.map((c) => new Set(c.photos));
    const shared = [...photoSets[0]].filter((p) =>
      photoSets.slice(1).every((s) => s.has(p))
    );
    /* If no overlap, just return a mock selection */
    if (shared.length === 0) {
      return PEXELS.slice(0, 6);
    }
    return shared;
  }, [selectedPeople, namedClusters]);

  /* Lightbox */
  const [lbOpen, setLbOpen] = useState(false);
  const [lbIndex, setLbIndex] = useState(0);

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 16 }}>
          <div>
            <h2>Photos Together</h2>
            <p>Select people to find photos where they all appear together.</p>
          </div>
        </div>

        {/* People selector */}
        <div className="together-people">
          {namedClusters.map((cluster) => (
            <button
              key={cluster.id}
              className={`together-person ${selectedPeople.has(cluster.id) ? "is-selected" : ""}`}
              onClick={() => togglePerson(cluster.id)}
            >
              <img src={cluster.avatar} alt="" className="together-avatar" />
              <span className="together-name">{cluster.label}</span>
              {selectedPeople.has(cluster.id) && (
                <span className="together-check">&#10003;</span>
              )}
            </button>
          ))}
        </div>

        {/* Selection summary */}
        {selectedPeople.size >= 2 && (
          <div className="together-summary">
            <span>Showing photos with <strong>{selectedNames}</strong></span>
            <button
              className="button ghost"
              style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => setSelectedPeople(new Set())}
            >
              Clear
            </button>
          </div>
        )}

        {selectedPeople.size === 1 && (
          <p style={{ color: "var(--mist)", fontSize: 13, marginTop: 16 }}>
            Select at least one more person.
          </p>
        )}

        {selectedPeople.size === 0 && (
          <p style={{ color: "var(--mist)", fontSize: 13, marginTop: 16 }}>
            Select two or more people above to see photos where they appear together.
          </p>
        )}

        {/* Results */}
        {selectedPeople.size >= 2 && togetherPhotos.length > 0 && (
          <>
            <div className="content-head" style={{ marginTop: 24, marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>{fmt.format(togetherPhotos.length)} photos together</h3>
              </div>
            </div>
            <div className="clip-results-grid">
              {togetherPhotos.map((photo, i) => (
                <button
                  key={i}
                  className="clip-result-card"
                  onClick={() => { setLbIndex(i); setLbOpen(true); }}
                  style={{ border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <img src={photo} alt="" />
                  <div className="clip-result-info">
                    <span className="clip-result-title">{selectedNames}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {selectedPeople.size >= 2 && togetherPhotos.length === 0 && (
          <div className="empty-state" style={{ minHeight: 120 }}>
            <div>
              <h3>No photos found</h3>
              <p>No photos contain all {selectedPeople.size} selected people together.</p>
            </div>
          </div>
        )}

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>Kindling builds useful software with character.</p>
        </footer>
      </main>

      {/* Lightbox */}
      {lbOpen && togetherPhotos.length > 0 && (
        <div className="lb-overlay" onClick={() => setLbOpen(false)}>
          <div className="lb-topbar">
            <button className="lb-close" onClick={() => setLbOpen(false)} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <span className="lb-counter">{lbIndex + 1} / {togetherPhotos.length}</span>
            <span className="lb-title">{selectedNames}</span>
          </div>
          {lbIndex > 0 && (
            <button className="lb-arrow lb-arrow-prev" onClick={(e) => { e.stopPropagation(); setLbIndex((i) => i - 1); }} aria-label="Previous">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          )}
          {lbIndex < togetherPhotos.length - 1 && (
            <button className="lb-arrow lb-arrow-next" onClick={(e) => { e.stopPropagation(); setLbIndex((i) => i + 1); }} aria-label="Next">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          )}
          <div className="lb-image-area" onClick={(e) => e.stopPropagation()}>
            <img
              src={togetherPhotos[lbIndex].replace("w=400", "w=1200")}
              alt=""
              className="lb-main-image is-loaded"
            />
          </div>
        </div>
      )}
    </div>
  );
}
