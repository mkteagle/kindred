import { NextRequest, NextResponse } from "next/server";
import { getTokenFromRequest } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  return NextResponse.json({
    oauth_token: token.oauth_token,
    oauth_token_secret: token.oauth_token_secret,
    user_id: token.user_id,
    username: token.username,
  });
}
