"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BACKEND, fmt } from "@/lib/constants";
import type { SearchResult } from "@/types";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { SearchIcon } from "@/components/kx/icons";
import { rememberSearch } from "@/components/kx/search-overlay";
import { KxEmptyResults, KxSkeletonCards } from "@/components/kx/states";
import { KxDateFacet, type DateField, type DateRange } from "@/components/kx/date-facet";
import { useNamedPeople } from "@/components/kx/use-people";
import { photoThumb } from "@/lib/photo-url";
import { SEARCH_DELAY, useSearchResults } from "@/lib/use-search-results";

type Media = "all" | "photo" | "video";

const MEDIA_CHIPS: { value: Media; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "photo", label: "Photos" },
  { value: "video", label: "Videos" },
];

/** How many people to offer as chips before the list gets unwieldy. */
const PEOPLE_CHIPS = 4;

function thumbFor(result: SearchResult & { media_kind?: string }): string {
  // Videos have no Flickr thumbnail; their poster frame comes off the NAS.
  return result.media_kind === "video"
    ? `${BACKEND}/photos/${result.photo_id}/local?variant=thumb`
    : photoThumb(result);
}

function SearchContent() {
  const searchParams = useSearchParams();
  const { openLightbox } = useLightbox();

  const urlQuery = searchParams.get("q") || "";
  const lastUrlQuery = useRef(urlQuery);
  const [input, setInput] = useState(urlQuery);
  const [debouncedQ, setDebouncedQ] = useState(urlQuery.trim());
  const [media, setMedia] = useState<Media>((searchParams.get("media") as Media) || "all");
  const [dates, setDates] = useState<DateRange>({
    field: (searchParams.get("date_field") as DateField) || "taken",
    from: searchParams.get("date_from") || "",
    to: searchParams.get("date_to") || "",
  });
  const [person, setPerson] = useState(searchParams.get("cluster_id") || "");
  const initialCategory = searchParams.get("category");

  useEffect(() => {
    if (lastUrlQuery.current === urlQuery) return;
    lastUrlQuery.current = urlQuery;
    setInput(urlQuery);
    setDebouncedQ(urlQuery.trim());
  }, [urlQuery]);

  const trimmed = input.trim();
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(trimmed), SEARCH_DELAY);
    return () => clearTimeout(timer);
  }, [trimmed]);

  useEffect(() => {
    rememberSearch(debouncedQ);
  }, [debouncedQ]);

  // People available as a facet. Cheap, cached, and unrelated to the query.
  const { data: people } = useNamedPeople();

  const selectedPerson = useMemo(
    () => people?.find((p) => p.id === person),
    [people, person],
  );

  const params = useMemo(() => {
    const next = new URLSearchParams();
    if (debouncedQ) next.set("q", debouncedQ);
    if (media !== "all") next.set("media", media);
    if (dates.from) next.set("date_from", dates.from);
    if (dates.to) next.set("date_to", dates.to);
    // Only worth sending when it is not the default, and only meaningful
    // alongside a range.
    if (dates.field === "added" && (dates.from || dates.to)) next.set("date_field", "added");
    if (person) {
      next.set("cluster_id", person);
      next.set("category", selectedPerson?.category || initialCategory || "people");
    }
    return next;
  }, [debouncedQ, media, dates, person, selectedPerson, initialCategory]);

  // Update the address without re-running the route or removing a lightbox link.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("q") !== null && url.searchParams.get("q") !== lastUrlQuery.current) return;
    for (const name of ["q", "media", "date_from", "date_to", "date_field", "cluster_id", "category"]) {
      const value = params.get(name);
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    lastUrlQuery.current = params.get("q") || "";
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [params]);

  const clearFilters = () => {
    setMedia("all");
    setDates({ field: "taken", from: "", to: "" });
    setPerson("");
  };

  const hasFacets = media !== "all" || Boolean(dates.from || dates.to || person);
  // Free text needs a few characters to be meaningful; facets stand on their
  // own, so a filter-only search runs immediately.
  const enabled = trimmed.length >= 2 || hasFacets;
  const settling = trimmed !== debouncedQ;
  const { results, loading, error, retry } = useSearchResults(params.toString(), 100, enabled && !settling, true);
  const searching = enabled && (settling || loading);
  const showResults = enabled && !settling && results.length > 0;

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      results.map((result) => ({
        photo_id: result.photo_id,
        thumb_url: thumbFor(result),
        photo_title: result.photo_title,
        flickr_url: result.flickr_url,
        media_kind: result.media_kind,
        date_taken: result.date_taken,
        duration_seconds: result.duration_seconds,
      })),
    [results],
  );

  const peopleChips = (people ?? []).slice(0, PEOPLE_CHIPS);

  return (
    <>
      <div className="kx-searchhead">
        <span className="kx-eyebrow">Search</span>
        <h1 className="kx-title" style={{ marginBottom: 20 }}>
          Describe it and it comes back.
        </h1>

        <div className="kx-searchfield">
          <SearchIcon size={20} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) setDebouncedQ(trimmed);
            }}
            placeholder="Describe what you are looking for…"
            aria-label="Search your library"
            autoFocus
          />
          {showResults && (
            <span className="kx-mono">
              {fmt.format(results.length)} result{results.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="kx-chiprow" role="group" aria-label="Filters">
          {MEDIA_CHIPS.map((chip) => (
            <button
              key={chip.value}
              className={`kx-chip ${media === chip.value ? "is-active" : ""}`}
              aria-pressed={media === chip.value}
              onClick={() => setMedia(chip.value)}
            >
              {chip.label}
            </button>
          ))}

          {peopleChips.map((candidate) => (
            <button
              key={candidate.id}
              className={`kx-chip ${person === candidate.id ? "is-active" : ""}`}
              aria-pressed={person === candidate.id}
              onClick={() => setPerson(person === candidate.id ? "" : candidate.id)}
            >
              With {candidate.label}
            </button>
          ))}

          {/* Taken versus added has its own control because a bulk import
              gives every file the same added date and none of its real one. */}
          <KxDateFacet
            value={dates}
            onApply={setDates}
            onClear={() => setDates({ field: "taken", from: "", to: "" })}
          />
        </div>
      </div>

      {searching && !showResults && (
        <div style={{ marginTop: 34 }}>
          <KxSkeletonCards count={8} minWidth={210} height={158} />
        </div>
      )}

      {enabled && !settling && error && (
        <p className="kx-status" role="alert">
          {showResults ? "Visual matches are unavailable." : "Search is unavailable."}{" "}
          <button className="kx-chip" onClick={() => void retry()}>Retry</button>
        </p>
      )}

      {enabled && !searching && !error && !showResults && (
        <div style={{ marginTop: 34 }}>
          <KxEmptyResults onClear={clearFilters} />
        </div>
      )}

      {!enabled && (
        <p className="kx-lede" style={{ marginTop: 8 }}>
          Describe what you are looking for — &ldquo;sunset over water&rdquo;, &ldquo;birthday
          cake&rdquo; — or use the filters on their own to browse by person or media type.
        </p>
      )}

      {showResults && (
        <div className="kx-resultgrid">
          {results.map((result) => {
            return (
              <button
                key={result.photo_id}
                className="kx-resultcard"
                onClick={() => openLightbox(result.photo_id, lightboxPhotos)}
                aria-label={result.photo_title || "Open photo"}
              >
                <img src={thumbFor(result)} alt="" loading="lazy" decoding="async" />
                {result.match_type === "person" && result.match_name && (
                  <span className="kx-matchbadge">{result.match_name}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <main className="kx-page">
      <Suspense fallback={<p className="kx-status">Loading search…</p>}>
        <SearchContent />
      </Suspense>
    </main>
  );
}
