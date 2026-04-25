import type { CategoryInfo, FutureFilter } from "@/types";

// All backend calls go through the Next.js proxy which adds the API key server-side
export const BACKEND = "/api/backend";

export const CATEGORIES: CategoryInfo[] = [
  { id: "people", label: "People", singular: "person", cards: "people cards", empty: "No people found yet" },
  { id: "animals", label: "Animals", singular: "animal", cards: "animal cards", empty: "No animals found yet" },
  { id: "vehicles", label: "Vehicles", singular: "vehicle", cards: "vehicle cards", empty: "No vehicles found yet" },
];

/** Map frontend route category to backend DB category. */
const BACKEND_CAT: Record<string, string> = { animals: "pets" };
export function toBackendCategory(cat: string): string {
  return BACKEND_CAT[cat] || cat;
}
/** Map backend DB category to frontend route. */
const FRONTEND_CAT: Record<string, string> = { pets: "animals" };
export function toFrontendCategory(cat: string): string {
  return FRONTEND_CAT[cat] || cat;
}

export const FUTURE_FILTERS: FutureFilter[] = [];

export const HERO_PHOTOS: string[] = [
  "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=700&q=82",
  "https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?auto=format&fit=crop&w=700&q=82",
  "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=700&q=82",
  "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?auto=format&fit=crop&w=700&q=82",
  "https://images.unsplash.com/photo-1516627145497-ae6968895b74?auto=format&fit=crop&w=700&q=82",
];

export const fmt = new Intl.NumberFormat();
