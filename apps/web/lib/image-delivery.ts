import { BACKEND } from "@/lib/constants";

export const IMAGE_WIDTHS = [160, 320, 480, 640, 960, 1280, 1600, 2048, 2560] as const;
export function imageWidth(pixels: number, maximum = 2560): number {
  return IMAGE_WIDTHS.find(w => w >= Math.min(maximum, pixels)) ?? maximum;
}
export function photoImageUrl(id: string, width: number, format: "auto" | "jpeg" = "auto"): string {
  const requested = imageWidth(width);
  // Older NAS releases ignore w/q/format. Keep a safe legacy size so a web
  // deployment can never turn grid requests into default 2048px previews.
  const legacy = requested <= 960 ? "n" : "h";
  return `${BACKEND}/photos/${encodeURIComponent(id)}/image?size=${legacy}&w=${requested}&q=80&format=${format}`;
}
export function viewerImageUrl(id: string, detail = false): string {
  return `${photoImageUrl(id, detail ? 2560 : 1280, "jpeg")}&preview=viewer`;
}

/** Gallery pages can remain open past the lifetime of an R2 signature. */
export function thumbnailUrlIsFresh(url: string, now = Date.now()): boolean {
  const query = new URLSearchParams(url.split("?")[1]);
  const signatureTime = query.get("X-Amz-Date");
  const lifetime = query.get("X-Amz-Expires");
  if (signatureTime === null && lifetime === null) return true;
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(signatureTime ?? "");
  if (!time || !lifetime || !/^\d+$/.test(lifetime)) return false;
  const [, year, month, day, hour, minute, second] = time;
  const signedAt = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return signedAt + Number(lifetime) * 1000 > now + 10_000;
}
export function canPrefetch(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !connection?.saveData && !["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "");
}

type Job = { url: string; resolve: (loaded: boolean) => void; signal: AbortSignal };
const pending: Job[] = [];
let active = 0;
function pump() {
  while (active < 3 && pending.length) {
    const job = pending.shift()!;
    if (job.signal.aborted) { job.resolve(false); continue; }
    active++;
    const image = new Image();
    image.fetchPriority = "low";
    image.referrerPolicy = "no-referrer";
    const done = (loaded: boolean) => {
      image.onload = image.onerror = null;
      active--;
      job.resolve(loaded);
      pump();
    };
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = job.url;
  }
}
/** At most three speculative transfers and 32 queued thumbnails across views.
 * Cancellation removes stale queued work; in-flight image transfers finish so
 * the normal <img> request can reuse/coalesce them in the browser cache. */
export function prefetchImage(url: string, signal: AbortSignal): Promise<boolean> {
  if (!canPrefetch() || signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    if (pending.length >= 32) { resolve(false); return; }
    const job = { url, resolve, signal };
    pending.push(job);
    signal.addEventListener("abort", () => {
      const index = pending.indexOf(job);
      if (index >= 0) { pending.splice(index, 1); resolve(false); }
    }, { once: true });
    pump();
  });
}

// Keep the working source across tile remounts. The browser caches the image bytes.
const thumbnails = new Map<string, { requested: string; loaded: string }>();

export function rememberThumbnail(id: string, requested: string, loaded: string) {
  thumbnails.delete(id);
  thumbnails.set(id, { requested, loaded });
  if (thumbnails.size > 512) thumbnails.delete(thumbnails.keys().next().value!);
}

export function loadedThumbnail(id: string, requested?: string) {
  const thumbnail = thumbnails.get(id);
  if (requested === undefined || requested === thumbnail?.requested || requested === thumbnail?.loaded) {
    return thumbnail?.loaded;
  }
}

export function forgetThumbnail(id: string, url: string) {
  if (thumbnails.get(id)?.loaded === url) thumbnails.delete(id);
}
