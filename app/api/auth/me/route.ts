import { NextRequest, NextResponse } from "next/server";
import { getTokenFromRequest } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return NextResponse.json({ loggedIn: false });
  }
  return NextResponse.json({
    loggedIn: true,
    userId: token.user_id,
    username: token.username,
    fullname: token.fullname,
  });
}
