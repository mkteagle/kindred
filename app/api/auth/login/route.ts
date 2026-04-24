import { NextRequest, NextResponse } from "next/server";
import { encryptToken } from "@/lib/oauth";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const API_KEY = process.env.API_KEY || "";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    const resp = await fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json(data, { status: resp.status });
    }

    // Set session cookie
    const sessionData = {
      session_token: data.session.token,
      user_id: data.user.id,
      username: data.user.username,
      display_name: data.user.display_name,
      role: data.user.role,
      auth_method: "password",
    };
    const encrypted = encryptToken(sessionData as Record<string, unknown>);

    const response = NextResponse.json({ user: data.user });
    response.cookies.set("kindred_session", encrypted, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 2592000,
    });
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
