"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Button, Spinner } from "@/components/ui";
import { BACKEND, fmt } from "@/lib/constants";
import type { ClustersSummaryResponse, ClusterSummary } from "@/types";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

interface TogetherPhoto {
  photo_id: string;
  photo_url: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
}

interface TogetherResponse {
  photos: TogetherPhoto[];
  count: number;
  people_count: number;
}

export default function TogetherPage() {
  return (
    <Suspense fallback={<div className="app-shell"><main className="page"><Spinner /></main></div>}>
      <TogetherPageInner />
    </Suspense>
  );
}

function TogetherPageInner() {
  const searchParams = useSearchParams();
  const { openLightbox } = useLightbox();
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());

  // Initialize from URL params
  useEffect(() => {
    const peopleParam = searchParams.get("people");
    if (peopleParam) {
      setSelectedPeople(new Set(peopleParam.split(",").filter(Boolean)));
    }
  }, [searchParams]);

  const { data: summary, isLoading: summaryLoading } = useQuery<ClustersSummaryResponse>({
    queryKey: ["clusters-summary", "people"],
    queryFn: () => fetch(`${BACKEND}/clusters/people/summary`).then((r) => r.json()),
  });

  // Only fetch when 2+ people selected
  const peopleParam = [...selectedPeople].join(",");
  const { data: results, isLoading: resultsLoading } = useQuery<TogetherResponse>({
    queryKey: ["together", peopleParam],
    queryFn: () => fetch(`${BACKEND}/photos/together?people=${encodeURIComponent(peopleParam)}`).then((r) => r.json()),
    enabled: selectedPeople.size >= 2,
  });

  const namedClusters = useMemo(
    () => (summary?.clusters || []).filter((c) => c.label).sort((a, b) => b.det_count - a.det_count),
    [summary]
  );

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
        {summaryLoading ? (
          <div style={{ textAlign: "center", padding: 24 }}><Spinner /></div>
        ) : (
          <div className="together-people">
            {namedClusters.map((cluster) => (
              <button
                key={cluster.id}
                className={`together-person ${selectedPeople.has(cluster.id) ? "is-selected" : ""}`}
                onClick={() => togglePerson(cluster.id)}
              >
                {cluster.avatar ? (
                  <img src={cluster.avatar} alt="" className="together-avatar" />
                ) : (
                  <span className="together-avatar together-avatar-fallback">?</span>
                )}
                <span className="together-name">{cluster.label}</span>
                {selectedPeople.has(cluster.id) && (
                  <span className="together-check">✓</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Selection summary */}
        {selectedPeople.size >= 2 && (
          <div className="together-summary">
            <span>Showing photos with <strong>{selectedNames}</strong></span>
            <Button small variant="ghost" onClick={() => setSelectedPeople(new Set())}>Clear</Button>
          </div>
        )}

        {selectedPeople.size === 1 && (
          <p style={{ color: "var(--mist)", fontSize: 13, marginTop: 16 }}>
            Select at least one more person.
          </p>
        )}

        {/* Results */}
        {resultsLoading && selectedPeople.size >= 2 && (
          <div style={{ textAlign: "center", padding: 32 }}><Spinner /></div>
        )}

        {!resultsLoading && results && selectedPeople.size >= 2 && (
          <>
            <div className="content-head" style={{ marginTop: 24, marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>{fmt.format(results.count)} photos together</h3>
              </div>
            </div>
            {results.photos.length > 0 ? (
              <div className="clip-results-grid">
                {results.photos.map((photo) => {
                  const lbPhotos: LightboxPhoto[] = results.photos.map((p) => ({
                    photo_id: p.photo_id, thumb_url: p.thumb_url || p.photo_url, flickr_url: p.flickr_url, photo_url: p.photo_url, photo_title: p.photo_title,
                  }));
                  return (
                    <button key={photo.photo_id} className="clip-result-card" onClick={() => openLightbox(photo.photo_id, lbPhotos)} style={{ border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                      <img src={photo.thumb_url || photo.photo_url} alt={photo.photo_title || ""} />
                      <div className="clip-result-info">
                        <span className="clip-result-title">{photo.photo_title || "Untitled"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state" style={{ minHeight: 120 }}>
                <div>
                  <h3>No photos found</h3>
                  <p>No photos contain all {selectedPeople.size} selected people together.</p>
                </div>
              </div>
            )}
          </>
        )}

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>Kindling builds useful software with character.</p>
        </footer>
      </main>
    </div>
  );
}
