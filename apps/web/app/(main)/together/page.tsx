"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { KxPeoplePicker } from "@/components/kx/people-picker";
import { useNamedPeople } from "@/components/kx/use-people";
import { KxEmpty, KxEmptyResults, KxErrorBanner, KxSkeletonGrid } from "@/components/kx/states";
import { tileSpan } from "@/components/kx/photos";

interface TogetherPhoto {
  photo_id: string;
  photo_url: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
}

interface TogetherResponse {
  photos: TogetherPhoto[];
  count: number;
  people_count: number;
}

export default function TogetherPage() {
  return (
    <main className="kx-page">
      <Suspense fallback={<KxSkeletonGrid count={9} />}>
        <TogetherScreen />
      </Suspense>
    </main>
  );
}

/**
 * The intersection: photos where everyone picked appears at once. One person
 * is a valid question too — it is the same pile, just larger.
 */
function TogetherScreen() {
  const searchParams = useSearchParams();
  const { openLightbox } = useLightbox();
  const { data: people } = useNamedPeople();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Arriving from a person's page with them already chosen.
  useEffect(() => {
    const param = searchParams.get("people");
    if (param) setSelected(new Set(param.split(",").filter(Boolean)));
  }, [searchParams]);

  const ids = useMemo(() => Array.from(selected), [selected]);
  const chosen = useMemo(
    () => (people ?? []).filter((person) => selected.has(person.id)),
    [people, selected],
  );

  const { data, error, isPending, refetch } = useQuery<TogetherResponse>({
    queryKey: ["kx-together", ids.join(",")],
    queryFn: async () => {
      const response = await fetch(
        `${BACKEND}/photos/together?people=${encodeURIComponent(ids.join(","))}&limit=200`,
      );
      if (!response.ok) throw new Error("Those photos could not be loaded.");
      return response.json();
    },
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
  });

  const photos = data?.photos ?? [];

  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      photos.map((photo) => ({
        photo_id: photo.photo_id,
        thumb_url: photo.thumb_url || photo.photo_url,
        photo_url: photo.photo_url,
        flickr_url: photo.flickr_url,
        photo_title: photo.photo_title,
      })),
    [photos],
  );

  const remove = (id: string) => {
    const next = new Set(selected);
    next.delete(id);
    setSelected(next);
  };

  return (
    <>
      <span className="kx-eyebrow">Together</span>
      <h1 className="kx-title">Two people, one pile.</h1>
      <p className="kx-lede">Pick anyone and see only the photos where they all appear.</p>

      <div className="kx-togetherbar">
        <span className="kx-eyebrow quiet" style={{ width: "auto" }}>
          Showing
        </span>

        {chosen.map((person) => (
          <button
            key={person.id}
            className="kx-personpill-sel"
            aria-label={`Remove ${person.label}`}
            onClick={() => remove(person.id)}
          >
            {person.avatar && <img src={person.avatar} alt="" />}
            {person.label}
            <span className="kx-mono" aria-hidden="true">
              ×
            </span>
          </button>
        ))}

        <KxPeoplePicker selected={selected} onChange={setSelected} label="Add someone" />

        {/* TODO: "first in 2019" needs the earliest date in the intersection.
            /photos/together returns no dates on its rows, so only the count is
            stated. A `first_seen` field on the response would complete it. */}
        {ids.length > 0 && data && (
          <span className="kx-cardmeta tail">
            {fmt.format(data.count)} {data.count === 1 ? "photo" : "photos"} together
          </span>
        )}
      </div>

      {ids.length === 0 && (
        <KxEmpty
          title="Nobody picked yet."
          body="Choose one person to see everything they are in, or two to see only where they overlap."
        />
      )}

      {ids.length > 0 && error && (
        <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />
      )}
      {ids.length > 0 && !error && isPending && <KxSkeletonGrid count={9} />}
      {ids.length > 0 && !error && !isPending && photos.length === 0 && (
        <KxEmptyResults onClear={() => setSelected(new Set())} />
      )}

      {photos.length > 0 && (
        <div className="kx-daygrid">
          {photos.map((photo, index) => (
            <button
              key={photo.photo_id}
              className={`kx-tile ${tileSpan(index)}`.trim()}
              aria-label={photo.photo_title || "Open photo"}
              onClick={() => openLightbox(photo.photo_id, lightboxPhotos)}
            >
              <img src={photo.thumb_url || photo.photo_url} alt="" loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
