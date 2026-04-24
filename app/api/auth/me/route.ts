import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getTokenFromRequest } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  // Try session cookie first (new household auth)
  const session = getSessionFromRequest(req);
  if (session) {
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
