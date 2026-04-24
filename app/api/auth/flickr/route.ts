import { NextRequest, NextResponse } from "next/server";
import { oauth, encryptToken } from "@/lib/oauth";

const REQUEST_TOKEN_URL = "https://www.flickr.com/services/oauth/request_token";
const AUTHORIZE_URL = "https://www.flickr.com/services/oauth/authorize";

export async function GET(req: NextRequest) {
  try {
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

    if (!params.get("oauth_callback_confirmed")) {
      return NextResponse.json({ error: "Failed to get request token", body }, { status: 400 });
    }

    const requestToken = params.get("oauth_token");
    const requestTokenSecret = params.get("oauth_token_secret");

    const encrypted = encryptToken({ secret: requestTokenSecret });

    const response = NextResponse.redirect(
      `${AUTHORIZE_URL}?oauth_token=${requestToken}&perms=delete`
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
