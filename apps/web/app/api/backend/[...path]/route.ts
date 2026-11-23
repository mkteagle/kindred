import { createHash } from "node:crypto";
import { BACKEND_URL, CATALOG_BACKEND_URL, catalogRequest, isR2ThumbnailRedirect, isThumbnailRequest } from "@/lib/backend-url";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/oauth";

const API_KEY = process.env.API_KEY || "";
const GALLERY_THUMBNAIL_CACHE = "private, max-age=86400";

/**
 * Paths reachable without a Kindred session.
 *
 * Everything else requires one. This gate matters because API_KEY authenticates
 * to the backend as an admin: forwarding it on an unauthenticated request would
 * make this proxy an open, admin-level door to the entire backend.
 *
 * Public paths are forwarded WITHOUT the API key. They are public at the
 * backend too — share links carry their own scoped capability, which the
 * backend validates itself — so they need no ambient privilege from here.
 */
const PUBLIC_PATHS: RegExp[] = [
  /^public\/shares\/[^/]+(\/.*)?$/, // share links: capability in the token
  /^app-config$/,
  /^health$/,
  /^auth\/(login|register|setup|flickr-login)$/,
];

function isPublicPath(pathStr: string): boolean {
  return PUBLIC_PATHS.some((pattern) => pattern.test(pathStr));
}

function thumbnailScope(sessionToken: string) {
  return createHash("sha256").update("kindred-gallery-thumbnail-v1\0").update(sessionToken).digest("base64url").slice(0, 22);
}

async function fetchThumbnailObject(location: string, req: NextRequest) {
  const headers = new Headers();
  const etag = req.headers.get("if-none-match");
  if (etag) headers.set("If-None-Match", etag);
  try {
    const response = await fetch(location, { headers, cache: "no-store", redirect: "manual", signal: req.signal });
    if (response.status === 304 || (response.status === 200 && response.headers.get("content-type") === "image/jpeg")) {
      return response;
    }
    await response.body?.cancel();
  } catch (error) {
    if (req.signal.aborted) throw error;
  }
}

