"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { KindlingFooter } from "@/components/kindling-footer";

/* ── Stock photo URLs from Pexels (Seljan Salimova) ─────────────────── */

const PEXELS = [
  "https://images.pexels.com/photos/34955571/pexels-photo-34955571.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955569/pexels-photo-34955569.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955549/pexels-photo-34955549.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955548/pexels-photo-34955548.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955547/pexels-photo-34955547.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955543/pexels-photo-34955543.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955542/pexels-photo-34955542.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955541/pexels-photo-34955541.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955540/pexels-photo-34955540.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955538/pexels-photo-34955538.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955537/pexels-photo-34955537.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955536/pexels-photo-34955536.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955534/pexels-photo-34955534.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955532/pexels-photo-34955532.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955531/pexels-photo-34955531.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955530/pexels-photo-34955530.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955529/pexels-photo-34955529.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955528/pexels-photo-34955528.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955527/pexels-photo-34955527.jpeg?auto=compress&cs=tinysrgb&w=400",
  "https://images.pexels.com/photos/34955526/pexels-photo-34955526.jpeg?auto=compress&cs=tinysrgb&w=400",
];

/* ── Demo cluster data ──────────────────────────────────────────────── */

interface DemoCluster {
  id: string;
  label: string;
  photoCount: number;
  photos: string[];
}

function buildInitialClusters(): DemoCluster[] {
  return [
    { id: "mom",       label: "Mom",       photoCount: 35, photos: PEXELS.slice(0, 10) },
    { id: "dad",       label: "Dad",       photoCount: 31, photos: PEXELS.slice(4, 15) },
    { id: "maya",      label: "Maya",      photoCount: 27, photos: PEXELS.slice(7, 20) },
    { id: "uncle-jim", label: "Uncle Jim", photoCount: 4,  photos: PEXELS.slice(14, 18) },
    { id: "friends",   label: "Friends",   photoCount: 4,  photos: PEXELS.slice(16, 20) },
  ];
}

/* Canned search results */
const SEARCH_RESULTS: Record<string, { label: string; photos: string[] }> = {
  "beach":    { label: "Beach day",       photos: PEXELS.slice(0, 6) },
  "birthday": { label: "Birthday party",  photos: PEXELS.slice(3, 9) },
  "family":   { label: "Family together", photos: PEXELS.slice(5, 14) },
  "kids":     { label: "Kids",            photos: PEXELS.slice(7, 13) },
  "sunset":   { label: "Sunset",          photos: PEXELS.slice(10, 16) },
  "garden":   { label: "In the garden",   photos: PEXELS.slice(12, 18) },
  "portrait": { label: "Portraits",       photos: PEXELS.slice(0, 8) },
  "holiday":  { label: "Holiday",         photos: PEXELS.slice(2, 10) },
};

/* ── Lightbox component ─────────────────────────────────────────────── */

