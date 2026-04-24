import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const session = request.cookies.get("kindred_session");
  const flickrToken = request.cookies.get("flickr_token");
  const { pathname } = request.nextUrl;

  // Allow: landing page, login, join, API routes, docs, static files
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/join" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
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
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
