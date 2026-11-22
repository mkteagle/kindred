import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decryptToken } from "@/lib/oauth";

export function proxy(request: NextRequest) {
  const session = request.cookies.get("kindred_session");
  const flickrToken = request.cookies.get("flickr_token");
  const { pathname } = request.nextUrl;

  if (pathname === "/" && session?.value && decryptToken(session.value)?.session_token) {
    const response = NextResponse.redirect(new URL("/gallery", request.url));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  // Allow: landing page, demo, login, join, reset, API routes, docs, static files
  if (
    pathname === "/" ||
    pathname === "/demo" ||
    pathname.startsWith("/demo/") ||
    pathname === "/login" ||
    pathname === "/pair" ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/reset") ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/screenshots") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".webp")
  ) {
    return NextResponse.next();
  }

  // Allow if either session cookie or legacy flickr token exists
  if (!session && !flickrToken) {
    const login = new URL("/login", request.url);
    if (pathname === "/settings/integrations") login.searchParams.set("return", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