function DemoLightbox({
  photos,
  index,
  onClose,
  onPrev,
  onNext,
}: {
  photos: string[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="demo-lightbox-overlay" onClick={onClose}>
      <div className="demo-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="demo-lightbox-close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        {index > 0 && (
          <button className="demo-lightbox-arrow demo-lightbox-prev" onClick={onPrev} aria-label="Previous">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}
        {index < photos.length - 1 && (
          <button className="demo-lightbox-arrow demo-lightbox-next" onClick={onNext} aria-label="Next">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}
        <img
          src={photos[index].replace("w=400", "w=1200")}
          alt=""
          className="demo-lightbox-img"
        />
        <div className="demo-lightbox-counter">
          {index + 1} / {photos.length}
        </div>
      </div>
    </div>
  );
}

/* ── Main demo page ─────────────────────────────────────────────────── */

type DemoView = "library" | "person" | "search";

export default function DemoPage() {
  const [clusters, setClusters] = useState<DemoCluster[]>(buildInitialClusters);
  const [view, setView] = useState<DemoView>("library");
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  /* Lightbox state */
  const [lbPhotos, setLbPhotos] = useState<string[]>([]);
  const [lbIndex, setLbIndex] = useState(0);
  const lbOpen = lbPhotos.length > 0;

  const openLightbox = useCallback((photos: string[], idx: number) => {
    setLbPhotos(photos);
    setLbIndex(idx);
  }, []);

  const totalPhotos = clusters.reduce((sum, c) => sum + c.photoCount, 0);

  const activePerson = useMemo(
    () => clusters.find((c) => c.id === selectedCluster),
    [clusters, selectedCluster]
  );

  const searchResults = useMemo(() => {
    if (!activeSearch) return null;
    const q = activeSearch.toLowerCase();
    // Check canned results first
    for (const [key, val] of Object.entries(SEARCH_RESULTS)) {
      if (q.includes(key) || key.includes(q)) return val;
    }
    // Check person names
    const person = clusters.find((c) => c.label.toLowerCase().includes(q));
    if (person) return { label: person.label, photos: person.photos };
    // Fallback
    return { label: `Results for "${activeSearch}"`, photos: PEXELS.slice(0, 4) };
  }, [activeSearch, clusters]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setActiveSearch(searchQuery.trim());
      setView("search");
    }
  };

  const openPerson = (id: string) => {
    setSelectedCluster(id);
    setView("person");
  };

  const goLibrary = () => {
    setView("library");
    setSelectedCluster(null);
    setActiveSearch("");
    setSearchQuery("");
  };

  const startRename = (cluster: DemoCluster) => {
    setEditingLabel(cluster.id);
    setEditValue(cluster.label);
  };

  const saveRename = () => {
    if (editingLabel && editValue.trim()) {
      setClusters((prev) =>
        prev.map((c) => c.id === editingLabel ? { ...c, label: editValue.trim() } : c)
      );
    }
    setEditingLabel(null);
    setEditValue("");
  };

  return (
    <>
      <main className="demo-page">
        {/* Demo mode indicator */}
        <div className="demo-indicator">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
          </svg>
          Demo mode
          <span className="demo-indicator-sep">|</span>
          <span className="demo-indicator-note">Everything resets on refresh</span>
        </div>

        {/* Navigation breadcrumb */}
        <nav className="demo-nav">
          <button
            className={`demo-nav-link ${view === "library" ? "is-active" : ""}`}
            onClick={goLibrary}
          >
            Library
          </button>
          {view === "person" && activePerson && (
            <>
              <span className="demo-nav-sep">/</span>
              <span className="demo-nav-current">{activePerson.label}</span>
            </>
          )}
          {view === "search" && (
            <>
              <span className="demo-nav-sep">/</span>
              <span className="demo-nav-current">Search</span>
            </>
          )}
        </nav>

        {/* Search bar */}
        <div className="demo-search-bar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mist)"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            placeholder="Search people, places, or things..."
          />
          {searchQuery && (
            <button className="demo-search-clear" onClick={() => { setSearchQuery(""); if (view === "search") goLibrary(); }} aria-label="Clear">
              &times;
            </button>
          )}
          <button className="button primary small" onClick={handleSearch} disabled={!searchQuery.trim()}>
            Search
          </button>
        </div>

        {/* Library view */}
        {view === "library" && (
          <section className="demo-library">
            <div className="demo-library-head">
              <div>
                <h1>People</h1>
                <p className="demo-stat">
                  {clusters.length} people &middot; {totalPhotos} photos
                </p>
              </div>
            </div>

            <div className="demo-cluster-grid">
              {clusters.map((cluster) => (
                <button
                  key={cluster.id}
                  className="demo-cluster-card"
                  onClick={() => openPerson(cluster.id)}
                >
                  <div className="demo-cluster-cover">
                    <img src={cluster.photos[0]} alt="" />
                  </div>
                  <div className="demo-cluster-info">
                    <strong>{cluster.label}</strong>
                    <span>{cluster.photoCount} photos</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Quick stats */}
            <div className="demo-stats-band">
              <div className="demo-stat-card">
                <strong>{clusters.length}</strong>
                <span>People</span>
              </div>
              <div className="demo-stat-card">
                <strong>{totalPhotos}</strong>
                <span>Photos</span>
              </div>
              <div className="demo-stat-card">
                <strong>3</strong>
                <span>Categories</span>
              </div>
            </div>
          </section>
        )}

        {/* Person detail view */}
        {view === "person" && activePerson && (
          <section className="demo-person">
            <div className="demo-person-head">
              <div className="demo-person-avatar">
                <img src={activePerson.photos[0]} alt="" />
              </div>
              <div className="demo-person-meta">
                {editingLabel === activePerson.id ? (
                  <div className="demo-rename">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditingLabel(null); }}
                      autoFocus
                      className="demo-rename-input"
                    />
                    <button className="button primary small" onClick={saveRename}>Save</button>
                    <button className="button ghost small" onClick={() => setEditingLabel(null)}>Cancel</button>
                  </div>
                ) : (
                  <h1>
                    {activePerson.label}
                    <button
                      className="demo-rename-btn"
                      onClick={() => startRename(activePerson)}
                      aria-label="Rename"
                      title="Rename this person"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  </h1>
                )}
                <p className="demo-stat">{activePerson.photoCount} photos</p>
              </div>
            </div>

            <div className="demo-photo-grid">
              {activePerson.photos.map((photo, i) => (
                <button
                  key={`${activePerson.id}-${i}`}
                  className="demo-photo-card"
                  onClick={() => openLightbox(activePerson.photos, i)}
                >
                  <img src={photo} alt="" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Search results view */}
        {view === "search" && searchResults && (
          <section className="demo-search-results">
            <h2>{searchResults.label}</h2>
            <p className="demo-stat">{searchResults.photos.length} results</p>
            <div className="demo-photo-grid">
              {searchResults.photos.map((photo, i) => (
                <button
                  key={`search-${i}`}
                  className="demo-photo-card"
                  onClick={() => openLightbox(searchResults.photos, i)}
                >
                  <img src={photo} alt="" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* CTA to sign up */}
        <section className="demo-cta">
          <h2>Ready to organize your own photos?</h2>
          <p>Connect your Flickr and let Kindred do the rest.</p>
          <div className="demo-cta-actions">
            <Link href="/login" className="button primary" style={{ textDecoration: "none" }}>
              Sign in to get started
            </Link>
            <Link href="/" className="button ghost" style={{ textDecoration: "none" }}>
              Back to home
            </Link>
          </div>
        </section>
      </main>

      <KindlingFooter />

      {/* Lightbox */}
      {lbOpen && (
        <DemoLightbox
          photos={lbPhotos}
          index={lbIndex}
          onClose={() => setLbPhotos([])}
          onPrev={() => setLbIndex((i) => Math.max(0, i - 1))}
          onNext={() => setLbIndex((i) => Math.min(lbPhotos.length - 1, i + 1))}
        />
      )}
    </>
  );
}
