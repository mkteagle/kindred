"use client";

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import type { DuplicatesResponse } from "@/types";
import { useUser } from "@/lib/use-user";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { KxEmpty, KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";
import { photoThumb } from "@/lib/photo-url";

/**
 * Two passes over the same index. "Exact" is a distance tight enough that the
 * frames are the same file or the same instant; "near" opens it up to a burst
 * or a second try at the same shot.
 */
const TABS = [
  { id: "exact" as const, label: "Exact matches", threshold: 0.02 },
  { id: "near" as const, label: "Near matches", threshold: 0.1 },
];

type TabId = (typeof TABS)[number]["id"];

export default function DuplicatesPage() {
  const { isAdmin, isLoading } = useUser();
  const { openLightbox } = useLightbox();
  const [tab, setTab] = useState<TabId>("exact");
  const [kept, setKept] = useState<Set<number>>(() => new Set());

  const queries = useQueries({
    queries: TABS.map((entry) => ({
      queryKey: ["kx-duplicates", entry.threshold],
      queryFn: async () => {
        const response = await fetch(`${BACKEND}/duplicates?threshold=${entry.threshold}`);
        if (!response.ok) throw new Error("Duplicates could not be loaded.");
        return (await response.json()) as DuplicatesResponse;
      },
      staleTime: 5 * 60 * 1000,
      enabled: isAdmin,
    })),
  });

  const activeIndex = TABS.findIndex((entry) => entry.id === tab);
  const active = queries[activeIndex];
  const groups = useMemo(
    () => (active?.data?.groups ?? []).filter((_, index) => !kept.has(index)),
    [active?.data, kept],
  );

  if (isLoading) return <main className="kx-page" />;

  if (!isAdmin) {
    return (
      <main className="kx-page" style={{ maxWidth: 1080 }}>
        <span className="kx-eyebrow">Duplicates</span>
        <h1 className="kx-title">The same moment, twice.</h1>
        <KxEmpty
          title="Admins only."
          body="Deciding what to keep changes the library for everyone in the house, so it is kept to the people who own it."
          action={{ label: "Browse the library", href: "/gallery", primary: true }}
        />
      </main>
    );
  }

  return (
    <main className="kx-page" style={{ maxWidth: 1080 }}>
      <span className="kx-eyebrow">Duplicates</span>
      <h1 className="kx-title">The same moment, twice.</h1>
      <p className="kx-lede">
        Near-identical frames found by hash and by look. Nothing is deleted until you say so —
        admins only.
      </p>

      <div className="kx-chiprow" role="group" aria-label="Which duplicates">
        {TABS.map((entry, index) => {
          const count = queries[index]?.data?.groups?.length;
          return (
            <button
              key={entry.id}
              className={`kx-chip ${tab === entry.id ? "is-active" : ""}`}
              aria-pressed={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {count !== undefined ? ` · ${fmt.format(count)}` : ""}
            </button>
          );
        })}
        {/* TODO: the design puts "4.2 GB could come back" beside the tabs.
            /duplicates returns no file sizes, so there is nothing to total. A
            `bytes` field per photo on the response would give the figure. */}
      </div>

      {active?.error && (
        <KxErrorBanner
          detail={(active.error as Error).message}
          onRetry={() => void active.refetch()}
        />
      )}
      {!active?.error && active?.isPending && <KxSkeletonRows count={4} height={110} />}
      {!active?.error && !active?.isPending && groups.length === 0 && (
        <KxEmpty
          title="Nothing doubled up."
          body="No near-identical frames at this closeness. Try the looser pass."
          action={{ label: "Near matches", onClick: () => setTab("near") }}
        />
      )}

      {groups.length > 0 && (
        <section className="kx-card">
          {(active?.data?.groups ?? []).map((group, index) => {
            if (kept.has(index)) return null;
            const lightboxPhotos: LightboxPhoto[] = group.photos.map((photo) => ({
              photo_id: photo.photo_id,
              thumb_url: photoThumb(photo),
              photo_url: photo.photo_url,
              flickr_url: photo.flickr_url,
            }));
            return (
              <div className="kx-duprow" key={`${group.photos[0]?.photo_id}-${index}`}>
                <span className="kx-duppair">
                  {group.photos.slice(0, 2).map((photo, position) => (
                    <button
                      key={photo.photo_id}
                      className={`kx-dupshot ${position === 0 ? "keep" : ""}`.trim()}
                      aria-label={position === 0 ? "The frame being kept" : "The copy"}
                      onClick={() => openLightbox(photo.photo_id, lightboxPhotos)}
                    >
                      <img src={photoThumb(photo)} alt="" loading="lazy" />
                      {position === 0 && <span className="kx-dupkeep">Keep</span>}
                    </button>
                  ))}
                </span>

                <span className="kx-duprow-body">
                  <strong>
                    {fmt.format(group.photos.length)} copies ·{" "}
                    {group.similarity >= 0.995
                      ? "identical file"
                      : `${Math.round(group.similarity * 100)}% alike`}
                  </strong>
                  {/* TODO: the design's reason line — "Burst of 2 · 14 June
                      2026 21:48 · left frame is sharper" — needs dates and a
                      sharpness score per frame. /duplicates returns neither. */}
                  <span className="kx-cardmeta">
                    {group.photos.length > 2
                      ? `${fmt.format(group.photos.length - 1)} copies beyond the one being kept`
                      : "One copy beyond the one being kept"}
                  </span>
                </span>

                <span className="kx-duprow-actions">
                  {/* TODO: choosing the sharper frame needs a per-photo quality
                      score, and acting on it needs a non-destructive resolve
                      endpoint — the only delete path today removes the file
                      from Flickr permanently, which is not what this button
                      says it does. Disabled rather than mislabelled. */}
                  <button
                    className="kx-button compact primary"
                    disabled
                    title="Nothing measures which frame is sharper yet"
                  >
                    Keep the sharper one
                  </button>
                  <button
                    className="kx-button compact"
                    onClick={() => setKept((current) => new Set(current).add(index))}
                  >
                    Keep both
                  </button>
                </span>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
