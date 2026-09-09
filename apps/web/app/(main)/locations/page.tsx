"use client";

import { OptimizedPhoto } from "@/components/optimized-photo";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import type { LocationGroup, LocationsResponse } from "@/types";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { KxEmpty, KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";
import { tileSpan } from "@/components/kx/photos";
import { photoThumb } from "@/lib/photo-url";

// Leaflet touches window on import, so it stays out of the server render.
const LocationMap = dynamic(() => import("./map"), { ssr: false });

export default function LocationsPage() {
  const { openLightbox } = useLightbox();
  const [active, setActive] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const { data, error, isPending, refetch } = useQuery<LocationsResponse>({
    queryKey: ["kx-locations"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/locations`);
      if (!response.ok) throw new Error("Your places could not be loaded.");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const places = useMemo<LocationGroup[]>(
    () => (data?.locations ?? []).slice().sort((a, b) => b.count - a.count),
    [data],
  );

  const mapped = useMemo(() => places.filter((place) => place.lat && place.lng), [places]);

  const current = active ? places.find((place) => place.name === active) ?? null : null;

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      (current?.photos ?? []).map((photo) => ({
        photo_id: photo.photo_id,
        thumb_url: photo.thumb_url,
        flickr_url: photo.flickr_url,
        photo_title: photo.photo_title,
      })),
    [current],
  );

  return (
    <main className="kx-page">
      <span className="kx-eyebrow">Locations</span>
      <h1 className="kx-title">Where it all happened.</h1>
      <p className="kx-lede">
        Places come from the GPS in each photo, resolved to a name once and cached. Pins cluster as
        you zoom out.
      </p>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
      {!error && isPending && <KxSkeletonRows count={6} height={64} />}
      {!error && !isPending && places.length === 0 && (
        <KxEmpty
          title="Nothing here yet."
          body="Places come from the GPS a camera writes into each photo. Once the library carries that, they appear here."
        />
      )}

      {places.length > 0 && (
        <div className="kx-locations">
          <div className="kx-mappane">
            {mapped.length > 0 ? (
              <LocationMap
                locations={mapped}
                selectedLocation={hovered ?? active}
                onSelect={setActive}
              />
            ) : (
              <KxEmpty
                title="No pins yet."
                body="None of these places carry coordinates, so there is nothing to put on a map."
              />
            )}
          </div>

          <div className="kx-card">
            <div className="kx-cardhead">
              <h2>Places</h2>
              <span className="kx-mono">{fmt.format(places.length)}</span>
            </div>
            {places.map((place) => (
              <button
                key={place.name}
                className={`kx-placerow ${active === place.name ? "is-active" : ""}`.trim()}
                // Hovering a row lights its pin; clicking it filters the grid
                // below. Two different commitments, two different gestures.
                onMouseEnter={() => setHovered(place.name)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(place.name)}
                onBlur={() => setHovered(null)}
                onClick={() => setActive(active === place.name ? null : place.name)}
                aria-pressed={active === place.name}
              >
                {place.photos[0]?.thumb_url && (
                  <img src={photoThumb(place.photos[0])} alt="" loading="lazy" />
                )}
                <span className="kx-placerow-body">
                  <strong>{place.name}</strong>
                  {/* TODO: the design's "2019 – 2026 · 7 visits" needs a date
                      span and a visit count per place. /locations returns
                      neither — its rows carry a name, a count and coordinates
                      — so only what is known is shown. */}
                  <span className="kx-cardmeta">
                    {place.lat && place.lng
                      ? `${place.lat.toFixed(2)}, ${place.lng.toFixed(2)}`
                      : "No coordinates"}
                  </span>
                </span>
                <span className="kx-cardmeta tail">{fmt.format(place.count)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {current && (
        <>
          <div className="kx-chiprow" style={{ marginTop: 30 }}>
            <span className="kx-eyebrow quiet" style={{ width: "auto", alignSelf: "center" }}>
              {current.name}
            </span>
            <span className="kx-cardmeta" style={{ alignSelf: "center" }}>
              {fmt.format(current.count)} {current.count === 1 ? "photo" : "photos"}
            </span>
            <button className="kx-chip" style={{ marginLeft: "auto" }} onClick={() => setActive(null)}>
              Clear
            </button>
          </div>
          <div className="kx-daygrid">
            {current.photos.map((photo, index) => (
              <button
                key={photo.photo_id}
                className={`kx-tile ${tileSpan(index)}`.trim()}
                aria-label={photo.photo_title || "Open photo"}
                onClick={() => openLightbox(photo.photo_id, lightboxPhotos)}
              >
                <OptimizedPhoto photoId={photo.photo_id} />
              </button>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
