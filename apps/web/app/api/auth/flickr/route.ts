import { ACCOUNT_BACKEND_URL } from "@/lib/backend-url";
import { NextRequest, NextResponse } from "next/server";
import { oauth, encryptToken, getSessionFromRequest } from "@/lib/oauth";

const REQUEST_TOKEN_URL = "https://www.flickr.com/services/oauth/request_token";
const AUTHORIZE_URL = "https://www.flickr.com/services/oauth/authorize";

export async function GET(req: NextRequest) {
  try {
    const integration = req.nextUrl.searchParams.get("integration") === "1";
    const session = getSessionFromRequest(req);
    if (integration) {
      if (!session) return NextResponse.redirect(new URL("/login", req.url));
      const me = await fetch(`${ACCOUNT_BACKEND_URL}/auth/me`, {
        headers: { "X-Session-Token": session.session_token }, cache: "no-store" });
      if (!me.ok || (await me.json()).role !== "admin") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
    }
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const callbackUrl = `${proto}://${host}/api/auth/callback`;

    const requestData = {
      url: REQUEST_TOKEN_URL,
      method: "POST",
      data: { oauth_callback: callbackUrl },
    };

    const authHeader = oauth.toHeader(oauth.authorize(requestData));

    const resp = await fetch(REQUEST_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: authHeader.Authorization },
    });
    const body = await resp.text();
    const params = new URLSearchParams(body);

    if (!resp.ok || params.get("oauth_callback_confirmed") !== "true" || !params.get("oauth_token") || !params.get("oauth_token_secret")) {
      return NextResponse.json({ error: "Failed to get request token", body }, { status: 400 });
    }

    const requestToken = params.get("oauth_token");
    const requestTokenSecret = params.get("oauth_token_secret");

    const encrypted = encryptToken({ secret: requestTokenSecret, request_token: requestToken, integration, user_id: session?.user_id });

    const response = NextResponse.redirect(
      `${AUTHORIZE_URL}?oauth_token=${requestToken}&perms=${integration ? "write" : "delete"}`
    );
    response.cookies.set("flickr_req", encrypted, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
    });

    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
