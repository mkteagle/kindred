import { connection, NextResponse } from "next/server";
import { providerEnabled } from "@/lib/social-auth";

export async function GET() {
  await connection();
  return NextResponse.json(
    { google: providerEnabled("google"), apple: providerEnabled("apple") },
    { headers: { "Cache-Control": "no-store" } },
  );
}
