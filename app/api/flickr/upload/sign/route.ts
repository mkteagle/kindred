import { NextRequest, NextResponse } from "next/server";
import { oauth, getTokenFromRequest } from "@/lib/oauth";

/**
 * Signs a Flickr upload request so the browser can POST directly to up.flickr.com.
 *
 * The photo file is NOT included in the OAuth signature base string — only
 * OAuth params and text params (title, description, tags) are signed.
 */
export async function POST(req: NextRequest) {
  try {
    const token = getTokenFromRequest(req);
    if (!token?.oauth_token || !token?.oauth_token_secret) {
      return NextResponse.json(
        { error: "Not authenticated — connect Flickr first" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { title, description, tags } = body as {
      title?: string;
      description?: string;
      tags?: string;
    };

    // Build the params that go into the signature (text params only, NO photo)
    const uploadUrl = "https://up.flickr.com/services/upload/";
    const textParams: Record<string, string> = {};
    if (title) textParams.title = title;
    if (description) textParams.description = description;
    if (tags) textParams.tags = tags;

    const requestData = {
      url: uploadUrl,
      method: "POST" as const,
      data: textParams,
    };

    const tokenPair = {
      key: token.oauth_token,
      secret: token.oauth_token_secret,
    };

    // oauth.authorize() returns the OAuth params including the computed signature
    const authorized = oauth.authorize(requestData, tokenPair);

    // Return all the OAuth params the browser needs to include in the multipart form
    return NextResponse.json({
      oauth_consumer_key: authorized.oauth_consumer_key,
      oauth_token: authorized.oauth_token,
      oauth_signature: authorized.oauth_signature,
      oauth_signature_method: authorized.oauth_signature_method,
      oauth_timestamp: authorized.oauth_timestamp,
      oauth_nonce: authorized.oauth_nonce,
      oauth_version: authorized.oauth_version,
      // Also return the text params so the browser can include them
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(tags ? { tags } : {}),
    });
  } catch (err) {
    console.error("Upload sign error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
