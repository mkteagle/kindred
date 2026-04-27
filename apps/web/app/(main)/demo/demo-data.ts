/* ── Demo mock data ──────────────────────────────────────────────── */

export const PEXELS = [
  "https://images.pexels.com/photos/28956215/pexels-photo-28956215.jpeg?w=400",
  "https://images.pexels.com/photos/28956216/pexels-photo-28956216.jpeg?w=400",
  "https://images.pexels.com/photos/28956217/pexels-photo-28956217.jpeg?w=400",
  "https://images.pexels.com/photos/28956218/pexels-photo-28956218.jpeg?w=400",
  "https://images.pexels.com/photos/28914463/pexels-photo-28914463.jpeg?w=400",
  "https://images.pexels.com/photos/28914464/pexels-photo-28914464.jpeg?w=400",
  "https://images.pexels.com/photos/28914465/pexels-photo-28914465.jpeg?w=400",
  "https://images.pexels.com/photos/28914466/pexels-photo-28914466.jpeg?w=400",
  "https://images.pexels.com/photos/28914467/pexels-photo-28914467.jpeg?w=400",
  "https://images.pexels.com/photos/28914468/pexels-photo-28914468.jpeg?w=400",
  "https://images.pexels.com/photos/28914469/pexels-photo-28914469.jpeg?w=400",
  "https://images.pexels.com/photos/28914470/pexels-photo-28914470.jpeg?w=400",
  "https://images.pexels.com/photos/28914471/pexels-photo-28914471.jpeg?w=400",
  "https://images.pexels.com/photos/28914472/pexels-photo-28914472.jpeg?w=400",
  "https://images.pexels.com/photos/28914473/pexels-photo-28914473.jpeg?w=400",
  "https://images.pexels.com/photos/28914474/pexels-photo-28914474.jpeg?w=400",
  "https://images.pexels.com/photos/28914475/pexels-photo-28914475.jpeg?w=400",
  "https://images.pexels.com/photos/28914476/pexels-photo-28914476.jpeg?w=400",
  "https://images.pexels.com/photos/28914477/pexels-photo-28914477.jpeg?w=400",
  "https://images.pexels.com/photos/28914478/pexels-photo-28914478.jpeg?w=400",
];

export interface DemoCluster {
  id: string;
  label: string;
  photoCount: number;
  photos: string[];
  avatar: string;
}

/* ── People ──────────────────────────────────────────────────────── */

export const PEOPLE_CLUSTERS: DemoCluster[] = [
  { id: "mom",       label: "Mom",       photoCount: 35, photos: PEXELS.slice(0, 10), avatar: PEXELS[0] },
  { id: "dad",       label: "Dad",       photoCount: 31, photos: PEXELS.slice(3, 14), avatar: PEXELS[3] },
  { id: "maya",      label: "Maya",      photoCount: 27, photos: PEXELS.slice(6, 19), avatar: PEXELS[6] },
  { id: "uncle-jim", label: "Uncle Jim", photoCount: 4,  photos: PEXELS.slice(14, 18), avatar: PEXELS[14] },
  { id: "friends",   label: "Friends",   photoCount: 4,  photos: PEXELS.slice(16, 20), avatar: PEXELS[16] },
];

/* ── Pets ─────────────────────────────────────────────────────────── */

export const PETS_CLUSTERS: DemoCluster[] = [
  { id: "luna",  label: "Luna",  photoCount: 68, photos: [...PEXELS.slice(0, 8), ...PEXELS.slice(12, 20)], avatar: PEXELS[1] },
  { id: "mochi", label: "Mochi", photoCount: 44, photos: [...PEXELS.slice(4, 16)],                          avatar: PEXELS[5] },
  { id: "buddy", label: "Buddy", photoCount: 33, photos: [...PEXELS.slice(8, 20)],                          avatar: PEXELS[9] },
];

/* ── Vehicles ─────────────────────────────────────────────────────── */

export const VEHICLES_CLUSTERS: DemoCluster[] = [
  { id: "family-suv",  label: "Family SUV",  photoCount: 22, photos: PEXELS.slice(0, 10), avatar: PEXELS[2] },
  { id: "dads-truck",  label: "Dad's Truck", photoCount: 14, photos: PEXELS.slice(10, 20), avatar: PEXELS[11] },
];

