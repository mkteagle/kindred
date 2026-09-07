"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import type { SearchResult } from "@/types";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { KxEmpty, KxErrorBanner, KxSkeletonGrid } from "@/components/kx/states";
import { photoThumb } from "@/lib/photo-url";

/**
 * The six the design names, in the palette's own language rather than a paint
 * chart's. Every one of them is a colour a household actually remembers: the
 * fire, the lamp, the trees, the hour after sunset, the wall, the dark.
 */
const SWATCHES = [
  { name: "Ember red", hex: "c04b2a" },
  { name: "Amber", hex: "d59851" },
  { name: "Forest", hex: "495645" },
  { name: "Dusk blue", hex: "3f5f7a" },
  { name: "Bone", hex: "e4ded0" },
  { name: "Near black", hex: "1d1f1c" },
];

/** How close a photo's dominant colour has to be. Higher is looser. */
const THRESHOLD = 50;

export default function ColorsPage() {
  const { openLightbox } = useLightbox();
  const [active, setActive] = useState(SWATCHES[0]);

  const { data, error, isPending, refetch } = useQuery<SearchResult[]>({
    queryKey: ["kx-color-search", active.hex],
    queryFn: async () => {
      const response = await fetch(
        `${BACKEND}/search/color?hex=${active.hex}&threshold=${THRESHOLD}`,
      );
      if (!response.ok) throw new Error("That colour could not be searched.");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const results = useMemo(() => data ?? [], [data]);

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      results.map((result) => ({
        photo_id: result.photo_id,
        thumb_url: photoThumb(result),
        photo_url: result.photo_url,
        flickr_url: result.flickr_url,
        photo_title: result.photo_title,
      })),
    [results],
  );

  return (
    <main className="kx-page">
      <span className="kx-eyebrow">Colors</span>
      <h1 className="kx-title">Browse by what it looked like.</h1>
      <p className="kx-lede">
        Dominant colour is worked out per photo on your server. Useful when you remember the red
        door but not the year.
      </p>

      {/* TODO: the design puts a count on each swatch. Nothing tallies photos
          per colour without running the search — /search/color answers one hex
          at a time — so the counts are left off rather than fetched six times
          on load. A `GET /colors` returning name, hex and count would fix it. */}
      <div className="kx-swatchgrid">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch.hex}
            className={`kx-card-lift kx-swatchcard ${active.hex === swatch.hex ? "is-active" : ""}`.trim()}
            aria-pressed={active.hex === swatch.hex}
            onClick={() => setActive(swatch)}
          >
            <span className="kx-swatchblock" style={{ background: `#${swatch.hex}` }} />
            <span className="kx-swatchcard-body">
              <strong>{swatch.name}</strong>
              <span className="kx-cardmeta">
                {active.hex === swatch.hex && !isPending && !error
                  ? `${fmt.format(results.length)} photos`
                  : `#${swatch.hex}`}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="kx-chiprow" style={{ marginBottom: 12 }}>
        <span className="kx-eyebrow quiet" style={{ width: "auto", alignSelf: "center" }}>
          {active.name}
        </span>
        {!isPending && !error && (
          <span className="kx-cardmeta" style={{ alignSelf: "center" }}>
            {fmt.format(results.length)} {results.length === 1 ? "photo" : "photos"} · sorted by how
            much of the frame
          </span>
        )}
      </div>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
      {!error && isPending && <KxSkeletonGrid count={12} tile={150} />}
      {!error && !isPending && results.length === 0 && (
        <KxEmpty
          title="Nothing in that colour."
          body="No photo in the library is mostly this colour yet. Try another swatch."
        />
      )}

      {results.length > 0 && (
        <div className="kx-daygrid" style={{ ["--tile" as string]: "150px" }}>
          {results.map((result) => (
            <button
              key={result.photo_id}
              className="kx-tile"
              aria-label={result.photo_title || "Open photo"}
              onClick={() => openLightbox(result.photo_id, lightboxPhotos)}
            >
              <img
                src={photoThumb(result)}
                alt=""
                loading="lazy"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
