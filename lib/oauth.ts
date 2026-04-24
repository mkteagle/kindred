import OAuth from "oauth-1.0a";
import crypto from "crypto";
import { cookies } from "next/headers";

const CONSUMER_KEY = process.env.FLICKR_API_KEY!;
const CONSUMER_SECRET = process.env.FLICKR_SECRET!;

export const oauth = new (OAuth as any)({
  consumer: { key: CONSUMER_KEY, secret: CONSUMER_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(baseString: string, key: string) {
    return crypto.createHmac("sha1", key).update(baseString).digest("base64");
  },
});

export const consumer = { key: CONSUMER_KEY, secret: CONSUMER_SECRET };

const COOKIE_SECRET = process.env.COOKIE_SECRET || "";

export function encryptToken(data: Record<string, unknown>): string {
  const text = JSON.stringify(data);
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(COOKIE_SECRET, "salt", 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptToken(encoded: string): Record<string, string> | null {
  try {
    const [ivHex, encrypted] = encoded.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const key = crypto.scryptSync(COOKIE_SECRET, "salt", 32);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

export function parseCookiesFromHeader(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  cookieHeader.split(";").forEach((c) => {
    const [name, ...rest] = c.trim().split("=");
    if (name) result[name] = decodeURIComponent(rest.join("="));
  });
  return result;
}

export function getTokenFromRequest(req: Request): Record<string, string> | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const parsed = parseCookiesFromHeader(cookieHeader);
  if (!parsed.flickr_token) return null;
  return decryptToken(parsed.flickr_token);
}

export async function getTokenFromCookieStore(): Promise<Record<string, string> | null> {
  const cookieStore = await cookies();
  const flickrToken = cookieStore.get("flickr_token");
  if (!flickrToken?.value) return null;
  return decryptToken(flickrToken.value);
}

export function signedFlickrUrl(
  method: string,
  params: Record<string, string | number>,
  token: { oauth_token: string; oauth_token_secret: string }
): { url: string; headers: Record<string, string> } {
  const url = "https://api.flickr.com/services/rest";
  const allParams: Record<string, string> = {
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    method,
    format: "json",
    nojsoncallback: "1",
  };

  const requestData = { url, method: "GET", data: allParams };
  const tokenPair = { key: token.oauth_token, secret: token.oauth_token_secret };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, tokenPair));

  const qs = new URLSearchParams(allParams).toString();
  return { url: `${url}?${qs}`, headers: { Authorization: authHeader.Authorization } };
}
