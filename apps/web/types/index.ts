export interface Detection {
  id: string;
  category: string;
  subtype: string;
  photo_id: string;
  photo_url: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
  owner: string;
  bbox: unknown;
  det_score: number;
  chip: string;
}

export interface ClusterSummary {
  id: string;
  label: string | null;
  det_count: number;
  photo_count: number;
  avatar: string | null;
  thumb_url?: string;
  photo_url?: string;
  cover_crop?: { x: number; y: number } | null;
}

export interface ClusterDetail {
  cluster_id: string;
  label?: string | null;
  avatar_detection_id?: string | null;
  cover_photo_id?: string | null;
  cover_crop?: { x: number; y: number } | null;
  items: Detection[];
}

export interface ClustersSummaryResponse {
  clusters: ClusterSummary[];
  noise_count?: number;
  labels?: Record<string, string>;
  total?: number;
  has_more?: boolean;
  offset?: number;
  limit?: number;
}

export type Stats = Record<string, { detections: number; photos: number; groups?: number }>;

export interface SyncLog {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_photos: number;
  new_faces: number;
  new_pets: number;
  new_vehicles: number;
  error: string | null;
  job_id: string;
}

export interface Job {
  status: string;
  progress: number;
  total: number;
  message: string;
  counts: { people: number; pets: number; vehicles: number };
}

export interface User {
  loggedIn: boolean;
  userId: string;
  username: string;
  fullname: string;
  display_name?: string;
  role?: "admin" | "member";
  auth_method?: "flickr" | "password";
  avatar_url?: string;
}

export interface CategoryInfo {
  id: string;
  label: string;
  singular: string;
  cards: string;
  empty: string;
}

export interface FutureFilter {
  label: string;
  status: string;
}

export interface SearchResult {
  photo_id: string;
  distance: number;
  photo_url: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
  owner: string;
  match_type?: string;
  match_name?: string;
  match_cluster_id?: string;
  match_category?: string;
}

export interface SceneGroup {
  photo_id: string;
  thumb_url: string;
  distance: number;
  flickr_url: string;
  photo_url: string;
  photo_title: string;
}

export interface ScenesResponse {
  scenes: Record<string, SceneGroup[]>;
}

export interface TimelineMonth {
  month: string;
  count: number;
  photos: Array<{
    photo_id: string;
    thumb_url: string;
    flickr_url: string;
    photo_title: string;
    date_taken: string;
  }>;
}

export interface TimelineResponse {
  months: TimelineMonth[];
}

export interface LocationGroup {
  name: string;
  count: number;
  lat: number;
  lng: number;
  photos: Array<{
    photo_id: string;
    thumb_url: string;
    flickr_url: string;
    photo_title: string;
  }>;
}

export interface LocationsResponse {
  locations: LocationGroup[];
}

export interface DuplicateGroup {
  photos: Array<{
    photo_id: string;
    thumb_url: string;
    photo_url: string;
    flickr_url: string;
  }>;
  similarity: number;
}

export interface DuplicatesResponse {
  groups: DuplicateGroup[];
}
