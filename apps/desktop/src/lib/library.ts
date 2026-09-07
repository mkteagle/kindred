// Typed calls against the household server's endpoints.
//
// Only endpoints that exist are called. Where a window needs something the
// backend does not offer, the UI is built and the gap is marked with a TODO
// naming the endpoint that would close it — inventing a route would just move
// the failure to runtime.
//
// A note on dates: `photos.taken_at` is null for almost the whole library
// today, and the backend's own queries fall back to `created_at`
// (`COALESCE(p.taken_at, p.created_at)`). So what these calls return is
// currently the upload date wearing the name `date_taken`. Everything here
// treats it as the capture date, which is what it will be once the backfill
// lands; nothing needs to change on this side when it does.

import { desktop } from "./desktop";

export type MediaFilter = "all" | "photo" | "video";

export type LibraryPhoto = {
  photo_id: string;
  photo_title: string;
  date_taken: string | null;
  media_kind: "photo" | "video";
  duration_seconds: number | null;
  flickr_url?: string | null;
};

export type TimelineMonth = { month: string; count: number; photos: LibraryPhoto[] };

export type LibraryCounts = {
  total_files: number;
  photos: number;
  videos: number;
  on_nas: number;
  on_flickr: number;
  indexed_photos: number;
  pending_index: number;
};

export type CategoryStat = { detections: number; photos: number; groups?: number };
export type Stats = Record<string, CategoryStat>;

export type YearBucket = { year: number; count: number };

export type Cluster = {
  id: string;
  label: string | null;
  det_count: number;
  photo_count: number;
  avatar: string | null;
  thumb_url: string | null;
  photo_url: string | null;
};

export type NamedCluster = { id: string; category: string; label: string; avatar: string | null };

export type Detection = {
  id: string;
  category: string;
  subtype: string | null;
  photo_id: string;
  chip: string | null;
  thumb_url: string | null;
  photo_title: string | null;
  det_score: number | null;
  cluster_id?: string | null;
  cluster_label?: string | null;
};

export type ClusterDetail = {
  cluster_id: string;
  label: string | null;
  items: Detection[];
};

export type Album = {
  id: string | null;
  name: string;
  slug: string | null;
  description: string;
  photo_count: number;
  source?: string;
  created_at: string | null;
};

export type Share = {
  id: string;
  album_id: string | null;
  album_name: string | null;
  created_at: string | null;
  expires_at?: string | null;
  [key: string]: unknown;
};

export type LibraryEvent = {
  event_key: string | null;
  name: string;
  custom_name?: string;
  photo_count: number;
  start_date: string | null;
  end_date: string | null;
  photos: { photo_id: string; photo_title: string | null; date_taken: string | null }[];
};

export type SearchResult = {
  photo_id: string;
  photo_title?: string | null;
  date_taken?: string | null;
  media_kind?: "photo" | "video";
  duration_seconds?: number | null;
};

export type PhotoMetadata = {
  photo_id: string;
  date_taken: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name?: string | null;
  description?: string | null;
  tags?: string[] | null;
};

