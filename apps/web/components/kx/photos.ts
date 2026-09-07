import { BACKEND } from "@/lib/constants";

/** One row of `/library/photos`. */
export interface LibraryPhoto {
  photo_id: string;
  photo_title: string;
  date_taken: string;
  media_kind: "photo" | "video";
  duration_seconds: number | null;
  flickr_url?: string;
}

/**
 * Videos carry a poster frame on the local variant endpoint; photos go
 * through the image proxy, which resolves NAS originals before Flickr.
 */
export function thumbUrl(photo: Pick<LibraryPhoto, "photo_id" | "media_kind">): string {
  return photo.media_kind === "video"
    ? `${BACKEND}/photos/${photo.photo_id}/local?variant=thumb`
    : `${BACKEND}/photos/${photo.photo_id}/image?size=n`;
}

/** 9:05, or 1:02:33 once it runs past an hour. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export interface DaySection {
  /** YYYY-MM-DD, used as the React key and the scroll anchor id. */
  key: string;
  /** "Saturday, 14 June" — the year is added when it is not this one. */
  label: string;
  year: number;
  photos: LibraryPhoto[];
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const DAY_FORMAT_WITH_YEAR = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function parseDate(value: string): Date | null {
  // The API hands back "2026-06-14 21:48:00" as often as an ISO string.
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Split an ordered photo list into day sections. The list is already sorted by
 * the API, so this only has to break on a change of calendar day.
 */
export function groupByDay(photos: LibraryPhoto[]): DaySection[] {
  const thisYear = new Date().getFullYear();
  const sections: DaySection[] = [];

  for (const photo of photos) {
    const date = parseDate(photo.date_taken);
    const key = date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      : "undated";
    const last = sections[sections.length - 1];
    if (last && last.key === key) {
      last.photos.push(photo);
      continue;
    }
    sections.push({
      key,
      label: date
        ? (date.getFullYear() === thisYear ? DAY_FORMAT : DAY_FORMAT_WITH_YEAR).format(date)
        : "Undated",
      year: date ? date.getFullYear() : 0,
      photos: [photo],
    });
  }

  return sections;
}

/**
 * Which tiles break the mosaic's rhythm. Deterministic on position so the
 * layout does not reshuffle as later pages arrive.
 */
export function tileSpan(indexInDay: number): "" | "wide" | "big" {
  if (indexInDay === 0) return "big";
  if (indexInDay % 8 === 7) return "wide";
  return "";
}
