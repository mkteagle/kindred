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

    const headers: Record<string, string> = { "Content-Type": "application/json" };
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
      opts.body = await req.text();
    }

    const backendResp = await fetch(url, opts);
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
