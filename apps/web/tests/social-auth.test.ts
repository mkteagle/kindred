import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { NextRequest } from "next/server";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";

process.env.COOKIE_SECRET = "kindred-test-cookie-secret-never-production";
process.env.API_KEY = "kindred-test-bridge-key-never-production";
process.env.GOOGLE_CLIENT_ID = "google-test-client";
process.env.GOOGLE_CLIENT_SECRET = "google-test-secret";
process.env.APPLE_CLIENT_ID = "apple-test-client";
process.env.APPLE_TEAM_ID = "test-team";
process.env.APPLE_KEY_ID = "test-key";
process.env.BACKEND_URL = "https://fixture-backend.invalid\\n";
process.env.AUTH_ORIGIN = "https://kindred.example";

let auth: typeof import("../lib/social-auth");
let cookie: typeof import("../lib/oauth");
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
const originalFetch = globalThis.fetch;
let idToken = "";
let exchanges = 0;
let expectedLink: string | undefined;
let backendOffline = false;
before(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
  const ec = await generateKeyPair("ES256", { extractable: true });
  const { exportPKCS8 } = await import("jose");
  process.env.APPLE_PRIVATE_KEY = await exportPKCS8(ec.privateKey);
  auth = await import("../lib/social-auth");
  cookie = await import("../lib/oauth");
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/certs") || url.endsWith("/auth/keys")) return Response.json({ keys: [{ ...await exportJWK(keys.publicKey), kid: "fixture", alg: "RS256", use: "sig" }] });
    if (url.endsWith("/token")) return Response.json({ id_token: idToken });
    if (url === "https://fixture-backend.invalid/auth/social/exchange") {
      exchanges++;
      if (backendOffline) throw new TypeError("fixture offline");
      const { assertion } = JSON.parse(String(init?.body));
      const { payload } = await jwtVerify(assertion, new TextEncoder().encode(process.env.API_KEY), { issuer: "kindred-web", audience: "kindred-backend", algorithms: ["HS256"] });
      assert.equal(payload.link_user_id, expectedLink);
      if (expectedLink) assert.equal((init?.headers as Record<string,string>)["X-Session-Token"], "account-session");
      return Response.json({ user: { id: "account-id", username: "owner", display_name: "Owner", role: "admin" }, session: { token: "new-session" } });
    }
    throw new Error(`Unexpected network request ${url}`);
  };
});
after(() => { globalThis.fetch = originalFetch; });

async function flow(provider: "google" | "apple", link = false) {
  const accountCookie = cookie.encryptToken({ session_token: "account-session", user_id: "account-id" });
  const response = await auth.beginSocialAuth(new NextRequest(`https://kindred.example/api/auth/${provider}${link ? "?link=1" : ""}`, { headers: link ? { cookie: `kindred_session=${accountCookie}` } : {} }), provider);
  const redirect = new URL(response.headers.get("location")!);
  const saved = response.cookies.get(`kindred_oauth_${provider}`)!;
  const data = cookie.decryptToken(saved.value)!;
  return { redirect, saved, data };
}
async function token(provider: "google" | "apple", nonce: string, audience?: string) {
  return new SignJWT({ nonce, email: "member@example.com", email_verified: true })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer(provider === "google" ? "https://accounts.google.com" : "https://appleid.apple.com")
    .setAudience(audience || `${provider}-test-client`).setSubject("provider-subject").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
}

