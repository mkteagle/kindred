"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { KxEmpty, KxErrorBanner, KxSkeletonCards, KxSkeletonGrid } from "@/components/kx/states";

interface ObjectPhoto {
  photo_id: string;
  distance: number;
  photo_url: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
}

interface ObjectsResponse {
  objects: Record<string, ObjectPhoto[]>;
}

type Sort = "most" | "az" | "new";

const SORTS: { id: Sort; label: string }[] = [
  { id: "most", label: "Most photos" },
  { id: "az", label: "A – Z" },
  { id: "new", label: "New this month" },
];

export default function ObjectsPage() {
  const { openLightbox } = useLightbox();
  const [sort, setSort] = useState<Sort>("most");
  const [open, setOpen] = useState<string | null>(null);

  const { data, error, isPending, refetch } = useQuery<ObjectsResponse>({
    queryKey: ["kx-objects"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/objects`);
      if (!response.ok) throw new Error("Your objects could not be loaded.");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const entries = useMemo(() => {
    const rows = Object.entries(data?.objects ?? {});
    if (sort === "az") return rows.sort((a, b) => a[0].localeCompare(b[0]));
    // TODO: "new this month" needs a first-seen date per object. /objects
    // returns label → photos and nothing else, so this chip currently orders
    // by count like the first. A `first_seen` field per label would fix it.
    return rows.sort((a, b) => b[1].length - a[1].length);
  }, [data, sort]);

  const current = open ? (data?.objects?.[open] ?? []) : [];

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      current.map((photo) => ({
        photo_id: photo.photo_id,
        thumb_url: photo.thumb_url || photo.photo_url,
        photo_url: photo.photo_url,
        flickr_url: photo.flickr_url,
        photo_title: photo.photo_title,
      })),
    [current],
  );

  return (
    <main className="kx-page">
      <span className="kx-eyebrow">Objects</span>
      <h1 className="kx-title">The things in the frame.</h1>
      <p className="kx-lede">
        Worked out on your server, never sent anywhere. Handy for the specific: the guitar, the
        tent, the birthday cake.
      </p>

      <div className="kx-chiprow" role="group" aria-label="Sort objects">
        {SORTS.map((option) => (
          <button
            key={option.id}
            className={`kx-chip ${sort === option.id ? "is-active" : ""}`}
            aria-pressed={sort === option.id}
            onClick={() => setSort(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
      {!error && isPending && <KxSkeletonCards count={8} minWidth={180} height={170} />}
      {!error && !isPending && entries.length === 0 && (
        <KxEmpty
          title="Nothing here yet."
          body="Objects appear once the library has been through a scan. The next one will fill this in."
        />
      )}

      {entries.length > 0 && (
        <div className="kx-objectgrid">
          {entries.map(([label, photos]) => (
            <button
              key={label}
              className={`kx-card-lift kx-objectcard ${open === label ? "is-active" : ""}`.trim()}
              aria-pressed={open === label}
              aria-expanded={open === label}
              onClick={() => setOpen(open === label ? null : label)}
            >
              {photos[0] && (
                <img src={photos[0].thumb_url || photos[0].photo_url} alt="" loading="lazy" />
              )}
              <span className="kx-objectcard-body">
                <strong>{label}</strong>
                <span className="kx-cardmeta">{fmt.format(photos.length)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {open && (
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
          {current.length === 0 ? (
            <KxSkeletonGrid count={6} tile={150} />
          ) : (
            <div className="kx-daygrid" style={{ ["--tile" as string]: "150px" }}>
              {current.map((photo) => (
                <button
                  key={photo.photo_id}
                  className="kx-tile"
                  aria-label={photo.photo_title || "Open photo"}
                  onClick={() => openLightbox(photo.photo_id, lightboxPhotos)}
                >
                  <img
                    src={photo.thumb_url || photo.photo_url}
                    alt=""
                    loading="lazy"
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
