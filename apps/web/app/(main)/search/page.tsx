"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { BACKEND, fmt } from "@/lib/constants";
import type { SearchResult } from "@/types";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { SearchIcon } from "@/components/kx/icons";
import { rememberSearch } from "@/components/kx/search-overlay";
import { KxEmptyResults, KxSkeletonCards } from "@/components/kx/states";
import { KxDateFacet, type DateField, type DateRange } from "@/components/kx/date-facet";
import { useNamedPeople } from "@/components/kx/use-people";
import { photoThumb } from "@/lib/photo-url";

type Media = "all" | "photo" | "video";

interface SearchResponse {
  results: SearchResult[];
  query: string;
}

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
  const router = useRouter();
  const { openLightbox } = useLightbox();

  const [input, setInput] = useState(searchParams.get("q") || "");
  const [debouncedQ, setDebouncedQ] = useState(searchParams.get("q") || "");
  const [media, setMedia] = useState<Media>((searchParams.get("media") as Media) || "all");
  const [dates, setDates] = useState<DateRange>({
    field: (searchParams.get("date_field") as DateField) || "taken",
    from: searchParams.get("date_from") || "",
    to: searchParams.get("date_to") || "",
  });
  const [person, setPerson] = useState(searchParams.get("cluster_id") || "");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

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
    if (person && selectedPerson) {
      next.set("cluster_id", person);
      next.set("category", selectedPerson.category);
    }
    return next;
  }, [debouncedQ, media, dates, person, selectedPerson]);

  // Keep the URL shareable and reloadable.
  useEffect(() => {
    const qs = params.toString();
    router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
  }, [params, router]);

  const clearFilters = () => {
    setMedia("all");
    setDates({ field: "taken", from: "", to: "" });
    setPerson("");
  };

  const hasFacets = media !== "all" || Boolean(dates.from || dates.to || person);
  // Free text needs a few characters to be meaningful; facets stand on their
  // own, so a filter-only search runs immediately.
  const enabled = debouncedQ.length > 2 || hasFacets;

  const { data, isLoading } = useQuery<SearchResponse>({
    queryKey: ["kx-search-page", params.toString()],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/search?${params.toString()}&limit=100`);
      if (!response.ok) throw new Error("Search failed");
      return response.json();
    },
    enabled,
  });

  const results = useMemo(() => data?.results ?? [], [data]);

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      results.map((result) => ({
        photo_id: result.photo_id,
        thumb_url: thumbFor(result),
        photo_title: result.photo_title,
        flickr_url: result.flickr_url,
        photo_url: result.photo_url,
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
            placeholder="Describe what you are looking for…"
            aria-label="Search your library"
            autoFocus
          />
          {enabled && !isLoading && (
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

      {enabled && isLoading && (
        <div style={{ marginTop: 34 }}>
          <KxSkeletonCards count={8} minWidth={210} height={158} />
        </div>
      )}

      {enabled && !isLoading && results.length === 0 && (
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

      {results.length > 0 && (
        <div className="kx-resultgrid">
          {results.map((result) => {
            const visual = result.match_type === "visual" && typeof result.distance === "number";
            return (
              <button
                key={result.photo_id}
                className="kx-resultcard"
                onClick={() => openLightbox(result.photo_id, lightboxPhotos)}
                aria-label={result.photo_title || "Open photo"}
              >
                <img src={thumbFor(result)} alt="" loading="lazy" />
                {visual && (
                  <span className="kx-matchbadge">{Math.round((1 - result.distance) * 100)}% match</span>
                )}
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
