import { BACKEND } from "@/lib/constants";

export const IMAGE_WIDTHS = [160, 320, 480, 640, 960, 1280, 1600, 2048, 2560] as const;
export function imageWidth(pixels: number, maximum = 2560): number {
  return IMAGE_WIDTHS.find(w => w >= Math.min(maximum, pixels)) ?? maximum;
}
export function photoImageUrl(id: string, width: number): string {
  const requested = imageWidth(width);
  // Older NAS releases ignore w/q/format. Keep a safe legacy size so a web
  // deployment can never turn grid requests into default 2048px previews.
  const legacy = requested <= 960 ? "n" : "h";
  return `${BACKEND}/photos/${encodeURIComponent(id)}/image?size=${legacy}&w=${requested}&q=80&format=auto`;
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

// Remember the thumbnail actually displayed, so opening a tile can reuse it.
const displayed = new Map<string, { url: string; aspect: number }>();
export function rememberThumbnail(id: string, url: string, width: number, height: number) {
  displayed.delete(id);
  displayed.set(id, { url, aspect: width / height });
  if (displayed.size > 200) displayed.delete(displayed.keys().next().value!);
}
export function loadedThumbnail(id: string) { return displayed.get(id)?.url; }

export function thumbnailAspect(id: string) { return displayed.get(id)?.aspect; }
