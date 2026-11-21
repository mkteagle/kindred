import { BACKEND_URL } from "@/lib/backend-url";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getTokenFromRequest } from "@/lib/oauth";


export async function GET(req: NextRequest) {
  // Try session cookie first (new household auth)
  const session = getSessionFromRequest(req);
  if (session) {
    // Fetch fresh user data from backend to get avatar_url and other dynamic fields
    try {
      const backendResp = await fetch(`${BACKEND_URL}/auth/me`, {
        headers: { "X-Session-Token": session.session_token },
      });
      if (backendResp.status === 401 || backendResp.status === 403) return NextResponse.json({ loggedIn: false });
      if (backendResp.ok) {
        const data = await backendResp.json();
        if (data.loggedIn) {
          return NextResponse.json(data);
        }
      }
    } catch {
      // Fall through to cookie-based response if backend is unreachable
    }
    return NextResponse.json({
      loggedIn: true,
      userId: session.user_id,
      username: session.username,
      fullname: session.display_name,
      display_name: session.display_name,
      role: session.role,
      auth_method: session.auth_method,
    });
  }

  // Fall back to legacy flickr_token cookie (migration path)
  const token = getTokenFromRequest(req);
  if (token) {
    return NextResponse.json({
      loggedIn: true,
      userId: token.user_id,
      username: token.username,
      fullname: token.fullname,
      role: "admin",
      auth_method: "flickr",
    });
  }

  return NextResponse.json({ loggedIn: false });
}
