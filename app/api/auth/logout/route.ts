import { NextResponse } from "next/server";

export async function GET() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("flickr_token", "", {
    path: "/",
    httpOnly: true,
    secure: true,
    maxAge: 0,
  });
  response.cookies.set("flickr_req", "", {
    path: "/",
    httpOnly: true,
    secure: true,
    maxAge: 0,
  });
  return response;
}

export async function POST() {
  return GET();
}
