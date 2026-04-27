/* ── Demo mock data (synced with iOS DemoData JSONs) ─────────────── */

/* ── Photo URL helpers ───────────────────────────────────────────── */

/** Convert a demo filename to a web-servable URL */
function demoPhoto(name: string): string {
  return `/demo/photos/${name}.jpg`;
}

/** All 36 demo photos available on the web */
export const DEMO_PHOTOS = [
  demoPhoto("car-suv"),
  demoPhoto("cat-tabby"),
  demoPhoto("couple-evening"),
  demoPhoto("couple-festive"),
  demoPhoto("couple-hug-van"),
  demoPhoto("couple-sunset"),
  demoPhoto("couple-van"),
  demoPhoto("dog-puppy"),
  demoPhoto("dog-retriever"),
  demoPhoto("family-camper-lights"),
  demoPhoto("family-campervan"),
  demoPhoto("family-campfire-1"),
  demoPhoto("family-campfire-2"),
  demoPhoto("family-campfire-3"),
  demoPhoto("family-campfire-4"),
  demoPhoto("family-evening"),
  demoPhoto("family-holiday-1"),
  demoPhoto("family-holiday-2"),
  demoPhoto("family-inside-van"),
  demoPhoto("family-music"),
  demoPhoto("family-roadtrip"),
  demoPhoto("family-three-sunset"),
  demoPhoto("family-van-1"),
  demoPhoto("family-van-2"),
  demoPhoto("friends-van"),
  demoPhoto("kid-campfire"),
  demoPhoto("kid-festive"),
  demoPhoto("landscape-beach"),
  demoPhoto("landscape-forest"),
  demoPhoto("landscape-mountain"),
  demoPhoto("marshmallows"),
  demoPhoto("mom-child-joy"),
  demoPhoto("parent-child"),
  demoPhoto("parent-child-bw"),
  demoPhoto("shadow-puppets"),
  demoPhoto("truck-pickup"),
];

/* Category-specific photo pools (matching iOS DemoDataProvider.swift) */

const PEOPLE_PHOTOS = [
  "family-campfire-1", "family-campfire-2", "family-campfire-3", "family-campfire-4",
  "family-holiday-1", "family-holiday-2", "family-van-1", "family-van-2",
  "family-music", "family-evening", "family-campervan", "family-inside-van",
  "family-roadtrip", "family-three-sunset", "family-camper-lights",
  "couple-evening", "couple-festive", "couple-hug-van", "couple-sunset", "couple-van",
  "friends-van", "kid-campfire", "kid-festive", "marshmallows",
  "mom-child-joy", "parent-child", "parent-child-bw", "shadow-puppets",
].map(demoPhoto);

const PET_PHOTOS = [
  "dog-retriever", "cat-tabby", "dog-puppy",
].map(demoPhoto);

const VEHICLE_PHOTOS = [
  "car-suv", "truck-pickup",
].map(demoPhoto);

/* ── Types ───────────────────────────────────────────────────────── */

export interface DemoCluster {
  id: string;
  label: string;
  photoCount: number;
  photos: string[];
  avatar: string;
}

/* ── People (from clusters_people.json) ──────────────────────────── */