test("Google authorization includes nonce, state and PKCE", async () => {
  const { redirect, data } = await flow("google");
  assert.equal(redirect.origin, "https://accounts.google.com");
  assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
  assert.equal(redirect.searchParams.get("nonce"), data.nonce);
  assert.equal(redirect.searchParams.get("state"), data.state);
});
test("callback rejects missing flow and mismatched state before exchanging a code", async () => {
  const start = exchanges;
  const noFlow = await auth.finishSocialAuth(new NextRequest("https://kindred.example/api/auth/google/callback?code=x&state=x"), "google");
  assert.match(noFlow.headers.get("location")!, /oauth_expired/);
  const { saved } = await flow("google");
  const mismatch = await auth.finishSocialAuth(new NextRequest("https://kindred.example/api/auth/google/callback?code=x&state=wrong", { headers: { cookie: `${saved.name}=${saved.value}` } }), "google");
  assert.match(mismatch.headers.get("location")!, /oauth_state/);
  assert.equal(exchanges, start);
});
test("Google verifies signed identity and creates a household session", async () => {
  expectedLink = undefined;
  const { data, saved } = await flow("google");
  idToken = await token("google", data.nonce);
  const response = await auth.finishSocialAuth(new NextRequest(`https://kindred.example/api/auth/google/callback?code=fixture&state=${data.state}`, { headers: { cookie: `${saved.name}=${saved.value}` } }), "google");
  assert.equal(new URL(response.headers.get("location")!).pathname, "/gallery");
  assert.equal(cookie.decryptToken(response.cookies.get("kindred_session")!.value)?.session_token, "new-session");
});
test("wrong nonce and wrong audience cannot establish a session", async () => {
  for (const invalid of ["nonce", "audience"]) {
    const { data, saved } = await flow("google");
    const start = exchanges;
    idToken = await token("google", invalid === "nonce" ? "wrong" : data.nonce, invalid === "audience" ? "wrong-client" : undefined);
    const response = await auth.finishSocialAuth(new NextRequest(`https://kindred.example/api/auth/google/callback?code=fixture&state=${data.state}`, { headers: { cookie: `${saved.name}=${saved.value}` } }), "google");
    assert.match(response.headers.get("location")!, /oauth_failed/);
    assert.equal(exchanges, start);
    assert.equal(response.cookies.get("kindred_session"), undefined);
  }
});
test("Apple form POST links the original account even without a Lax session cookie", async () => {
  expectedLink = "account-id";
  const { data, saved, redirect } = await flow("apple", true);
  assert.equal(redirect.searchParams.get("response_mode"), "form_post");
  assert.equal(saved.sameSite, "lax");
  idToken = await token("apple", data.nonce);
  const handoffResponse = await auth.beginAppleCallback(new NextRequest("https://kindred.example/api/auth/apple/callback", {
    method: "POST", body: new URLSearchParams({ state: data.state, code: "fixture" }),
  }));
  assert.equal(handoffResponse.status, 303);
  assert.equal(handoffResponse.headers.get("location"), "https://kindred.example/api/auth/apple/callback");
  const handoff = handoffResponse.cookies.get("kindred_apple_handoff")!;
  const response = await auth.finishSocialAuth(new NextRequest("https://kindred.example/api/auth/apple/callback", {
    headers: { cookie: `${saved.name}=${saved.value}; ${handoff.name}=${handoff.value}` },
  }), "apple");
  assert.equal(new URL(response.headers.get("location")!).pathname, "/settings/integrations");
  assert.ok(response.cookies.get("kindred_session"));
  expectedLink = undefined;
});
test("provider login starts on the same host that owns the callback", async () => {
  const start = await auth.beginSocialAuth(new NextRequest("http://localhost:3018/api/auth/google?return=%2Fgallery"), "google");
  assert.equal(start.headers.get("location"), "https://kindred.example/api/auth/google?return=%2Fgallery");
  assert.equal(start.cookies.get("kindred_oauth_google"), undefined);
});
test("Apple localhost login gives a configuration error without starting an OAuth flow", async () => {
  const configuredOrigin = process.env.AUTH_ORIGIN;
  delete process.env.AUTH_ORIGIN;
  try {
    const start = await auth.beginSocialAuth(new NextRequest("http://localhost:3018/api/auth/apple"), "apple");
    assert.equal(start.headers.get("location"), "http://localhost:3018/login?error=apple_requires_https");
    assert.equal(start.cookies.get("kindred_oauth_apple"), undefined);
  } finally {
    process.env.AUTH_ORIGIN = configuredOrigin;
  }
});
test("the callback reports an unavailable household service separately", async () => {
  const { data, saved } = await flow("google");
  idToken = await token("google", data.nonce);
  backendOffline = true;
  try {
    const response = await auth.finishSocialAuth(new NextRequest(`https://kindred.example/api/auth/google/callback?code=fixture&state=${data.state}`, {
      headers: { cookie: `${saved.name}=${saved.value}` },
    }), "google");
    assert.match(response.headers.get("location")!, /oauth_backend/);
    assert.equal(response.cookies.get("kindred_session"), undefined);
  } finally {
    backendOffline = false;
  }
});
test("flow cookies reject tampering and return paths stay local", () => {
  const encoded = cookie.encryptToken({ state: "sensitive" });
  assert.equal(cookie.decryptToken(encoded.slice(0, -2) + "ff"), null);
  for (const path of ["//evil.example", "/\\evil", "/\n/evil", "https://evil.example"]) assert.equal(auth.safeReturnPath(path), "/gallery");
  assert.equal(auth.safeReturnPath("/timeline?year=2003"), "/timeline?year=2003");
});

test("passkey verification accepts only the same origin and uses the browser's challenge cookie", async () => {
  const { POST } = await import("../app/api/auth/passkeys/[action]/route");
  const request = (origin: string) => new NextRequest("https://kindred.example/api/auth/passkeys/login-verify", {
    method: "POST",
    headers: { origin, cookie: "kindred_passkey_login=browser-challenge" },
    body: JSON.stringify({ challenge_id: "untrusted", credential: { id: "fixture-key" } }),
  });
  const context = { params: Promise.resolve({ action: "login-verify" }) };
  assert.equal((await POST(request("https://other.example"), context)).status, 403);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://fixture-backend.invalid/auth/passkeys/login-verify");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      challenge_id: "browser-challenge", credential: { id: "fixture-key" },
    });
    return Response.json({ user: { id: "account-id", username: "owner", role: "admin" }, session: { token: "new-session" } });
  };
  try {
    const response = await POST(request("https://kindred.example"), context);
    assert.equal(response.status, 200);
    const session = cookie.decryptToken(response.cookies.get("kindred_session")!.value);
    assert.equal(session?.auth_method, "passkey");
    assert.equal(session?.session_token, "new-session");
    assert.equal(response.cookies.get("kindred_passkey_login")?.maxAge, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
