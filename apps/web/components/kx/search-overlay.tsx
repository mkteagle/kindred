"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import type { SearchResult } from "@/types";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { SearchIcon } from "./icons";

interface SearchResponse {
  results: SearchResult[];
  query: string;
}

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
  if (trimmed.length < 3) return;
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
    : result.thumb_url || result.photo_url || `${BACKEND}/photos/${result.photo_id}/image?size=n`;
}

/**
 * The ⌘K overlay. Below three characters it offers somewhere to start; above
 * it, the people it matched, a square-thumb grid, and a way through to the
 * full search screen.
 */
export function KxSearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const { openLightbox } = useLightbox();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    inputRef.current?.focus();
    setRecent(readRecent());
  }, []);

  // 300ms, as the rest of the app already does.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const live = debounced.length > 2;

  const { data, isLoading } = useQuery<SearchResponse>({
    queryKey: ["kx-search-overlay", debounced],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/search?q=${encodeURIComponent(debounced)}&limit=12`);
      if (!response.ok) throw new Error("Search failed");
      return response.json();
    },
    enabled: live,
  });

  const results = useMemo(() => data?.results ?? [], [data]);

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
        photo_url: result.photo_url,
      })),
    [results],
  );

  const goToResults = () => {
    rememberSearch(debounced);
    onClose();
    router.push(`/search?q=${encodeURIComponent(debounced)}`);
  };

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
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && live) goToResults();
            }}
            placeholder="Search people, places, or things…"
            aria-label="Search your library"
          />
          <kbd className="kx-kbd">esc</kbd>
        </div>

        <div className="kx-searchdialog-body">
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

          {live && isLoading && <p className="kx-status" role="status">Searching…</p>}

          {live && !isLoading && results.length === 0 && (
            <p className="kx-status">Nothing found for &ldquo;{debounced}&rdquo;.</p>
          )}

          {live && results.length > 0 && (
            <>
              {people.length > 0 && (
                <div className="kx-suggestgroup-row">
                  {people.map((person) => (
                    <Link
                      key={person.name}
                      href={person.clusterId ? `/${person.category}/${person.clusterId}` : "/people"}
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
                    <img src={thumbFor(result)} alt="" loading="lazy" />
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
