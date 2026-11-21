import { NextResponse } from "next/server";
import { providerEnabled } from "@/lib/social-auth";

export function GET() { return NextResponse.json({ google: providerEnabled("google"), apple: providerEnabled("apple") }, { headers: { "Cache-Control": "no-store" } }); }
