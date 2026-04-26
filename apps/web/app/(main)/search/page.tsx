"use client";

import { Suspense, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";
import type { SearchResult } from "@/types";
import { BACKEND } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { openLightbox } = useLightbox();
  const initialQ = searchParams.get("q") || "";
  const [input, setInput] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ);

  // Debounce input -> debouncedQ
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = input.trim();
      setDebouncedQ(trimmed);
      // Update URL without navigation
      if (trimmed) {
        router.replace(`/search?q=${encodeURIComponent(trimmed)}`, {
          scroll: false,
        });
      } else {
        router.replace("/search", { scroll: false });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [input, router]);

  const { data: results, isLoading } = useQuery<SearchResult[]>({
    queryKey: ["search-page", debouncedQ],
    queryFn: () =>
      fetch(
        `${BACKEND}/search?q=${encodeURIComponent(debouncedQ)}&limit=100`
      ).then((r) => r.json()),
    enabled: debouncedQ.length > 2,
  });

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

      {debouncedQ.length > 2 && isLoading && (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <Spinner />
        </div>
      )}

      {debouncedQ.length > 2 && !isLoading && results && results.length > 0 && (
        <>
          <p
            className="summary-note"
            style={{ textAlign: "left", marginBottom: 16 }}
          >
            {results.length} results for &ldquo;{debouncedQ}&rdquo;
          </p>
          <div className="clip-results-grid">
            {(() => {
              const lbPhotos: LightboxPhoto[] = results.map((r) => ({
                photo_id: r.photo_id,
                thumb_url: r.thumb_url || r.photo_url,
                flickr_url: r.flickr_url,
                photo_url: r.photo_url,
                photo_title: r.photo_title,
              }));
              return results.map((result) => (
                <button
                  key={result.photo_id}
                  className="clip-result-card"
                  onClick={() => openLightbox(result.photo_id, lbPhotos)}
                  style={{ border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <img
                    src={result.thumb_url || result.photo_url}
                    alt={result.photo_title || "Search result"}
                  />
                  <div className="clip-result-info">
                    <span className="clip-result-title">
                      {result.photo_title || "Untitled"}
                    </span>
                    <span className="clip-result-score">
                      {Math.round((1 - result.distance) * 100)}% match
                    </span>
                  </div>
                </button>
              ));
            })()}
          </div>
        </>
      )}

      {debouncedQ.length > 2 &&
        !isLoading &&
        results &&
        results.length === 0 && (
          <div className="empty-state" style={{ minHeight: 200 }}>
            <div>
              <h2>No results</h2>
              <p>
                No photos matched &ldquo;{debouncedQ}&rdquo;. Try different
                words or a broader description.
              </p>
            </div>
          </div>
        )}

      {debouncedQ.length <= 2 && !isLoading && (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div>
            <h2>Type to search</h2>
            <p>
              Enter at least 3 characters to search. Try things like
              &ldquo;sunset over water&rdquo;, &ldquo;birthday cake&rdquo;,
              or &ldquo;dog playing in snow&rdquo;.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 24 }}>
          <div>
            <h2>Search photos</h2>
            <p>
              Search your entire photo library using natural language. Powered
              by CLIP text-to-image matching.
            </p>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="empty-state" style={{ minHeight: 200 }}>
              <Spinner />
            </div>
          }
        >
          <SearchContent />
        </Suspense>

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>
            Kindling builds useful software with character: warm enough for
            real homes, sharp enough to hold up in real use.
          </p>
        </footer>
      </main>
    </div>
  );
}
