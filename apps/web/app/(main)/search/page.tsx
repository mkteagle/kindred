"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";
import type { SearchResult } from "@/types";
import { BACKEND } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

type Media = "all" | "photo" | "video";

interface SearchResponse {
  results: SearchResult[];
  query: string;
}

interface NamedCluster {
  cluster_id: string;
  label: string;
  category: string;
}

const MEDIA_TABS: { value: Media; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "photo", label: "Photos" },
  { value: "video", label: "Videos" },
];

function thumbFor(result: SearchResult, media: string | undefined): string {
  // Videos have no Flickr thumbnail; their poster frame comes off the NAS.
  return media === "video"
    ? `${BACKEND}/photos/${result.photo_id}/local?variant=thumb`
    : result.thumb_url || result.photo_url || `${BACKEND}/photos/${result.photo_id}/image?size=n`;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { openLightbox } = useLightbox();

  const [input, setInput] = useState(searchParams.get("q") || "");
  const [debouncedQ, setDebouncedQ] = useState(searchParams.get("q") || "");
  const [media, setMedia] = useState<Media>((searchParams.get("media") as Media) || "all");
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") || "");
  const [person, setPerson] = useState(searchParams.get("cluster_id") || "");
  const [dateField, setDateField] = useState(searchParams.get("date_field") || "taken");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  // People available as a facet. Cheap, cached, and unrelated to the query.
  const { data: people } = useQuery<NamedCluster[]>({
    queryKey: ["named-clusters"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/clusters/named`);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.clusters ?? data ?? []) as NamedCluster[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const selectedPerson = useMemo(
    () => people?.find((p) => p.cluster_id === person),
    [people, person],
  );

  const params = useMemo(() => {
    const next = new URLSearchParams();
    if (debouncedQ) next.set("q", debouncedQ);
    if (media !== "all") next.set("media", media);
    if (dateFrom) next.set("date_from", dateFrom);
    if (dateTo) next.set("date_to", dateTo);
    if ((dateFrom || dateTo) && dateField !== "taken") next.set("date_field", dateField);
    if (person && selectedPerson) {
      next.set("cluster_id", person);
      next.set("category", selectedPerson.category);
    }
    return next;
  }, [debouncedQ, media, dateFrom, dateTo, dateField, person, selectedPerson]);

  // Keep the URL shareable and reloadable.
  useEffect(() => {
    const qs = params.toString();
    router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
  }, [params, router]);

  const hasFacets = media !== "all" || Boolean(dateFrom || dateTo || person);
  // Free text needs a few characters to be meaningful; facets alone are enough
  // on their own, so a filter-only search runs immediately.
  const enabled = debouncedQ.length > 2 || hasFacets;

  const { data, isLoading } = useQuery<SearchResponse>({
    queryKey: ["search-page", params.toString()],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/search?${params.toString()}&limit=100`);
      if (!response.ok) throw new Error("Search failed");
      return response.json();
    },
    enabled,
  });

  const results = data?.results ?? [];
  const lightboxPhotos: LightboxPhoto[] = results.map((result) => ({
    photo_id: result.photo_id,
    thumb_url: thumbFor(result, (result as SearchResult & { media_kind?: string }).media_kind),
    flickr_url: result.flickr_url,
    photo_url: result.photo_url,
    photo_title: result.photo_title,
  }));

  function clearFacets() {
    setMedia("all");
    setDateFrom("");
    setDateTo("");
    setDateField("taken");
    setPerson("");
  }

  return (
    <>
      <label className="search" style={{ marginBottom: 16 }}>
        <span aria-hidden="true">Search</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe what you're looking for, or just filter below…"
          autoFocus
        />
        {input && (
          <button className="search-clear" type="button" onClick={() => setInput("")} aria-label="Clear search">
            &times;
          </button>
        )}
      </label>

      <div className="search-facets">
        <div className="facet-tabs" role="group" aria-label="Media type">
          {MEDIA_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={`facet-tab ${media === tab.value ? "is-active" : ""}`}
              aria-pressed={media === tab.value}
              onClick={() => setMedia(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <label className="facet-field">
          <span>Date</span>
          <select value={dateField} onChange={(e) => setDateField(e.target.value)}>
            <option value="taken">Taken</option>
            <option value="added">Added to Kindred</option>
          </select>
        </label>
        <label className="facet-field">
          <span>From</span>
          <input type="date" value={dateFrom} max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="facet-field">
          <span>To</span>
          <input type="date" value={dateTo} min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)} />
        </label>

        <label className="facet-field">
          <span>Who</span>
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Anyone</option>
            {(people ?? []).map((p) => (
              <option key={p.cluster_id} value={p.cluster_id}>{p.label}</option>
            ))}
          </select>
        </label>

        {hasFacets && (
          <button type="button" className="button small ghost" onClick={clearFacets}>
            Clear filters
          </button>
        )}
      </div>

      {enabled && isLoading && (
        <div className="cluster-grid" style={{ padding: "20px 0" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton-card" style={{ aspectRatio: "1", borderRadius: 6 }} />
          ))}
        </div>
      )}

      {enabled && !isLoading && results.length > 0 && (
        <>
          <p className="summary-note" style={{ textAlign: "left", marginBottom: 16 }}>
            {results.length} result{results.length === 1 ? "" : "s"}
            {debouncedQ && <> for &ldquo;{debouncedQ}&rdquo;</>}
            {selectedPerson && <> with {selectedPerson.label}</>}
            {media !== "all" && <> · {media === "video" ? "videos" : "photos"} only</>}
            {(dateFrom || dateTo) && dateField === "added" && <> · by date added</>}
          </p>
          <div className="clip-results-grid">
            {results.map((result) => {
              const kind = (result as SearchResult & { media_kind?: string }).media_kind;
              return (
                <button
                  key={result.photo_id}
                  className="clip-result-card"
                  onClick={() => openLightbox(result.photo_id, lightboxPhotos)}
                  style={{ border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <img src={thumbFor(result, kind)} alt={result.photo_title || "Search result"} loading="lazy" />
                  {kind === "video" && <span className="clip-result-badge">Video</span>}
                  <div className="clip-result-info">
                    <span className="clip-result-title">{result.photo_title || "Untitled"}</span>
                    {typeof result.distance === "number" && result.match_type === "visual" && (
                      <span className="clip-result-score">
                        {Math.round((1 - result.distance) * 100)}% match
                      </span>
                    )}
                    {result.match_type === "person" && result.match_name && (
                      <span className="clip-result-score">{result.match_name}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {enabled && !isLoading && results.length === 0 && (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div>
            <h2>No results</h2>
            <p>Nothing matched those filters. Try widening the dates, or clearing a filter.</p>
          </div>
        </div>
      )}

      {!enabled && (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div>
            <h2>Search your library</h2>
            <p>
              Describe what you are looking for — &ldquo;sunset over water&rdquo;,
              &ldquo;birthday cake&rdquo; — or use the filters above on their own to
              browse by date, by person, or just your videos.
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
            <h2>Search</h2>
            <p>
              Natural language across photos and videos, crossed with filters for
              date, person and media type.
            </p>
          </div>
        </div>

        <Suspense fallback={<div className="empty-state" style={{ minHeight: 200 }}><Spinner /></div>}>
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
