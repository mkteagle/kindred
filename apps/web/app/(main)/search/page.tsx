"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { BACKEND, fmt } from "@/lib/constants";
import type { SearchResult } from "@/types";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { LIBRARY_ICON_PATHS, NavIcon, PlayIcon, SearchIcon } from "@/components/kx/icons";
import { readRecent, rememberSearch } from "@/components/kx/search-overlay";
import { KxEmptyResults, KxSkeletonCards } from "@/components/kx/states";
import { KxDateFacet, type DateField, type DateRange } from "@/components/kx/date-facet";
import { useNamedPeople } from "@/components/kx/use-people";
import { photoThumb } from "@/lib/photo-url";
import { useSearchResults } from "@/lib/use-search-results";
import { ClearSearchButton } from "@/components/kx/clear-search-button";
import { useKxSearch } from "@/components/kx/search-state";
import { useKxUi } from "@/components/kx/ui-state";
import { formatDuration, type LibraryPhoto } from "@/components/kx/photos";
import { searchCaptureMonth } from "@/lib/search-capture-date";

type Media = "all" | "photo" | "video";

const MEDIA_CHIPS: { value: Media; label: string }[] = [
  { value: "all", label: "All" },
  { value: "photo", label: "Photos" },
  { value: "video", label: "Videos" },
];

/** How many people to offer as chips before the list gets unwieldy. */
const PEOPLE_CHIPS = 4;
const EMPTY_DATE: DateRange = { field: "taken", from: "", to: "" };
const CLOCK = "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M12 7v5l3 2";
const CALENDAR = "M3 6h18v15H3z M3 10h18 M8 3v5m8-5v5";

function thisYear(): DateRange {
  const year = new Date().getFullYear();
  return { field: "taken", from: `${year}-01-01`, to: `${year}-12-31` };
}

function thumbFor(result: SearchResult & { media_kind?: string }): string {
  // Videos have no Flickr thumbnail; their poster frame comes off the NAS.
  return result.media_kind === "video"
    ? `${BACKEND}/photos/${result.photo_id}/local?variant=thumb`
    : photoThumb(result);
}