/* ── Category definitions (mirroring lib/constants) ──────────────── */

export interface DemoCategoryInfo {
  id: string;
  label: string;
  singular: string;
  clusters: DemoCluster[];
}

export const DEMO_CATEGORIES: DemoCategoryInfo[] = [
  { id: "people",   label: "People",   singular: "person",  clusters: PEOPLE_CLUSTERS },
  { id: "pets",     label: "Animals",  singular: "animal",  clusters: PETS_CLUSTERS },
  { id: "vehicles", label: "Vehicles", singular: "vehicle", clusters: VEHICLES_CLUSTERS },
];

/* Category lookup helper */
export function getDemoCategory(id: string): DemoCategoryInfo | undefined {
  return DEMO_CATEGORIES.find((c) => c.id === id);
}

/* Get all clusters for a category ID */
export function getDemoClusters(categoryId: string): DemoCluster[] {
  return getDemoCategory(categoryId)?.clusters || [];
}

/* ── Demo stats (mimics the Stats shape from the real app) ────────── */

export const DEMO_STATS = {
  people:   { groups: PEOPLE_CLUSTERS.length,   detections: 101, photos: 87  },
  pets:     { groups: PETS_CLUSTERS.length,      detections: 145, photos: 112 },
  vehicles: { groups: VEHICLES_CLUSTERS.length,  detections: 36,  photos: 32  },
};

/* ── Demo user ────────────────────────────────────────────────────── */

export const DEMO_USER = {
  display_name: "Demo User",
  username: "demo",
  role: "member" as const,
};

/* ── Demo household members (for settings) ────────────────────────── */

export const DEMO_HOUSEHOLD = [
  { id: "1", display_name: "Demo User",  username: "demo",    role: "member", created_at: "2025-01-15" },
  { id: "2", display_name: "Admin User", username: "admin",   role: "admin",  created_at: "2024-11-02" },
  { id: "3", display_name: "Maya T.",    username: "mayat",   role: "member", created_at: "2025-03-21" },
];

/* ── Search canned results ────────────────────────────────────────── */

export const DEMO_SEARCH_RESULTS: Record<string, { label: string; photos: string[] }> = {
  "beach":     { label: "Beach day",       photos: PEXELS.slice(0, 6) },
  "birthday":  { label: "Birthday party",  photos: PEXELS.slice(3, 9) },
  "family":    { label: "Family together", photos: PEXELS.slice(5, 14) },
  "kids":      { label: "Kids",            photos: PEXELS.slice(7, 13) },
  "sunset":    { label: "Sunset",          photos: PEXELS.slice(10, 16) },
  "garden":    { label: "In the garden",   photos: PEXELS.slice(12, 18) },
  "portrait":  { label: "Portraits",       photos: PEXELS.slice(0, 8) },
  "holiday":   { label: "Holiday",         photos: PEXELS.slice(2, 10) },
  "camping":   { label: "Camping trip",    photos: PEXELS.slice(0, 12) },
  "outdoors":  { label: "Outdoors",        photos: PEXELS.slice(4, 16) },
  "dog":       { label: "Luna & Buddy",    photos: PEXELS.slice(1, 8) },
  "cat":       { label: "Mochi",           photos: PEXELS.slice(5, 11) },
  "car":       { label: "Vehicles",        photos: PEXELS.slice(10, 18) },
};

export function searchDemoPhotos(query: string): { label: string; photos: string[] } | null {
  if (!query || query.length < 2) return null;
  const q = query.toLowerCase();
  // Exact key match
  for (const [key, val] of Object.entries(DEMO_SEARCH_RESULTS)) {
    if (q.includes(key) || key.includes(q)) return val;
  }
  // Person name match
  const person = PEOPLE_CLUSTERS.find((c) => c.label.toLowerCase().includes(q));
  if (person) return { label: person.label, photos: person.photos };
  // Pet name match
  const pet = PETS_CLUSTERS.find((c) => c.label.toLowerCase().includes(q));
  if (pet) return { label: pet.label, photos: pet.photos };
  // Fallback
  return { label: `Results for "${query}"`, photos: PEXELS.slice(0, 6) };
}