export const PEOPLE_CLUSTERS: DemoCluster[] = [
  {
    id: "demo_p1",
    label: "Mom",
    photoCount: 35,
    photos: PEOPLE_PHOTOS.slice(0, 10),
    avatar: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABCAC4DASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxG30+4ulaSJM+uTg+tasPhS+KAusefJM7Lv6KMbs/TNWNOik+wq4ijMKuJCXJ3egx7Vc1aaXWb9LSBv3UK4kKcbicHH5ikMW4udB0e08uGAahqTqriVXIhh5+6T/EfbAqrceM9bliSKK7a1gQnEdsTGMeh55rN17SW05kZFJhfkFegPvWYDzigDoE8Uaw3MuoTyP13s3OfWui074ianDAkUx3ogwJMkEn6AiuATqAeh4pwfC5YkemDQBo28kyWAj819u3AXPb0rZ8MxtHYPIiFppZSAfXA45rOuowkWRjAHritfwffm10wK43FmOzjmgYk6Q6oz2r6hGLo9IthCk1yeoWcljdNBONrjkHsRXftbWzBTbwKHySXPUE1l67YCaFRLzjoxHQ0AcbhgM849qG2gfPuZQcfIM9h+lTzxyQPsIz6Yq7bW+nIM3ly5iYAosS4cHvu9B6UCKU+oHUbqKHeILZpApJ9CeTXZR2vkTiK1nLPEuF2puU+vP9a84GAd3p6812nhjUT9hWyxiSIleCclTzQM7axVJLTbLtWbGc9s1UvLYy27I4z6Yqukc4mjeeVtoOVjQ4H41q3Em2DKlelAHnOtBYZymMsPWqRBdjtcleO4rT8TReZexvbqWkkOzaOpNd14d8PaUdLiZ7VZZSPmLrzmgDxlAGdRzgn0rVsJng12AwNty6p0zweKy7QZlUc+tSzyESs6ZBzkEHoaGI9PlnSBU3yBm6lay9R1WRgY4gcHvXGrrN4uA7q+OASKlttXmacFohIM8hRQM2oUvXuI7iD5rmNtyAjj2r0/Tb6KwgQXdzE0rIC5Ckc/TtXNeGbZtQtFvLZWUH5RuGCDVG9meG+kjvAyDJ2n1/GgDziz/1j/7ppD938aKKGIW0AMq5GenX61v7QkSlAFPsMUUUAd94PZj4bOWP+tbv7VWukVoU3KD8zdRRRQM//9k=",
  },
  {
    id: "demo_p2",
    label: "Dad",
    photoCount: 31,
    photos: PEOPLE_PHOTOS.slice(2, 13),
    avatar: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAA6ADIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDhNetVjDy4wO9chvDb9hCnt7132vlZoHikIww4x2rnfBelwX2qf6dEWgU7F44J+tIowWhc72AZj1OOaiPygDHPrXeltpGnW1syx2sUaMDnC/hXm/ibwwbSZpdOxJbEk7Acsg/woEcmp9TUgc9AeKaybACR1pARuNAEm6oot4ooA6G5uri7k7hD1HtXQeC47mDzkuJI47FBvUMvLMfft0Fc14bvftdzHbSQMskpwhAyD7V2esWl3ZWC+WpZQcEDt68UDNnU9Z08Wk0kszERrlgneucuYLW6hWSyN1bTOu8JNkZH+FJY2ontkuseZBJ8rqR+YNXdUSOQxyRM5ZFCje27AHagDgL+zlLs23BB5Hb8KzpF2s2T7V1eoOu1h3rkp2DXDDHUmgRHn2oqZLad1DLE5UjI47UUAP0nWJ7PVrSZmwiSqWAGBjPNeqyXK3V7MjI7mI7sgE7QeleJFSVOGHPv1/z/AEr0/wAN2z6npVvfJcyxTunlO6MQW28c/lQM67TUtlsGiyiLknrwSa5/XJPIDBGGB19Kyr6zUQtEzyDaeGDEHNZwtrmaRUeaSWLvuNAFG9uGmn2R5Y+oqxonh19WvVj3YXO5yfT0q6NPZ5VitkHmO3AB6D3reM8ejWDW9uwLsnmbweSwPP4UAR/bNOi/d+ZGuz5dvpjtRXJXEkMlxK5LZZienvRQIqXGj+fds0RManrgcA1q6Xq8miWLWaNuiyWAJ5Un3qWMnbJyetczqZP2p+aBnWWGpx30eJiSO5rSsrOSeJmZlS3B/wBYWwAK5Hwyqtd26sAVMgyCODXba1/x8Rx/8sxtwvYcntQAkusWGiwMmnRPcTKA3m44PODXIapq800uNoQLuC+wNP1RmAcBiB5TcZ/2qwGJLvk/xf0oAlaVixOT19aKrnrRQI//2Q==",
  },
  {
    id: "demo_p3",
    label: "Maya",
    photoCount: 27,
    photos: PEOPLE_PHOTOS.slice(4, 17),
    avatar: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABCADIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD58BpQMnpSL1xUo45xkY7UDGpkMMHnsMU9l3cPx9RW74dskf8AfzLnnCgjiuifTYZosNErDPbtSA4HZhvbr1q7pV/Ppt3DdWzFJoyCrDjkHtu50aJPuAVjXVoIM520Aejr8bvGIUAzWbEDqYjk/rRXln4iigCsgJOasW8Uck8Ylk8tCcM/Xb+FNCnAHpWxo2nSeak9wFEfOAw4oA6fTbZxpSPs84rn7gwSO1RW98FlCNHNbyH+GQZz+NTzfaLe3T7MzCILkn19qgt0lYbrs/aIpDkjoUoGLf3DeSXCk9a5K+uBOTXbGEImGw4xj2xXIa9DHbXeIRhGGcelAGbtPoKKQls0UEgDxu7Dj612NxrqW7i2FmJLZY0JLD1A54rjl4PPbmun8K3sS3IkurR7tUh+zkA89cg0DNDSr6xu7l1hLIjDbskb+L2rWfTXgwHyFPPBrG1iDSr1safBc21wOQUjyN3XrWq2qg6NZNcHEvl4Ye44oGVrmbZIQOgrlLyJr/UtqnC8DJ7Vf1G/wB5JSodDWSS8LQsFZOfMYZ2546UCIBoTsAftlrzz96itprd42KGBXK8btn3veigDj0DSSKiDLMcADvU9h5tvdOVlMJVsMc/piun8H6P5RGoX8UkaZAiVl5P+1VzVPCttq97Jc6dI9q5+/5q5DN7YoAyr7WBDZokMvmyv1bpistbrfCoeTdtGBWlqPgq/tYPM+1W0pAyQSVx9Kx7fRr2ePeoTZj7wbjNADLm5wnufSp9IV8mQlh2yDjI9DVy10XY26VhJjsKvi3CKVVdvt6UAUCMknc//fZ/xopS8YJBdaKBnputEjV5EBwioMKOg4qJyU0u2KkqSGyRxn5jRRQBzd/NKYLrMjng9WPpWX4NJbTRuJPzHr9TRRQI0ZAA74GOe1Z+qEraMVJB9qKKBnEM7bj8zdfWiiigD//Z",
  },
  {
    id: "demo_p4",
    label: "Uncle Jim",
    photoCount: 4,
    photos: [demoPhoto("couple-sunset"), demoPhoto("couple-evening"), demoPhoto("couple-festive"), demoPhoto("couple-van")],
    avatar: "data:image/jpeg;base64,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",
  },
  {
    id: "demo_p5",
    label: "Friends",
    photoCount: 4,
    photos: [demoPhoto("couple-sunset"), demoPhoto("friends-van"), demoPhoto("family-three-sunset"), demoPhoto("shadow-puppets")],
    avatar: "data:image/jpeg;base64,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",
  },
];

