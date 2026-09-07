// The paged photo feed behind the mosaic, and the day grouping the design's
// sticky headers need.
//
// The backend groups by *month* (`/timeline`) or pages a flat keyset gallery
// (`/library/photos`, `/favorites`). The design's sections are *days*, so the
// day split happens here, in the viewer's own timezone — see `dayKey`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dayKey, formatDayTitle } from "./format";
import { library, type LibraryEvent, type LibraryPhoto, type MediaFilter } from "./library";
import type { MosaicSection } from "../desktop/Mosaic";

export type FeedSource = "timeline" | "gallery" | "favorites";

type Page = { photos: LibraryPhoto[]; nextBefore?: string | null; nextCursor?: string | null };

export type Feed = {
  photos: LibraryPhoto[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  exhausted: boolean;
  loadMore: () => void;
  reload: () => void;
};

export function usePhotoFeed(source: FeedSource, media: MediaFilter): Feed {
  const [photos, setPhotos] = useState<LibraryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const cursor = useRef<string | null>(null);
  // Guards against a scroll event firing loadMore again before the last page
  // has landed, which would page twice and duplicate a screenful.
  const busy = useRef(false);
  const generation = useRef(0);

  const fetchPage = useCallback(
    async (first: boolean) => {
      if (busy.current) return;
      busy.current = true;
      const mine = generation.current;
      if (first) setLoading(true);
      else setLoadingMore(true);
      try {
        let page: Page;
        if (source === "timeline") {
          const response = await library.timeline({
            months: 4,
            before: first ? null : cursor.current,
            media,
          });
          page = {
            photos: response.months.flatMap((month) => month.photos),
            nextBefore: response.next_before,
          };
          cursor.current = response.next_before;
        } else if (source === "favorites") {
          const response = await library.favorites({
            media,
            cursor: first ? null : cursor.current,
          });
          page = { photos: response.photos, nextCursor: response.next_cursor };
          cursor.current = response.next_cursor;
        } else {
          const response = await library.gallery({
            media,
            cursor: first ? null : cursor.current,
          });
          page = { photos: response.photos, nextCursor: response.next_cursor };
          cursor.current = response.next_cursor;
        }
        if (generation.current !== mine) return;
        setPhotos((previous) => (first ? page.photos : [...previous, ...page.photos]));
        setExhausted(cursor.current === null);
        setError(null);
      } catch (e) {
        if (generation.current === mine) setError(String(e));
      } finally {
        busy.current = false;
        if (generation.current === mine) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [source, media],
  );

  const reload = useCallback(() => {
    generation.current += 1;
    busy.current = false;
    cursor.current = null;
    setPhotos([]);
    setExhausted(false);
    void fetchPage(true);
  }, [fetchPage]);

  useEffect(() => {
    reload();
    // `reload` changes with source/media, which is exactly when a reset is
    // wanted.
  }, [reload]);

  const loadMore = useCallback(() => {
    if (exhausted || busy.current) return;
    void fetchPage(false);
  }, [exhausted, fetchPage]);

  return { photos, loading, loadingMore, error, exhausted, loadMore, reload };
}

/**
 * Day titles the household actually chose.
 *
 * Only a member-named event supplies a subtitle. The backend also invents a
 * name for every detected event ("June 2019, 213 photos"); the shared handoff
 * is explicit that a day title is a member-named event or a reverse-geocoded
 * place and never something we made up, so `name` is deliberately ignored and
 * only `custom_name` is used.
 *
 * TODO: reverse-geocoded places as a second source. `/locations` groups by
 * `location_name` but does not expose a date range, so there is no way to say
 * which day it belongs to; a `/events`-shaped endpoint carrying a place per day
 * would close it.
 */
export function useDayTitles(): Map<string, string> {
  const [events, setEvents] = useState<LibraryEvent[]>([]);
  useEffect(() => {
    let live = true;
    library
      .events()
      .then((list) => live && setEvents(list))
      .catch(() => {
        /* the mosaic reads fine without subtitles */
      });
    return () => {
      live = false;
    };
  }, []);

  return useMemo(() => {
    const titles = new Map<string, string>();
    for (const event of events) {
      const name = event.custom_name;
      if (!name || !event.start_date) continue;
      const start = new Date(event.start_date);
      const end = new Date(event.end_date ?? event.start_date);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      for (
        let day = new Date(start);
        day.getTime() <= end.getTime();
        day.setDate(day.getDate() + 1)
      ) {
        titles.set(dayKey(day.toISOString()), name);
      }
    }
    return titles;
  }, [events]);
}

/** Split a flat, date-ordered feed into the design's day sections. */
export function groupByDay(
  photos: LibraryPhoto[],
  dayTitles: Map<string, string>,
): MosaicSection[] {
  const sections: MosaicSection[] = [];
  let current: MosaicSection | null = null;
  let currentKey = "";
  for (const photo of photos) {
    const key = dayKey(photo.date_taken);
    if (!current || key !== currentKey) {
      current = {
        key,
        title: formatDayTitle(key),
        subtitle: dayTitles.get(key) ?? null,
        photos: [],
      };
      currentKey = key;
      sections.push(current);
    }
    current.photos.push(photo);
  }
  return sections;
}