function SearchContent() {
  const searchParams = useSearchParams();
  const { openLightbox } = useLightbox();

  const urlQuery = searchParams.get("q");
  const lastUrlQuery = useRef<string | null | undefined>(urlQuery === null ? null : undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusOnArrival = searchParams.get("focus") === "1";
  const { query: input, debouncedQuery: debouncedQ, setQuery: setInput, commitQuery } = useKxSearch();
  const { searchOpen } = useKxUi();
  const [media, setMedia] = useState<Media>((searchParams.get("media") as Media) || "all");
  const [dates, setDates] = useState<DateRange>({
    field: (searchParams.get("date_field") as DateField) || "taken",
    from: searchParams.get("date_from") || "",
    to: searchParams.get("date_to") || "",
  });
  const [recents, setRecents] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [person, setPerson] = useState(searchParams.get("cluster_id") || "");
  const initialCategory = searchParams.get("category");

  const trimmed = input.trim();

  useEffect(() => { setRecents(readRecent()); }, []);
  useEffect(() => {
    if (focusOnArrival) inputRef.current?.focus({ preventScroll: true });
  }, [focusOnArrival]);
  const month = useMemo(() => searchCaptureMonth(debouncedQ), [debouncedQ]);
  const explicitDates = Boolean(dates.from || dates.to);
  const inferredMonth = explicitDates ? null : month;
  const range = inferredMonth?.range ?? dates;
  const textQuery = month ? "" : debouncedQ;
  const submit = (query: string) => {
    commitQuery(query);
    rememberSearch(query);
    setRecents(readRecent());
  };

  // People available as a facet. Cheap, cached, and unrelated to the query.
  const { data: people } = useNamedPeople();

  const selectedPerson = useMemo(
    () => people?.find((p) => p.id === person),
    [people, person],
  );

  const params = useMemo(() => {
    const next = new URLSearchParams();
    if (textQuery) next.set("q", textQuery);
    if (media !== "all") next.set("media", media);
    if (range.from) next.set("date_from", range.from);
    if (range.to) next.set("date_to", range.to);
    // Only worth sending when it is not the default, and only meaningful
    // alongside a range.
    if (range.field === "added" && (range.from || range.to)) next.set("date_field", "added");
    if (person) {
      next.set("cluster_id", person);
      next.set("category", selectedPerson?.category || initialCategory || "people");
    }
    return next;
  }, [textQuery, media, range, person, selectedPerson, initialCategory]);

  // Update the address without re-running the route or removing a lightbox link.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("q") !== lastUrlQuery.current) return;
    for (const name of ["q", "media", "date_from", "date_to", "date_field", "cluster_id", "category"]) {
      const value = name === "q" ? debouncedQ : (name === "date_from" || name === "date_to") && inferredMonth ? null : params.get(name);
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    lastUrlQuery.current = debouncedQ || null;
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [params, debouncedQ, inferredMonth]);

  useEffect(() => {
    if (lastUrlQuery.current === urlQuery) return;
    lastUrlQuery.current = urlQuery;
    commitQuery(urlQuery ?? "");
  }, [urlQuery, commitQuery]);

  const clearFilters = () => {
    setMedia("all");
    setDates(EMPTY_DATE);
    setPerson("");
    commitQuery("");
  };

  const hasFacets = media !== "all" || Boolean(dates.from || dates.to || person);
  // Free text needs a few characters to be meaningful; facets stand on their
  // own, so a filter-only search runs immediately.
  const enabled = trimmed.length >= 2 || hasFacets;
  const settling = trimmed !== debouncedQ;
  const queryReady = lastUrlQuery.current === urlQuery || urlQuery === input;
  const ready = enabled && !settling && queryReady && !searchOpen;
  const captureBrowse = !textQuery && !person && range.field === "taken" && (media !== "all" || Boolean(range.from || range.to));
  const textResults = useSearchResults(params.toString(), 100, ready && !captureBrowse, true);
  const catalog = useInfiniteQuery<{ photos: LibraryPhoto[]; next_cursor: string | null }>({
    queryKey: ["kx-search-capture", media, range.from, range.to],
    enabled: ready && captureBrowse,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams({ media, limit: "48", sort: "newest" });
      if (range.from) query.set("date_from", range.from);
      if (range.to) query.set("date_to", range.to);
      if (pageParam) query.set("cursor", pageParam as string);
      const response = await fetch(`${BACKEND}/library/photos?${query}`, { signal });
      if (!response.ok) throw new Error("Search is unavailable");
      return response.json();
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    staleTime: 60_000,
    retry: false,
  });
  const catalogResults = useMemo<SearchResult[]>(() => (catalog.data?.pages.flatMap(page => page.photos) ?? []).map(photo => ({
    ...photo, flickr_url: photo.flickr_url ?? "", photo_url: "", thumb_url: "", owner: "", distance: 0,
  })), [catalog.data]);
  const results = captureBrowse ? catalogResults : textResults.results;
  const error = captureBrowse ? catalog.isError : textResults.error;
  const retry = captureBrowse ? catalog.refetch : textResults.retry;
  const searching = enabled && (settling || !queryReady || (captureBrowse ? catalog.isLoading : textResults.loading));
  const showResults = ready && results.length > 0;
  useEffect(() => {
    if (ready && !searching && !error && debouncedQ) {
      rememberSearch(debouncedQ);
      setRecents(readRecent());
    }
  }, [ready, searching, error, debouncedQ]);

  const groups = useMemo(() => {
    const byDay = new Map<string, SearchResult[]>();
    if (!captureBrowse) return [["", results] as const];
    for (const result of results) {
      const date = result.date_taken?.slice(0, 10) ?? "";
      const rows = byDay.get(date);
      if (rows) rows.push(result);
      else byDay.set(date, [result]);
    }
    return Array.from(byDay);
  }, [captureBrowse, results]);

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
        <h1 className="kx-title">Search</h1>
        <div className="kx-searchfield">
          <SearchIcon size={22} />
          <input
            id="kx-library-search"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) submit(input);
            }}
            placeholder="Search your library"
            aria-label="Search your library"
          />
          {input ? <ClearSearchButton onClear={() => {
            commitQuery("");
            inputRef.current?.focus();
          }} /> : <kbd className="kx-kbd">⌘ / Ctrl K</kbd>}
        </div>
      </div>

      {!enabled && <>
        {recents.length > 0 && <section className="kx-search-start">
          <h2>Recent searches</h2>
          <div className="kx-chiprow">
            {recents.map(term => <button className="kx-chip withface" key={term} onClick={() => submit(term)}>
              <NavIcon d={CLOCK} size={18} /> {term}
            </button>)}
          </div>
        </section>}
        <section className="kx-search-start">
          <h2>Browse</h2>
          <button className="kx-browse-row" onClick={() => setMedia("photo")}><NavIcon d={LIBRARY_ICON_PATHS.allPhotos} /> All photos <span aria-hidden="true">›</span></button>
          <button className="kx-browse-row" onClick={() => setMedia("video")}><NavIcon d={LIBRARY_ICON_PATHS.videos} /> Videos <span aria-hidden="true">›</span></button>
          <button className="kx-browse-row" onClick={() => setDates(thisYear())}><NavIcon d={CALENDAR} /> This year <span aria-hidden="true">›</span></button>
          <button className="kx-chip" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>Filters</button>
        </section>
      </>}

      {enabled && <div className="kx-chiprow kx-search-filters" role="group" aria-label="Filters">
        {inferredMonth && <button className="kx-chip withface is-active" onClick={() => commitQuery("")} aria-label={`Remove ${inferredMonth.label} capture date filter`}>
          <NavIcon d={CALENDAR} size={16} /> Taken in {inferredMonth.label} <span aria-hidden="true">×</span>
        </button>}
        {MEDIA_CHIPS.map(chip => <button
          key={chip.value}
          className={`kx-chip ${media === chip.value ? "is-active" : ""}`}
          aria-pressed={media === chip.value}
          onClick={() => setMedia(chip.value)}
        >{chip.label}</button>)}
        <button className="kx-chip kx-more-search-filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>Filters</button>
      </div>}

      {(filtersOpen || explicitDates || person) && <div className="kx-chiprow kx-search-facets">
        <KxDateFacet value={range} onApply={setDates} onClear={() => {
          setDates(EMPTY_DATE);
          if (month) commitQuery("");
        }} />
        {(filtersOpen || person) && [
          ...peopleChips,
          ...(selectedPerson && !peopleChips.includes(selectedPerson) ? [selectedPerson] : []),
        ].map(candidate => <button
          key={candidate.id}
          className={`kx-chip ${person === candidate.id ? "is-active" : ""}`}
          aria-pressed={person === candidate.id}
          onClick={() => setPerson(person === candidate.id ? "" : candidate.id)}
        >With {candidate.label}</button>)}
      </div>}

      {searching && !showResults && <KxSkeletonCards count={8} minWidth={170} height={178} />}
      {enabled && !settling && error && <p className="kx-status" role="alert">
        {showResults ? "Some results could not load." : "Search is unavailable."}{" "}
        <button className="kx-chip" onClick={() => void retry()}>Retry</button>
      </p>}
      {enabled && !searching && !error && !showResults && !searchOpen && <KxEmptyResults onClear={clearFilters} />}

      {showResults && <>
        <p className="kx-search-count" role="status">
          {fmt.format(results.length)}{(captureBrowse ? catalog.hasNextPage : results.length >= 100) ? "+" : ""} {results.length === 1 ? "result" : "results"}
        </p>
        {groups.map(([day, items]) => <section key={day} className="kx-search-results-group">
          {day && <h2>{new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(day))}</h2>}
          <div className="kx-resultgrid">
            {items.map(result => <button
              key={result.photo_id}
              className="kx-resultcard"
              onClick={() => openLightbox(result.photo_id, lightboxPhotos)}
              aria-label={result.photo_title || (result.media_kind === "video" ? "Open video" : "Open photo")}
            >
              <img src={thumbFor(result)} alt="" loading="lazy" decoding="async" />
              {result.media_kind === "video" && <span className="kx-tile-video"><PlayIcon size={10} />{formatDuration(result.duration_seconds) ?? "Video"}</span>}
              {result.match_type === "person" && result.match_name && <span className="kx-matchbadge">{result.match_name}</span>}
            </button>)}
          </div>
        </section>)}
        {captureBrowse && catalog.hasNextPage && <button className="kx-button" disabled={catalog.isFetchingNextPage} onClick={() => void catalog.fetchNextPage()}>
          {catalog.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>}
      </>}
    </>
  );
}

export default function SearchPage() {
  return (
    <main className="kx-page kx-search-page">
      <Suspense fallback={<p className="kx-status">Loading search…</p>}>
        <SearchContent />
      </Suspense>
    </main>
  );
}