/* ── Pets (from clusters_pets.json) ──────────────────────────────── */

export const PETS_CLUSTERS: DemoCluster[] = [
  {
    id: "demo_pet1",
    label: "Luna",
    photoCount: 68,
    photos: [PET_PHOTOS[0], ...PEOPLE_PHOTOS.slice(0, 4)],
    avatar: demoPhoto("dog-retriever"),
  },
  {
    id: "demo_pet2",
    label: "Mochi",
    photoCount: 44,
    photos: [PET_PHOTOS[1], ...PEOPLE_PHOTOS.slice(4, 8)],
    avatar: demoPhoto("cat-tabby"),
  },
  {
    id: "demo_pet3",
    label: "Buddy",
    photoCount: 33,
    photos: [PET_PHOTOS[2], ...PEOPLE_PHOTOS.slice(8, 12)],
    avatar: demoPhoto("dog-puppy"),
  },
];

/* ── Vehicles (from clusters_vehicles.json) ──────────────────────── */

export const VEHICLES_CLUSTERS: DemoCluster[] = [
  {
    id: "demo_v1",
    label: "Family SUV",
    photoCount: 22,
    photos: [VEHICLE_PHOTOS[0], ...PEOPLE_PHOTOS.slice(6, 12)],
    avatar: demoPhoto("car-suv"),
  },
  {
    id: "demo_v2",
    label: "Dad's Truck",
    photoCount: 14,
    photos: [VEHICLE_PHOTOS[1], ...PEOPLE_PHOTOS.slice(12, 18)],
    avatar: demoPhoto("truck-pickup"),
  },
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

/* ── Demo stats (from stats.json) ────────────────────────────────── */

export const DEMO_STATS = {
  people:   { groups: 8,  detections: 1766, photos: 805 },
  pets:     { groups: 3,  detections: 314,  photos: 145 },
  vehicles: { groups: 2,  detections: 59,   photos: 36  },
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

/* ── Timeline (from timeline.json) ───────────────────────────────── */

export interface DemoTimelineMonth {
  month: string;
  count: number;
  photos: { photo_id: string; thumb_url: string; photo_title: string; date_taken: string }[];
}

export const DEMO_TIMELINE: DemoTimelineMonth[] = [
  {
    month: "2026-04",
    count: 87,
    photos: [
      { photo_id: "demo_tp01", thumb_url: demoPhoto("family-campfire-1"), photo_title: "Easter morning", date_taken: "2026-04-05" },
      { photo_id: "demo_tp02", thumb_url: demoPhoto("family-holiday-1"), photo_title: "Spring garden", date_taken: "2026-04-12" },
      { photo_id: "demo_tp03", thumb_url: demoPhoto("family-music"), photo_title: "Family dinner", date_taken: "2026-04-18" },
      { photo_id: "demo_tp04", thumb_url: demoPhoto("couple-van"), photo_title: "Park walk", date_taken: "2026-04-22" },
    ],
  },
  {
    month: "2026-03",
    count: 112,
    photos: [
      { photo_id: "demo_tp05", thumb_url: demoPhoto("parent-child"), photo_title: "Grandma's visit", date_taken: "2026-03-03" },
      { photo_id: "demo_tp06", thumb_url: demoPhoto("kid-festive"), photo_title: "Sam's birthday", date_taken: "2026-03-14" },
      { photo_id: "demo_tp07", thumb_url: demoPhoto("family-van-1"), photo_title: "Hiking trip", date_taken: "2026-03-21" },
      { photo_id: "demo_tp08", thumb_url: demoPhoto("marshmallows"), photo_title: "Backyard BBQ", date_taken: "2026-03-28" },
    ],
  },
  {
    month: "2026-02",
    count: 74,
    photos: [
      { photo_id: "demo_tp09", thumb_url: demoPhoto("couple-sunset"), photo_title: "Valentine's brunch", date_taken: "2026-02-14" },
      { photo_id: "demo_tp10", thumb_url: demoPhoto("family-evening"), photo_title: "Snow day", date_taken: "2026-02-08" },
      { photo_id: "demo_tp11", thumb_url: demoPhoto("family-roadtrip"), photo_title: "Movie night", date_taken: "2026-02-20" },
    ],
  },
  {
    month: "2026-01",
    count: 95,
    photos: [
      { photo_id: "demo_tp12", thumb_url: demoPhoto("family-camper-lights"), photo_title: "New Year's Day", date_taken: "2026-01-01" },
      { photo_id: "demo_tp13", thumb_url: demoPhoto("mom-child-joy"), photo_title: "Baby Lily's first steps", date_taken: "2026-01-15" },
      { photo_id: "demo_tp14", thumb_url: demoPhoto("couple-evening"), photo_title: "Weekend at the lake", date_taken: "2026-01-22" },
    ],
  },
];

/* ── Search canned results (from search_results.json) ────────────── */

export const DEMO_SEARCH_RESULTS: Record<string, { label: string; photos: string[] }> = {
  "campfire": {
    label: "Campfire",
    photos: [
      demoPhoto("family-campfire-1"),
      demoPhoto("family-campfire-2"),
      demoPhoto("family-campfire-3"),
      demoPhoto("kid-campfire"),
      demoPhoto("marshmallows"),
    ],
  },
  "beach": {
    label: "Beach",
    photos: [
      demoPhoto("landscape-beach"),
      demoPhoto("family-three-sunset"),
      demoPhoto("couple-sunset"),
    ],
  },
  "birthday": {
    label: "Birthday",
    photos: [
      demoPhoto("kid-festive"),
      demoPhoto("couple-festive"),
    ],
  },
  "maya": {
    label: "Maya",
    photos: [
      demoPhoto("family-campfire-1"),
      demoPhoto("family-music"),
      demoPhoto("mom-child-joy"),
    ],
  },
  "dog": {
    label: "Luna & Buddy",
    photos: [
      demoPhoto("dog-retriever"),
      demoPhoto("dog-puppy"),
    ],
  },
  "park": {
    label: "Park",
    photos: [
      demoPhoto("family-van-1"),
      demoPhoto("parent-child"),
    ],
  },
  "family": {
    label: "Family together",
    photos: [
      demoPhoto("family-campfire-1"),
      demoPhoto("family-campfire-2"),
      demoPhoto("family-holiday-1"),
      demoPhoto("family-holiday-2"),
      demoPhoto("family-van-1"),
      demoPhoto("family-van-2"),
      demoPhoto("family-evening"),
      demoPhoto("family-music"),
      demoPhoto("family-roadtrip"),
    ],
  },
  "sunset": {
    label: "Sunset",
    photos: [
      demoPhoto("couple-sunset"),
      demoPhoto("family-three-sunset"),
      demoPhoto("family-evening"),
    ],
  },
  "kids": {
    label: "Kids",
    photos: [
      demoPhoto("kid-campfire"),
      demoPhoto("kid-festive"),
      demoPhoto("mom-child-joy"),
      demoPhoto("parent-child"),
    ],
  },
  "garden": {
    label: "In the garden",
    photos: [
      demoPhoto("family-holiday-1"),
      demoPhoto("family-holiday-2"),
      demoPhoto("landscape-forest"),
    ],
  },
  "portrait": {
    label: "Portraits",
    photos: [
      demoPhoto("parent-child"),
      demoPhoto("parent-child-bw"),
      demoPhoto("mom-child-joy"),
      demoPhoto("couple-hug-van"),
    ],
  },
  "holiday": {
    label: "Holiday",
    photos: [
      demoPhoto("family-holiday-1"),
      demoPhoto("family-holiday-2"),
      demoPhoto("couple-festive"),
      demoPhoto("kid-festive"),
    ],
  },
  "camping": {
    label: "Camping trip",
    photos: [
      demoPhoto("family-campervan"),
      demoPhoto("family-camper-lights"),
      demoPhoto("family-inside-van"),
      demoPhoto("couple-van"),
      demoPhoto("family-van-1"),
      demoPhoto("family-van-2"),
      demoPhoto("friends-van"),
    ],
  },
  "outdoors": {
    label: "Outdoors",
    photos: [
      demoPhoto("landscape-mountain"),
      demoPhoto("landscape-forest"),
      demoPhoto("landscape-beach"),
      demoPhoto("family-three-sunset"),
      demoPhoto("couple-sunset"),
    ],
  },
  "cat": {
    label: "Mochi",
    photos: [
      demoPhoto("cat-tabby"),
    ],
  },
  "car": {
    label: "Vehicles",
    photos: [
      demoPhoto("car-suv"),
      demoPhoto("truck-pickup"),
    ],
  },
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
  return { label: `Results for "${query}"`, photos: DEMO_PHOTOS.slice(0, 6) };
}
