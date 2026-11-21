"use client";

import { OptimizedPhoto } from "@/components/optimized-photo";
import { photoImageUrl } from "@/lib/image-delivery";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BACKEND, fmt } from "@/lib/constants";
import type { SearchResult } from "@/types";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { useSearchResults } from "@/lib/use-search-results";
import { SearchIcon } from "./icons";
import { useKxSearch } from "./search-state";
import { ClearSearchButton } from "./clear-search-button";

const SUGGESTIONS = [
  "marshmallows by the fire",
  "birthday party",
  "the van at night",
  "mountains",
];

const RECENT_KEY = "kindred-recent-searches";
const RECENT_LIMIT = 4;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return;
  try {
    const next = [trimmed, ...readRecent().filter((item) => item !== trimmed)].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

/** Videos have no Flickr thumbnail; their poster frame comes off the NAS. */
function thumbFor(result: SearchResult & { media_kind?: string }): string {
  return result.media_kind === "video"
    ? `${BACKEND}/photos/${result.photo_id}/local?variant=thumb`
    : photoImageUrl(result.photo_id, 320);
}

/**
 * The shell keeps this mounted so opening the overlay restores its last search.
 */
export function KxSearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const { openLightbox } = useLightbox();
  const { query, debouncedQuery: debounced, setQuery, commitQuery } = useKxSearch();
  const [recent, setRecent] = useState<string[]>([]);

  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (bodyRef.current) bodyRef.current.scrollTop = scrollTop.current;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
  }, [open]);

  const trimmed = query.trim();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const live = trimmed.length >= 2;
  const settling = trimmed !== debounced;
  const params = new URLSearchParams({ q: debounced }).toString();
  const { results, loading, error, retry } = useSearchResults(params, 12, open && live && !settling, false);

  /** One pill per matched person, with how many of the results are theirs. */
  const people = useMemo(() => {
    const byName = new Map<string, { name: string; count: number; clusterId?: string; category: string }>();
    for (const result of results) {
      if (result.match_type !== "person" || !result.match_name) continue;
      const existing = byName.get(result.match_name);
      if (existing) existing.count += 1;
      else
        byName.set(result.match_name, {
          name: result.match_name,
          count: 1,
          clusterId: result.match_cluster_id,
          category: result.match_category || "people",
        });
    }
    return Array.from(byName.values());
  }, [results]);

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

  const goToResults = () => {
    commitQuery(query);
    rememberSearch(trimmed);
    onClose();
    router.push(`/search?${new URLSearchParams({ q: trimmed })}`);
  };

  if (!open) return null;

  return (
    <div
      className="kx-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="kx-dialog">
        <div className="kx-searchdialog-head">
          <SearchIcon size={20} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              scrollTop.current = 0;
              if (bodyRef.current) bodyRef.current.scrollTop = 0;
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && live) goToResults();
            }}
            placeholder="Search people, places, or things…"
            aria-label="Search your library"
          />
          {query && <ClearSearchButton onClear={() => {
            scrollTop.current = 0;
            if (bodyRef.current) bodyRef.current.scrollTop = 0;
            commitQuery("");
            inputRef.current?.focus();
          }} />}
          <kbd className="kx-kbd">esc</kbd>
        </div>

        <div className="kx-searchdialog-body" ref={bodyRef} onScroll={(e) => { scrollTop.current = e.currentTarget.scrollTop; }}>
          {!live && (
            <>
              <div className="kx-suggestgroup">
                <span className="kx-eyebrow quiet">Try</span>
                <div className="kx-suggestgroup-row">
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion} className="kx-chip" onClick={() => setQuery(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
              {recent.length > 0 && (
                <div className="kx-suggestgroup">
                  <span className="kx-eyebrow quiet">Recent</span>
                  <div className="kx-suggestgroup-row">
                    {recent.map((item) => (
                      <button key={item} className="kx-chip" onClick={() => setQuery(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {live && (settling || loading) && <p className="kx-status" role="status">Searching…</p>}

          {live && !settling && error && (
            <p className="kx-status" role="alert">Search is unavailable. <button className="kx-chip" onClick={() => void retry()}>Retry</button></p>
          )}

          {live && !settling && !loading && !error && results.length === 0 && (
            <p className="kx-status">Nothing found for &ldquo;{debounced}&rdquo;.</p>
          )}

          {live && !settling && results.length > 0 && (
            <>
              {people.length > 0 && (
                <div className="kx-suggestgroup-row">
                  {people.map((person) => (
                    <Link
                      key={person.name}
                      href={person.clusterId ? `/${person.category}/${person.clusterId}` : "/people"}
                      prefetch={false}
                      className="kx-personpill"
                      onClick={onClose}
                    >
                      <span className="kx-avatar sm">{person.name.charAt(0).toUpperCase()}</span>
                      {person.name}
                      <span className="kx-mono">{fmt.format(person.count)}</span>
                    </Link>
                  ))}
                </div>
              )}

              <div className="kx-thumbgrid">
                {results.map((result) => (
                  <button
                    key={result.photo_id}
                    onClick={() => {
                      rememberSearch(debounced);
                      onClose();
                      openLightbox(result.photo_id, lightboxPhotos);
                    }}
                    aria-label={result.photo_title || "Open photo"}
                  >
                    <OptimizedPhoto photoId={result.photo_id} video={result.media_kind === "video"} />
                  </button>
                ))}
              </div>

              <button className="kx-seeall" onClick={goToResults}>
                See all results &rarr;
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
