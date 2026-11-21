import crypto from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { decryptToken, encryptToken, getSessionFromRequest } from "./oauth";
import { BACKEND_URL } from "./backend-url";

export type SocialProvider = "google" | "apple";
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const APPLE_CALLBACK = "/api/auth/apple/callback";
const APPLE_HANDOFF = "kindred_apple_handoff";

export function providerEnabled(provider: SocialProvider) {
  const common = Boolean(process.env.COOKIE_SECRET && process.env.API_KEY);
  return common && (provider === "google" ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    : Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY));
}
export function safeReturnPath(value: string | null | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/[\u0000-\u0020\u007f]/.test(value) ? value : "/gallery";
}
export function authOrigin(req: NextRequest) {
  return new URL(process.env.AUTH_ORIGIN?.trim() || req.url).origin;
}
function cookieName(provider: SocialProvider) { return `kindred_oauth_${provider}`; }

export async function beginSocialAuth(req: NextRequest, provider: SocialProvider) {
  const origin = authOrigin(req);
  if (!providerEnabled(provider)) return NextResponse.redirect(new URL("/login?error=provider_unavailable", origin));
  const url = new URL(origin);
  if (provider === "apple" && (url.protocol !== "https:" || url.hostname === "localhost" || !url.hostname.includes("."))) {
    return NextResponse.redirect(new URL("/login?error=apple_requires_https", origin));
  }
  // Set the state cookie on the same host that will receive the callback.
  const requestHost = req.headers.get("host") || req.nextUrl.host;
  if (requestHost !== url.host && req.nextUrl.host !== url.host) {
    return NextResponse.redirect(new URL(`/api/auth/${provider}${req.nextUrl.search}`, origin));
  }
  const redirectUri = `${origin}/api/auth/${provider}/callback`;
  const state = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const session = getSessionFromRequest(req);
  const link = req.nextUrl.searchParams.get("link") === "1";
  if (link && !session) return NextResponse.redirect(new URL("/login", origin));
  const flow = { state, nonce, verifier, redirectUri, origin, expires: Date.now() + 600_000,
    returnPath: link ? "/settings/integrations" : safeReturnPath(req.nextUrl.searchParams.get("return")),
    invite_code: req.nextUrl.searchParams.get("invite") || undefined,
    link_user_id: link ? session?.user_id : undefined,
    link_session_token: link ? session?.session_token : undefined };
  const params = new URLSearchParams({ client_id: provider === "google" ? process.env.GOOGLE_CLIENT_ID! : process.env.APPLE_CLIENT_ID!,
    redirect_uri: redirectUri, response_type: "code", scope: provider === "google" ? "openid email profile" : "name email", state, nonce });
  if (provider === "google") {
    params.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url"));
    params.set("code_challenge_method", "S256");
    params.set("prompt", "select_account");
  } else params.set("response_mode", "form_post");
  const response = NextResponse.redirect(`${provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://appleid.apple.com/auth/authorize"}?${params}`);
  response.cookies.set(cookieName(provider), encryptToken(flow), { path: "/", httpOnly: true,
    secure: origin.startsWith("https:"), sameSite: "lax", maxAge: 600 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function appleSecret() {
  const key = await importPKCS8(process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n").trim(), "ES256");
  return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_KEY_ID! })
    .setIssuer(process.env.APPLE_TEAM_ID!).setSubject(process.env.APPLE_CLIENT_ID!)
    .setAudience("https://appleid.apple.com").setIssuedAt().setExpirationTime("5m").sign(key);
}

export async function beginAppleCallback(req: NextRequest) {
  const origin = authOrigin(req);
  if (!providerEnabled("apple")) return NextResponse.redirect(new URL("/login?error=provider_unavailable", origin), { status: 303 });
  const body = await req.text();
  if (body.length > 8192) return new NextResponse(null, { status: 413 });
  const values = new URLSearchParams(body);
  const state = values.get("state");
  const code = values.get("code");
  const error = values.get("error");
  if (!state || state.length > 128 || (code?.length ?? 0) > 1200 || (error?.length ?? 0) > 100) {
    return NextResponse.redirect(new URL("/login?error=oauth_state", origin), { status: 303 });
  }
  // Apple's cross-site POST may omit first-party Lax cookies. Keep the code
  // out of the URL and validate state on the top-level GET that follows.
  const response = NextResponse.redirect(new URL(APPLE_CALLBACK, origin), { status: 303 });
  response.cookies.set(APPLE_HANDOFF, encryptToken({ state, code, error, expires: Date.now() + 90_000 }),
    { path: APPLE_CALLBACK, httpOnly: true, secure: true, sameSite: "lax", maxAge: 90 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function finishSocialAuth(req: NextRequest, provider: SocialProvider) {
  const saved = req.cookies.get(cookieName(provider))?.value;
  const flow = saved?.startsWith("v2:") ? decryptToken(saved) : null;
  const origin = authOrigin(req);
  const clearFlow = (response: NextResponse) => {
    response.cookies.delete(cookieName(provider));
    if (provider === "apple") response.cookies.set(APPLE_HANDOFF, "", { path: APPLE_CALLBACK, maxAge: 0, secure: true });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const fail = (code: string) => {
    const target = flow?.link_user_id ? `/settings/integrations?error=${encodeURIComponent(code)}` : `/login?error=${encodeURIComponent(code)}`;
    const response = NextResponse.redirect(new URL(target, origin), { status: 303 });
    return clearFlow(response);
  };
  try {
    if (!flow || !providerEnabled(provider) || !(Number(flow.expires) > Date.now())) return fail("oauth_expired");
    let values = req.nextUrl.searchParams;
    if (provider === "apple") {
      const handoff = req.cookies.get(APPLE_HANDOFF)?.value;
      const result = handoff?.startsWith("v2:") ? decryptToken(handoff) : null;
      if (!result || !(Number(result.expires) > Date.now())) return fail("oauth_expired");
      values = new URLSearchParams({ state: result.state || "", code: result.code || "", error: result.error || "" });
    }
    if (!values.get("state") || values.get("state") !== flow.state || flow.origin !== origin) return fail("oauth_state");
    if (values.get("error")) return fail(values.get("error") === "access_denied" ? "oauth_cancelled" : "oauth_provider");
    const code = values.get("code");
    if (!code) return fail("oauth_failed");
    const tokenBody = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: flow.redirectUri,
      client_id: provider === "google" ? process.env.GOOGLE_CLIENT_ID! : process.env.APPLE_CLIENT_ID!,
      client_secret: provider === "google" ? process.env.GOOGLE_CLIENT_SECRET! : await appleSecret() });
    if (provider === "google") tokenBody.set("code_verifier", flow.verifier);
    const tokenResponse = await fetch(provider === "google" ? "https://oauth2.googleapis.com/token" : "https://appleid.apple.com/auth/token", {
      method: "POST", body: tokenBody, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!tokenResponse.ok) {
      console.warn(`[auth] ${provider} token exchange failed (HTTP ${tokenResponse.status})`);
      return fail("oauth_exchange");
    }
    const tokens = await tokenResponse.json();
    if (typeof tokens.id_token !== "string") return fail("oauth_failed");
    const { payload } = await jwtVerify(tokens.id_token, provider === "google" ? googleKeys : appleKeys, {
      issuer: provider === "google" ? ["https://accounts.google.com", "accounts.google.com"] : "https://appleid.apple.com",
      audience: provider === "google" ? process.env.GOOGLE_CLIENT_ID! : process.env.APPLE_CLIENT_ID!, algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat", "nonce"], maxTokenAge: "10m" });
    if (!payload.sub || payload.nonce !== flow.nonce) return fail("oauth_failed");
    const verifiedEmail = payload.email_verified === true || payload.email_verified === "true";
    const assertion = await new SignJWT({ provider, email: verifiedEmail ? payload.email : undefined, email_verified: verifiedEmail,
      name: typeof payload.name === "string" ? payload.name : undefined,
      link_user_id: flow.link_user_id || undefined, invite_code: flow.invite_code || undefined })
      .setProtectedHeader({ alg: "HS256" }).setIssuer("kindred-web").setAudience("kindred-backend")
      .setSubject(payload.sub).setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime("60s")
      .sign(new TextEncoder().encode(process.env.API_KEY!));
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-API-Key": process.env.API_KEY! };
    if (flow.link_session_token) headers["X-Session-Token"] = flow.link_session_token;
    let result: Response;
    try {
      result = await fetch(`${BACKEND_URL}/auth/social/exchange`, { method: "POST", headers,
        body: JSON.stringify({ assertion }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
    } catch {
      return fail("oauth_backend");
    }
    if (result.status >= 500 || result.status === 404) return fail("oauth_backend");
    const account = await result.json();
    if (!result.ok) return fail(account.detail === "account_not_linked" ? "account_not_linked" : "account_access");
    const response = NextResponse.redirect(new URL(safeReturnPath(flow.returnPath), origin), { status: 303 });
    response.cookies.set("kindred_session", encryptToken({ session_token: account.session.token, user_id: account.user.id,
      username: account.user.username, display_name: account.user.display_name, role: account.user.role, auth_method: provider }),
      { path: "/", httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", maxAge: 2_592_000 });
    return clearFlow(response);
  } catch (error) {
    // Provider responses and credentials must never be reflected into the browser or logs.
    console.warn(`[auth] ${provider} callback failed (${error instanceof Error ? error.name : "unknown error"})`);
    return fail("oauth_failed");
  }
}