export const library = {
  counts: () => desktop.apiGet<LibraryCounts>("/library/counts"),
  stats: () => desktop.apiGet<Stats>("/stats"),

  years: (media: MediaFilter = "all") =>
    desktop
      .apiGet<{ years: YearBucket[] }>("/library/years", { media })
      .then((r) => r.years ?? []),

  timeline: (options: { months?: number; before?: string | null; media?: MediaFilter } = {}) =>
    desktop.apiGet<{ months: TimelineMonth[]; next_before: string | null }>("/timeline", {
      months: options.months ?? 4,
      before: options.before ?? undefined,
      media: options.media ?? "all",
    }),

  gallery: (options: {
    media?: MediaFilter;
    cursor?: string | null;
    dateFrom?: string;
    dateTo?: string;
    minDuration?: number;
    limit?: number;
  } = {}) =>
    desktop.apiGet<{ photos: LibraryPhoto[]; next_cursor: string | null }>("/library/photos", {
      media: options.media ?? "all",
      cursor: options.cursor ?? undefined,
      date_from: options.dateFrom,
      date_to: options.dateTo,
      min_duration: options.minDuration,
      limit: options.limit ?? 100,
    }),

  favorites: (options: { media?: MediaFilter; cursor?: string | null; limit?: number } = {}) =>
    desktop.apiGet<{ photos: LibraryPhoto[]; next_cursor: string | null }>("/favorites", {
      media: options.media ?? "all",
      cursor: options.cursor ?? undefined,
      limit: options.limit ?? 100,
    }),

  favoritesCount: () =>
    desktop.apiGet<{ count: number }>("/favorites/count").then((r) => r.count ?? 0),

  setFavorite: (photoId: string, favorited: boolean) =>
    desktop.apiSend<{ favorited: boolean }>(
      favorited ? "PUT" : "DELETE",
      `/photos/${photoId}/favorite`,
    ),

  clusters: (category: string, options: { limit?: number; offset?: number; q?: string } = {}) =>
    desktop.apiGet<{ clusters: Cluster[]; noise_count: number; total: number; has_more: boolean }>(
      `/clusters/${category}/summary`,
      { limit: options.limit ?? 60, offset: options.offset ?? 0, q: options.q },
    ),

  namedClusters: (category = "people") =>
    desktop
      .apiGet<{ clusters: NamedCluster[] }>("/clusters/named", { category })
      .then((r) => r.clusters ?? []),

  clusterDetail: (category: string, clusterId: string) =>
    desktop.apiGet<ClusterDetail>(`/clusters/${category}/${clusterId}`),

  labelCluster: (category: string, clusterId: string, name: string) =>
    desktop.apiSend<{ ok: boolean }>("POST", "/clusters/label", {
      category,
      cluster_id: clusterId,
      name,
    }),

  mergeClusters: (category: string, sourceId: string, targetId: string) =>
    desktop.apiSend<unknown>("POST", "/clusters/merge", {
      category,
      source_id: sourceId,
      target_id: targetId,
    }),

  dismissCluster: (category: string, clusterId: string) =>
    desktop.apiSend<{ ok: boolean }>("POST", "/clusters/dismiss", {
      category,
      cluster_id: clusterId,
    }),

  removeDetections: (category: string, clusterId: string, detectionIds: string[]) =>
    desktop.apiSend<{ ok: boolean; removed: number }>("POST", "/clusters/remove-detections", {
      category,
      cluster_id: clusterId,
      detection_ids: detectionIds,
    }),

  search: (options: {
    q?: string;
    media?: MediaFilter;
    dateField?: "taken" | "added";
    dateFrom?: string;
    dateTo?: string;
    clusterId?: string;
    category?: string;
    albumId?: string;
    limit?: number;
  }) =>
    desktop.apiGet<{ results: SearchResult[]; query: string }>("/search", {
      q: options.q ?? "",
      media: options.media ?? "all",
      date_field: options.dateField ?? "taken",
      date_from: options.dateFrom,
      date_to: options.dateTo,
      cluster_id: options.clusterId,
      category: options.category,
      album_id: options.albumId,
      limit: options.limit ?? 60,
    }),

  albums: () => desktop.apiGet<{ albums: Album[] }>("/albums").then((r) => r.albums ?? []),

  addToAlbum: (albumRef: string, photoIds: string[]) =>
    desktop.apiSend<unknown>("POST", `/albums/${albumRef}/photos`, { photo_ids: photoIds }),

  shares: () => desktop.apiGet<{ shares: Share[] }>("/shares").then((r) => r.shares ?? []),

  events: () =>
    desktop.apiGet<{ events: LibraryEvent[] }>("/events").then((r) => r.events ?? []),

  objects: () =>
    desktop
      .apiGet<{ objects: Record<string, { photo_id: string }[]> }>("/objects")
      .then((r) => r.objects ?? {}),

  locations: () => desktop.apiGet<unknown>("/locations"),

  duplicates: () => desktop.apiGet<unknown>("/duplicates"),

  together: (clusterIds: string[]) =>
    desktop.apiGet<{ photos?: SearchResult[]; results?: SearchResult[] }>("/photos/together", {
      people: clusterIds.join(","),
    }),

  photoMetadata: (photoId: string) =>
    desktop.apiGet<PhotoMetadata>(`/photos/${photoId}/metadata`),

  photoDetections: (photoId: string) =>
    desktop.apiGet<{ detections: Detection[] }>(`/photos/${photoId}/detections`),
};

/** Photo counts the sidebar shows, gathered in one pass. */
export type SidebarCounts = {
  allPhotos: number | null;
  people: number | null;
  animals: number | null;
  vehicles: number | null;
  videos: number | null;
  favorites: number | null;
  shared: number | null;
};

export async function loadSidebarCounts(): Promise<SidebarCounts> {
  const [counts, stats, favorites, shares] = await Promise.allSettled([
    library.counts(),
    library.stats(),
    library.favoritesCount(),
    library.shares(),
  ]);
  const value = <T,>(r: PromiseSettledResult<T>): T | null =>
    r.status === "fulfilled" ? r.value : null;
  const c = value(counts);
  const s = value(stats);
  return {
    allPhotos: c ? c.photos : null,
    videos: c ? c.videos : null,
    // `groups` is the count of distinct clusters, which is what "38 people"
    // means in the design — not the number of detections.
    people: s?.people?.groups ?? null,
    animals: s?.pets?.groups ?? null,
    vehicles: s?.vehicles?.groups ?? null,
    favorites: value(favorites),
    shared: value(shares)?.length ?? null,
  };
}
