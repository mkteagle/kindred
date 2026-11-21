import { ACCOUNT_BACKEND_URL } from "@/lib/backend-url";
import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.API_KEY || "";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    // Forward to backend reset endpoint (if it exists)
    const resp = await fetch(`${ACCOUNT_BACKEND_URL}/auth/reset`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }).catch(() => null);

    // Always return 200 to prevent email enumeration
    // Even if the backend endpoint doesn't exist yet
    return NextResponse.json({ ok: true });
  } catch {
    // Still return 200 — never reveal whether the email exists
    return NextResponse.json({ ok: true });
  }
}
