import { NextRequest, NextResponse } from "next/server";
import { oauth, decryptToken, encryptToken } from "@/lib/oauth";

const ACCESS_TOKEN_URL = "https://www.flickr.com/services/oauth/access_token";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const API_KEY = process.env.API_KEY || "";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const oauth_token = searchParams.get("oauth_token");
    const oauth_verifier = searchParams.get("oauth_verifier");

    if (!oauth_token || !oauth_verifier) {
      return NextResponse.json({ error: "Missing oauth_token or oauth_verifier" }, { status: 400 });
    }

    const flickrReqCookie = req.cookies.get("flickr_req");
    if (!flickrReqCookie?.value) {
      return NextResponse.json(
        { error: "Missing request token cookie -- try logging in again" },
        { status: 400 }
      );
    }

    const reqData = decryptToken(flickrReqCookie.value);
    if (!reqData) {
      return NextResponse.json({ error: "Invalid request token cookie" }, { status: 400 });
    }

    const requestData = {
      url: ACCESS_TOKEN_URL,
      method: "POST",
      data: { oauth_verifier },
    };
    const token = { key: oauth_token, secret: reqData.secret };
    const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

    const resp = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: authHeader.Authorization },
    });
    const body = await resp.text();
    const params = new URLSearchParams(body);

    const accessToken = params.get("oauth_token");
    const accessTokenSecret = params.get("oauth_token_secret");
    const userId = params.get("user_nsid");
    const username = params.get("username");
    const fullname = params.get("fullname");

    if (!accessToken) {
      return NextResponse.json({ error: "Failed to get access token", body }, { status: 400 });
    }

    // Check allowlist — if ALLOWED_USERS is set, only those Flickr user IDs may log in
    const allowedUsers = process.env.ALLOWED_USERS;
    if (allowedUsers && userId) {
      const allowList = allowedUsers.split(",").map((id) => id.trim());
      if (!allowList.includes(userId)) {
        const denied = NextResponse.redirect(new URL("/login?error=denied", req.url));
        denied.cookies.set("flickr_req", "", {
          path: "/",
          httpOnly: true,
          secure: true,
          maxAge: 0,
        });
        return denied;
      }
    }

    const tokenData = {
      oauth_token: accessToken,
      oauth_token_secret: accessTokenSecret,
      user_id: userId,
      username,
      fullname,
    };
    const encrypted = encryptToken(tokenData as Record<string, unknown>);

    // Create or login the admin user on the backend
    const backendHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (API_KEY) backendHeaders["X-API-Key"] = API_KEY;

    let backendUser: { user: { id: string; username: string; display_name: string; role: string }; session: { token: string } };

    // Try setup first (first-time admin creation)
    const setupResp = await fetch(`${BACKEND_URL}/auth/setup`, {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify({
        username: username || userId,
        display_name: fullname || username || userId,
        flickr_user_id: userId,
      }),
    });

    if (setupResp.ok) {
      backendUser = await setupResp.json();
    } else {
      // Admin already exists — login instead
      const loginResp = await fetch(`${BACKEND_URL}/auth/flickr-login`, {
        method: "POST",
        headers: backendHeaders,
        body: JSON.stringify({ flickr_user_id: userId }),
      });
      if (!loginResp.ok) {
        const err = await loginResp.json().catch(() => ({}));
        return NextResponse.redirect(
          new URL(`/login?error=${encodeURIComponent((err as Record<string, string>).detail || "auth_failed")}`, req.url)
        );
      }
      backendUser = await loginResp.json();
    }

    // Set the session cookie
    const sessionData = {
      session_token: backendUser.session.token,
      user_id: backendUser.user.id,
      username: backendUser.user.username,
      display_name: backendUser.user.display_name,
      role: backendUser.user.role,
      auth_method: "flickr",
    };
    const encryptedSession = encryptToken(sessionData as Record<string, unknown>);

    const response = NextResponse.redirect(new URL("/", req.url));
    response.cookies.set("flickr_token", encrypted, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 31536000,
    });
    response.cookies.set("kindred_session", encryptedSession, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 2592000, // 30 days
    });
    response.cookies.set("flickr_req", "", {
      path: "/",
      httpOnly: true,
      secure: true,
      maxAge: 0,
    });

    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
