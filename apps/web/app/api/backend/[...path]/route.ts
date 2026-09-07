import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/oauth";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const API_KEY = process.env.API_KEY || "";

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

async function handleRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const pathStr = path.join("/");
    const queryString = req.nextUrl.search;
    const url = `${BACKEND_URL}/${pathStr}${queryString}`;

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

    if (!publicPath) {
      if (API_KEY) headers["X-API-Key"] = API_KEY;
      if (session?.session_token) headers["X-Session-Token"] = session.session_token;
    }

    // Forward integration secrets (e.g., Resend API key)
    const integrationSecret = req.headers.get("X-Integration-Secret");
    if (integrationSecret) {
      headers["X-Integration-Secret"] = integrationSecret;
    }

    const opts: RequestInit = {
      method: req.method,
      headers,
    };

    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      const reqContentType = req.headers.get("content-type") || "";
      if (reqContentType.includes("multipart/form-data")) {
        // Forward multipart body as-is (browser sets boundary in content-type)
        headers["Content-Type"] = reqContentType;
        opts.body = await req.arrayBuffer();
      } else {
        headers["Content-Type"] = "application/json";
        opts.body = await req.text();
      }
    } else {
      headers["Content-Type"] = "application/json";
    }

    const backendResp = await fetch(url, opts);

    // Check if response is binary (image, etc.) — don't try to parse as JSON
    const contentType = backendResp.headers.get("content-type") || "";
    if (
      contentType.startsWith("image/") ||
      contentType.startsWith("video/") ||
      contentType.startsWith("application/octet-stream")
    ) {
      const buffer = await backendResp.arrayBuffer();
      return new NextResponse(buffer, {
        status: backendResp.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": backendResp.headers.get("cache-control") || "private, max-age=3600",
        },
      });
    }

    const data = await backendResp.json();
    return NextResponse.json(data, { status: backendResp.status });
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
