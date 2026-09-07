"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import type { TimelineMonth, TimelineResponse } from "@/types";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { KxEmpty, KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";
import { photoThumb } from "@/lib/photo-url";

type Grain = "months" | "years" | "days";

const GRAINS: { id: Grain; label: string }[] = [
  { id: "months", label: "Months" },
  { id: "years", label: "Years" },
  { id: "days", label: "Days" },
];

const MONTHS_PER_PAGE = 6;

interface TimelinePage extends TimelineResponse {
  next_before?: string | null;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

function monthLabel(value: string): string {
  const [year, month] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return Number.isNaN(date.getTime()) ? value : MONTH_LABEL.format(date);
}

interface Row {
  key: string;
  label: string;
  count: number;
  photos: TimelineMonth["photos"];
}

/** Fold the month buckets the endpoint returns into the chosen grain. */
function rowsFor(grain: Grain, months: TimelineMonth[]): Row[] {
  if (grain === "months") {
    return months.map((month) => ({
      key: month.month,
      label: monthLabel(month.month),
      count: month.count,
      photos: month.photos,
    }));
  }

  if (grain === "years") {
    const years = new Map<string, Row>();
    for (const month of months) {
      const year = month.month.split("-")[0];
      const row = years.get(year);
      if (row) {
        row.count += month.count;
        row.photos = row.photos.concat(month.photos);
      } else {
        years.set(year, { key: year, label: year, count: month.count, photos: [...month.photos] });
      }
    }
    return Array.from(years.values());
  }

  // Days are cut from the photos already in hand, so a day's count is what is
  // on screen rather than the whole day — the endpoint buckets by month.
  const days = new Map<string, Row>();
  for (const month of months) {
    for (const photo of month.photos) {
      const key = (photo.date_taken || "").slice(0, 10);
      if (!key) continue;
      const row = days.get(key);
      if (row) {
        row.count += 1;
        row.photos.push(photo);
      } else {
        const date = new Date(key);
        days.set(key, {
          key,
          label: Number.isNaN(date.getTime()) ? key : DAY_LABEL.format(date),
          count: 1,
          photos: [photo],
        });
      }
    }
  }
  return Array.from(days.values()).sort((a, b) => b.key.localeCompare(a.key));
}

export default function TimelinePage() {
  const [grain, setGrain] = useState<Grain>("months");
  const { openLightbox } = useLightbox();
  const sentinel = useRef<HTMLDivElement>(null);

  const { data, error, isPending, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useInfiniteQuery<TimelinePage>({
      queryKey: ["kx-timeline"],
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam }) => {
        const params = new URLSearchParams({ months: String(MONTHS_PER_PAGE), media: "all" });
        if (pageParam) params.set("before", pageParam as string);
        const response = await fetch(`${BACKEND}/timeline?${params}`);
        if (!response.ok) throw new Error("The timeline could not be loaded.");
        return response.json();
      },
      getNextPageParam: (page) => page.next_before ?? undefined,
    });

  const months = useMemo(
    () =>
      Array.from(
        new Map((data?.pages.flatMap((page) => page.months) ?? []).map((m) => [m.month, m])).values(),
      ),
    [data],
  );

  const rows = useMemo(() => rowsFor(grain, months), [grain, months]);

  const total = useMemo(() => months.reduce((sum, month) => sum + month.count, 0), [months]);

  // One span of years is the honest headline for a library that reaches back.
  const years = useMemo(() => {
    const set = new Set(months.map((month) => month.month.split("-")[0]));
    return set.size;
  }, [months]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasNextPage || isFetchingNextPage || error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchNextPage();
      },
      { rootMargin: "600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, error, months.length]);

  return (
    <main className="kx-page">
      <span className="kx-eyebrow">Timeline</span>
      <h1 className="kx-title">
        {years > 1 ? `${years} years, end to end.` : "End to end."}
      </h1>
      <p className="kx-lede">
        Every month that holds a photo. Scrub the years on the right of the library, or walk down
        them here.
      </p>

      <div className="kx-chiprow" role="group" aria-label="Group the timeline by">
        {GRAINS.map((option) => (
          <button
            key={option.id}
            className={`kx-chip ${grain === option.id ? "is-active" : ""}`}
            aria-pressed={grain === option.id}
            onClick={() => setGrain(option.id)}
          >
            {option.label}
          </button>
        ))}
        {total > 0 && (
          <span className="kx-cardmeta" style={{ marginLeft: "auto", alignSelf: "center" }}>
            {fmt.format(total)} photos so far
          </span>
        )}
      </div>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
      {!error && isPending && <KxSkeletonRows count={4} height={132} />}
      {!error && !isPending && rows.length === 0 && (
        <KxEmpty
          title="Nothing here yet."
          body="Photos need a date before they can sit on a timeline. The next sync will fill this in."
          action={{ label: "Browse the library", href: "/gallery", primary: true }}
        />
      )}

      {rows.map((row) => {
        const lightboxPhotos: LightboxPhoto[] = row.photos.map((photo) => ({
          photo_id: photo.photo_id,
          thumb_url: photo.thumb_url,
          flickr_url: photo.flickr_url,
          photo_title: photo.photo_title,
          date_taken: photo.date_taken,
        }));
        return (
          <div className="kx-tlrow" key={row.key}>
            <span className="kx-tllabel">
              <strong>{row.label}</strong>
              <span className="kx-cardmeta">
                {fmt.format(row.count)} {row.count === 1 ? "photo" : "photos"}
              </span>
            </span>
            <div className="kx-tlstrip">
              {row.photos.map((photo) => (
                <button
                  key={photo.photo_id}
                  onClick={() => openLightbox(photo.photo_id, lightboxPhotos)}
                  aria-label={photo.photo_title || "Open photo"}
                >
                  <img src={photoThumb(photo)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {isFetchingNextPage && <KxSkeletonRows count={2} height={132} />}
      {hasNextPage && !isFetchingNextPage && (
        <div className="kx-loadmore">
          <button className="kx-button" onClick={() => void fetchNextPage()}>
            Load earlier months
          </button>
        </div>
      )}
      {!hasNextPage && rows.length > 0 && <p className="kx-status">That&rsquo;s the whole run.</p>}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
    </main>
  );
}
