import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/backend-url";
import { encryptToken, getSessionFromRequest } from "@/lib/oauth";
import { authOrigin } from "@/lib/social-auth";

const PATH = "/api/auth/passkeys";
const ACTIONS = new Set(["list", "register-options", "register-verify", "login-options", "login-verify", "remove"]);
const COOKIE = { path: PATH, httpOnly: true, sameSite: "strict" as const };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!ACTIONS.has(action)) return json({ detail: "Unknown passkey operation." }, 404);
  const origin = authOrigin(req);
  if (req.headers.get("origin") !== origin) return json({ detail: "Open the configured Kindred sign-in address." }, 403);
  if (!process.env.API_KEY || !process.env.COOKIE_SECRET) return json({ detail: "Passkeys are unavailable on this server." }, 503);

  const login = action.startsWith("login-");
  const cookie = login ? "kindred_passkey_login" : "kindred_passkey_register";
  const secure = origin.startsWith("https:");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": process.env.API_KEY,
    "X-Kindred-Origin": origin,
  };
  if (!login) {
    const session = getSessionFromRequest(req);
    if (!session) return json({ detail: "Sign in to your Kindred account first." }, 401);
    headers["X-Session-Token"] = session.session_token;
  }

  const verifying = action.endsWith("-verify");
  let body = {};
  if (verifying || action === "remove") {
    try {
      const text = await req.text();
      if (text.length > 32_768) return json({ detail: "Passkey response is too large." }, 413);
      const payload = JSON.parse(text);
      if (verifying) {
        const id = req.cookies.get(cookie)?.value;
        if (!id) return json({ detail: "The passkey request expired. Please start again." }, 400);
        body = { challenge_id: id, credential: payload.credential };
      } else {
        body = { credential_id: payload.credential_id };
      }
    } catch {
      return json({ detail: "Invalid passkey response." }, 400);
    }
  }
  try {
    const response = await fetch(`${BACKEND_URL}/auth/passkeys/${action}`, {
      method: "POST", headers, body: JSON.stringify(body), cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status >= 500 || response.status === 404) return json({ detail: "Passkeys are unavailable on this server." }, 503);
      return json({ detail: typeof data.detail === "string" ? data.detail : "Kindred could not verify that passkey." }, response.status);
    }
    if (action === "login-verify") {
      const user = data.user;
      const result = json({ ok: true });
      result.cookies.set("kindred_session", encryptToken({
        session_token: data.session.token, user_id: user.id, username: user.username,
        display_name: user.display_name, role: user.role, auth_method: "passkey",
      }), { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: 2_592_000 });
      result.cookies.set(cookie, "", { ...COOKIE, secure, maxAge: 0 });
      return result;
    }
    if (action.endsWith("-options")) {
      const result = json({ options: data.options });
      result.cookies.set(cookie, data.challenge_id, { ...COOKIE, secure, maxAge: 300 });
      return result;
    }
    const result = json(data);
    if (verifying) result.cookies.set(cookie, "", { ...COOKIE, secure, maxAge: 0 });
    return result;
  } catch {
    return json({ detail: "Kindred could not reach the passkey service." }, 503);
  }
}
