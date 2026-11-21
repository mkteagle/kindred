export const BACKEND_URL =
  process.env.BACKEND_URL?.trim().replace(/(?:\\[rn])+$/, "").trim().replace(/\/+$/, "") ||
  "http://localhost:8000";

export const CATALOG_BACKEND_URL = process.env.KINDRED_CATALOG_BACKEND_URL?.trim().replace(/\/+$/, "");
export const ACCOUNT_BACKEND_URL = CATALOG_BACKEND_URL || BACKEND_URL;

export function isThumbnailRequest(path: string, query: URLSearchParams) {
  if (!/^photos\/[^/]+\/(?:image|local)$/.test(path)) return false;
  if (query.get("format") && !["auto", "jpeg"].includes(query.get("format")!)) return false;
  if (path.endsWith("/local")) return query.get("variant") === "thumb";
  if (query.get("size") === "o") return false;
  const width = query.get("w");
  return width !== null
    ? ["160", "320", "480", "640", "960"].includes(width)
    : ["s", "q", "t", "m", "n", "z"].includes(query.get("size") || "");
}

const CATALOG_READ = /^(?:health|app-config|stats|locations|albums(?:\/[^/]+)?|favorites(?:\/count)?|library\/(?:photos|years|counts|day-labels|junk-settings)|photos\/[^/]+\/(?:metadata|detections)|clusters\/(?:named|[^/]+\/summary))$/;

export function catalogRequest(method: string, path: string, query: URLSearchParams) {
  if (path.startsWith("auth/")) return true;
  if (/^photos\/[^/]+\/favorite$/.test(path) && ["PUT", "DELETE"].includes(method)) return true;
  if (path === "library/junk-settings" && method === "PATCH") return true;
  if (method === "PUT" && /^photos\/[^/]+\/keep-in-library$/.test(path)) return true;
  if (method !== "GET") return false;
  if (path === "search") return query.get("mode") === "quick" || !query.get("q");
  return CATALOG_READ.test(path) || isThumbnailRequest(path, query);
}

export function isR2ThumbnailRedirect(location: string | null) {
  if (!location) return false;
  try {
    const url = new URL(location);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) &&
      /^\/[^/]+\/thumbnails\/v1\/[0-9a-f-]+\.jpg$/.test(url.pathname) &&
      url.searchParams.has("X-Amz-Signature");
  } catch {
    return false;
  }
}
