import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/oauth";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const API_KEY = process.env.API_KEY || "";

async function handleRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const pathStr = path.join("/");
    const queryString = req.nextUrl.search;
    const url = `${BACKEND_URL}/${pathStr}${queryString}`;

    const headers: Record<string, string> = {};
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    // Forward session token from cookie to backend
    const session = getSessionFromRequest(req);
    if (session?.session_token) {
      headers["X-Session-Token"] = session.session_token;
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
    if (contentType.startsWith("image/") || contentType.startsWith("application/octet-stream")) {
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
