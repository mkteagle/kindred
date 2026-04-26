import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/oauth";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const API_KEY = process.env.API_KEY || "";

/**
 * GET /api/auth/logout — redirect to login instead of processing logout.
 * Logout must be POST-only to prevent CSRF via <img src="/api/auth/logout">.
 */
export async function GET() {
  return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_URL || "http://localhost:3000"));
}

export async function POST(req: NextRequest) {
  // Invalidate backend session
  const session = getSessionFromRequest(req);
  if (session?.session_token) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    headers["X-Session-Token"] = session.session_token;
    await fetch(`${BACKEND_URL}/auth/logout`, { method: "POST", headers }).catch(() => {});
  }

  const response = NextResponse.json({ ok: true });
  // Clear all auth cookies
  for (const name of ["flickr_token", "flickr_req", "kindred_session"]) {
    response.cookies.set(name, "", { path: "/", httpOnly: true, secure: true, maxAge: 0 });
  }
  return response;
}
