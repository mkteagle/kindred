"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { searchDemoPhotos } from "../demo-data";

function DemoSearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQ = searchParams.get("q") || "";
  const [input, setInput] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ);

  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = input.trim();
      setDebouncedQ(trimmed);
      if (trimmed) {
        router.replace(`/demo/search?q=${encodeURIComponent(trimmed)}`, { scroll: false });
      } else {
        router.replace("/demo/search", { scroll: false });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [input, router]);

  const results = useMemo(() => {
    if (debouncedQ.length <= 2) return null;
    return searchDemoPhotos(debouncedQ);
  }, [debouncedQ]);

  return (
    <>
      <label className="search" style={{ marginBottom: 28 }}>
        <span aria-hidden="true">Search</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe what you're looking for..."
          autoFocus
        />
        {input && (
          <button className="search-clear" type="button" onClick={() => setInput("")} aria-label="Clear search">
            &times;
          </button>
        )}
      </label>

      {debouncedQ.length <= 2 && (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div>
            <h2>Search your library</h2>
            <p>Type at least 3 characters to search. Try &ldquo;beach&rdquo;, &ldquo;camping&rdquo;, or a person&apos;s name.</p>
          </div>
        </div>
      )}

      {debouncedQ.length > 2 && results && results.photos.length > 0 && (
        <>
          <p className="summary-note" style={{ textAlign: "left", marginBottom: 16 }}>
            {results.photos.length} results for &ldquo;{debouncedQ}&rdquo;
          </p>
          <div className="clip-results-grid">
            {results.photos.map((photo, i) => (
              <div key={i} className="clip-result-card">
                <img src={photo} alt="" />
                <div className="clip-result-info">
                  <span className="clip-result-title">{results.label}</span>
                  <span className="clip-result-score">{90 - i * 3}% match</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {debouncedQ.length > 2 && (!results || results.photos.length === 0) && (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div>
            <h2>No results</h2>
            <p>Nothing matched &ldquo;{debouncedQ}&rdquo;. Try a different search term.</p>
          </div>
        </div>
      )}
    </>
  );
}

export default function DemoSearchPage() {
  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 24 }}>
          <div>
            <h2>Search</h2>
            <p>Search across all your photos by describing what you&apos;re looking for.</p>
          </div>
        </div>

        <Suspense fallback={
          <div className="clip-results-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton-card" style={{ aspectRatio: "1", borderRadius: 6 }} />
            ))}
          </div>
        }>
          <DemoSearchContent />
        </Suspense>

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>Kindling builds useful software with character.</p>
        </footer>
      </main>
    </div>
  );
}
