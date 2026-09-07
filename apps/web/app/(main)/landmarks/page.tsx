"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import type { ScenesResponse } from "@/types";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { KxEmpty, KxErrorBanner, KxSkeletonCards } from "@/components/kx/states";
import { photoThumb } from "@/lib/photo-url";

export default function LandmarksPage() {
  const { openLightbox } = useLightbox();
  const [open, setOpen] = useState<string | null>(null);

  const { data, error, isPending, refetch } = useQuery<ScenesResponse>({
    queryKey: ["kx-scenes"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/scenes`);
      if (!response.ok) throw new Error("Your landmarks could not be loaded.");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const scenes = useMemo(
    () =>
      Object.entries(data?.scenes ?? {}).sort((a, b) => b[1].length - a[1].length),
    [data],
  );

  const current = open ? (data?.scenes?.[open] ?? []) : [];

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      current.map((photo) => ({
        photo_id: photo.photo_id,
        thumb_url: photoThumb(photo),
        photo_url: photo.photo_url,
        flickr_url: photo.flickr_url,
        photo_title: photo.photo_title,
      })),
    [current],
  );

  return (
    <main className="kx-page">
      <span className="kx-eyebrow">Landmarks</span>
      <h1 className="kx-title">Places that name themselves.</h1>
      <p className="kx-lede">
        Landmarks and scenes, separate from GPS places — the same bridge from three different trips
        lands in one group.
      </p>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
      {!error && isPending && <KxSkeletonCards count={6} minWidth={280} height={190} />}
      {!error && !isPending && scenes.length === 0 && (
        <KxEmpty
          title="Nothing here yet."
          body="Landmarks appear once the library has been through a scan. The next one will fill this in."
        />
      )}

      {scenes.length > 0 && (
        <div className="kx-landmarkgrid">
          {scenes.map(([label, photos]) => (
            <button
              key={label}
              className="kx-card-lift kx-landmarkcard"
              aria-pressed={open === label}
              onClick={() => setOpen(open === label ? null : label)}
            >
              <span className="kx-landmarkcard-media">
                {photos[0] && (
                  <img src={photoThumb(photos[0])} alt="" loading="lazy" />
                )}
                <span className="kx-landmarkcard-scrim" />
                <span className="kx-landmarkcard-copy">
                  <strong>{label}</strong>
                  {/* TODO: the design's "318 photos · 3 trips · 2022 – 2026"
                      needs trip grouping and a date span per landmark. /scenes
                      returns label → photos with a distance and no dates, so
                      only the count is stated. */}
                  <span className="kx-cardmeta">
                    {fmt.format(photos.length)} {photos.length === 1 ? "photo" : "photos"}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {open && current.length > 0 && (
        <>
          <div className="kx-chiprow" style={{ marginTop: 30 }}>
            <span className="kx-eyebrow quiet" style={{ width: "auto", alignSelf: "center" }}>
              {open}
            </span>
            <span className="kx-cardmeta" style={{ alignSelf: "center" }}>
              {fmt.format(current.length)} {current.length === 1 ? "photo" : "photos"}
            </span>
            <button className="kx-chip" style={{ marginLeft: "auto" }} onClick={() => setOpen(null)}>
              Clear
            </button>
          </div>
          <div className="kx-daygrid" style={{ ["--tile" as string]: "150px" }}>
            {current.map((photo) => (
              <button
                key={photo.photo_id}
                className="kx-tile"
                aria-label={photo.photo_title || "Open photo"}
                onClick={() => openLightbox(photo.photo_id, lightboxPhotos)}
              >
                <img
                  src={photoThumb(photo)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