async function handleRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const pathStr = path.join("/");
    if (req.method === "POST" && pathStr.startsWith("auth/account/") &&
        (req.headers.get("X-Kindred-Account-Action") !== "1" || !req.headers.get("content-type")?.startsWith("application/json"))) {
      return NextResponse.json({ detail: "Open Kindred account settings to continue." }, { status: 403 });
    }
    const queryString = req.nextUrl.search;
    const thumbnail = req.method === "GET" && isThumbnailRequest(pathStr, req.nextUrl.searchParams);
    const previewQuery = req.nextUrl.searchParams;
    const galleryThumbnail = thumbnail && previewQuery.get("preview") === "gallery";
    const viewerPreview = req.method === "GET" && /^photos\/[^/]+\/image$/.test(pathStr)
      && previewQuery.get("preview") === "viewer"
      && previewQuery.get("size") === "h" && previewQuery.get("format") === "jpeg"
      && ["1280", "2560"].includes(previewQuery.get("w") ?? "");
    const catalog = CATALOG_BACKEND_URL && CATALOG_BACKEND_URL !== BACKEND_URL &&
      catalogRequest(req.method, pathStr, req.nextUrl.searchParams)
      ? CATALOG_BACKEND_URL
      : null;
    const suffix = `/${pathStr}${queryString}`;

    // A segment of ".." could normalise past the public allowlist once fetch()
    // resolves the URL, so refuse it outright rather than reasoning about it.
    if (path.some((segment) => segment === "." || segment === "..")) {
      return NextResponse.json({ detail: "Invalid path" }, { status: 400 });
    }

    const headers: Record<string, string> = {};
    const session = getSessionFromRequest(req);
    const publicPath = isPublicPath(pathStr);

    if (!publicPath && !session?.session_token) {
      // Refuse rather than fall back to the API key, which would authenticate
      // an anonymous caller to the backend as an admin.
      return NextResponse.json({ detail: "Authentication required" }, { status: 401 });
    }

    if (galleryThumbnail && (!session?.session_token || previewQuery.get("scope") !== thumbnailScope(session.session_token))) {
      return NextResponse.json({ detail: "Invalid thumbnail session" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    }

    if (!publicPath) {
      if (API_KEY) headers["X-API-Key"] = API_KEY;
      if (session?.session_token) headers["X-Session-Token"] = session.session_token;
    }

    // Media playback is built on byte ranges: the browser asks for part of a
    // video to start, and again on every seek. These must reach the backend or
    // <video> cannot seek and Safari will not play at all.
    for (const header of ["range", "if-range", "accept", "if-none-match"]) {
      const value = req.headers.get(header);
      if (value) headers[header] = value;
    }

    // Forward integration secrets (e.g., Resend API key)
    const integrationSecret = req.headers.get("X-Integration-Secret");
    if (integrationSecret) {
      headers["X-Integration-Secret"] = integrationSecret;
    }

    const opts: RequestInit = {
      method: req.method,
      cache: "no-store",
      headers,
      signal: req.signal,
      redirect: thumbnail ? "manual" : "follow",
    };

    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      const reqContentType = req.headers.get("content-type") || "";
      const uploadChunk = req.method === "PUT" && /^uploads\/resumable\/[^/]+$/.test(pathStr)
        && reqContentType === "application/octet-stream";
      if (reqContentType.includes("multipart/form-data") || uploadChunk) {
        // Preserve upload bytes and the browser's multipart boundary.
        headers["Content-Type"] = reqContentType;
        opts.body = await req.arrayBuffer();
      } else {
        headers["Content-Type"] = "application/json";
        opts.body = await req.text();
      }
    } else {
      headers["Content-Type"] = "application/json";
    }

    let backendResp: Response | undefined;
    if (thumbnail && catalog) {
      try {
        backendResp = await fetch(`${catalog}${suffix}`, opts);
      } catch (error) {
        if (req.signal.aborted) throw error;
      }
      if (backendResp && [404, 422, 502, 503, 504].includes(backendResp.status)) {
        await backendResp.body?.cancel();
        backendResp = undefined;
      }
    }
    const fromCatalog = !!backendResp;
    backendResp ??= await fetch(`${thumbnail ? BACKEND_URL : catalog || BACKEND_URL}${suffix}`, opts);
    if (thumbnail && backendResp.status === 307) {
      const location = backendResp.headers.get("location");
      if (!isR2ThumbnailRedirect(location)) {
        return NextResponse.json({ detail: "Invalid thumbnail location" }, { status: 502 });
      }
      if (!galleryThumbnail) {
        return new NextResponse(null, {
          status: 307,
          headers: {
            Location: location!,
            "Cache-Control": "private, max-age=120",
            Vary: "Cookie",
            "Referrer-Policy": "no-referrer",
          },
        });
      }
      await backendResp.body?.cancel();
      let image = await fetchThumbnailObject(location!, req);
      if (!image && fromCatalog) {
        const nas = await fetch(`${BACKEND_URL}${suffix}`, opts);
        if (nas.status !== 307) image = nas;
        else await nas.body?.cancel();
      }
      if (!image) return NextResponse.json({ detail: "Thumbnail unavailable" }, { status: 502 });
      backendResp = image;
    }

    // Check if response is binary (image, etc.) — don't try to parse as JSON
    const contentType = backendResp.headers.get("content-type") || "";
    const isBinary =
      contentType.startsWith("image/") ||
      contentType.startsWith("video/") ||
      contentType.startsWith("audio/") ||
      contentType.startsWith("text/event-stream") ||
      contentType.startsWith("application/octet-stream");

    if (isBinary || backendResp.status === 304 || backendResp.status === 206 || backendResp.status === 416) {
      // Stream rather than buffer: a full-length video through arrayBuffer()
      // would be held in this process's memory in its entirety.
      const cacheViewerPreview = viewerPreview && (backendResp.status === 304 ||
        (backendResp.status === 200 && contentType.startsWith("image/jpeg")));
      const cacheGalleryThumbnail = galleryThumbnail && (backendResp.status === 304 ||
        (backendResp.status === 200 && /^image\/(?:jpeg|webp|png|avif)(?:;|$)/i.test(contentType)));
      const passthrough: Record<string, string> = {
        "Cache-Control": galleryThumbnail ? (cacheGalleryThumbnail ? GALLERY_THUMBNAIL_CACHE : "private, no-store") :
          cacheViewerPreview ? "private, max-age=300" :
          backendResp.headers.get("cache-control") || (thumbnail ? "private, no-store" : "private, max-age=3600"),
      };
      if (contentType) passthrough["Content-Type"] = contentType;
      // Range answers are meaningless without these, and a 206 whose
      // Content-Range is dropped makes the player fail in confusing ways.
      for (const header of ["accept-ranges", "content-range", "content-length", "content-disposition", "etag", "vary", "x-content-type-options", "x-accel-buffering"]) {
        const value = backendResp.headers.get(header);
        if (value) passthrough[header] = value;
      }
      if ((thumbnail || cacheViewerPreview) && !passthrough["vary"]?.split(",").some(field => field.trim().toLowerCase() === "cookie")) {
        passthrough["vary"] = [passthrough["vary"], "Cookie"].filter(Boolean).join(", ");
      }
      return new NextResponse(backendResp.status === 304 ? null : backendResp.body, {
        status: backendResp.status,
        headers: passthrough,
      });
    }

    const data = await backendResp.json();
    const responseHeaders = new Headers();
    if (galleryThumbnail) responseHeaders.set("Cache-Control", "private, no-store");
    if (pathStr === "library/photos") {
      responseHeaders.set("Cache-Control", "private, no-store");
      if (backendResp.ok && session?.session_token) {
        responseHeaders.set("X-Kindred-Thumbnail-Scope", thumbnailScope(session.session_token));
      }
    }
    return NextResponse.json(data, {
      status: backendResp.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Backend unreachable: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
