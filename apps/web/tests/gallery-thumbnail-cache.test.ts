import assert from "node:assert/strict";
import { test } from "node:test";

test("gallery thumbnails cache authenticated image bytes under the stable browser URL", async () => {
  process.env.COOKIE_SECRET = "thumbnail-cache-test";
  process.env.BACKEND_URL = "https://nas.example";
  process.env.KINDRED_CATALOG_BACKEND_URL = "https://catalog.example";
  const { NextRequest } = await import("next/server");
  const { encryptToken } = await import("../lib/oauth");
  const { GET } = await import("../app/api/backend/[...path]/route");
  const route = { params: Promise.resolve({ path: ["photos", "321", "image"] }) };
  const base = "https://kindred.example/api/backend";
  const imageUrl = `${base}/photos/321/image?size=n&w=320`;
  const cookie = `kindred_session=${encryptToken({ session_token: "fixture-session" })}`;
  const object = `https://${"a".repeat(32)}.r2.cloudflarestorage.com/private/thumbnails/v1/321.jpg?X-Amz-Signature=fixture`;
  const realFetch = globalThis.fetch;
  let objectStatus = 200;
  try {
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      if (String(input).startsWith("https://catalog.example/")) {
        assert.equal(headers.get("x-session-token"), "fixture-session");
        if (String(input).endsWith("/library/photos")) return Response.json({ photos: [] });
        return new Response(null, { status: 307, headers: { location: object } });
      }
      if (String(input).startsWith("https://nas.example/")) {
        assert.equal(headers.get("x-session-token"), "fixture-session");
        return new Response("NAS preview", { headers: { "content-type": "image/webp", "cache-control": "private, no-store", vary: "Accept" } });
      }
      assert.equal(input, object);
      assert.equal(init?.redirect, "manual");
      assert.equal(headers.get("x-session-token"), null);
      assert.equal(headers.get("x-api-key"), null);
      if (objectStatus === 304) assert.equal(headers.get("if-none-match"), '"preview"');
      return new Response(objectStatus === 304 ? null : "R2 preview", {
        status: objectStatus, headers: { "content-type": "image/jpeg", etag: '"preview"' },
      });
    };
    const libraryRoute = { params: Promise.resolve({ path: ["library", "photos"] }) };
    const library = await GET(new NextRequest(`${base}/library/photos`, { headers: { cookie } }), libraryRoute);
    const scope = library.headers.get("x-kindred-thumbnail-scope");
    assert.match(scope ?? "", /^[A-Za-z0-9_-]{22}$/);
    assert.equal(library.headers.get("cache-control"), "private, no-store");
    const url = `${imageUrl}&preview=gallery&scope=${scope}`;
    assert.equal((await GET(new NextRequest(url), route)).status, 401);
    const otherCookie = `kindred_session=${encryptToken({ session_token: "other-session" })}`;
    const wrongSession = await GET(new NextRequest(url, { headers: { cookie: otherCookie } }), route);
    assert.equal(wrongSession.status, 403);
    assert.equal(wrongSession.headers.get("cache-control"), "private, no-store");

    const cached = await GET(new NextRequest(url, { headers: { cookie } }), route);
    assert.equal(cached.status, 200);
    assert.equal(await cached.text(), "R2 preview");
    assert.equal(cached.headers.get("cache-control"), "private, max-age=86400");
    assert.equal(cached.headers.get("vary"), "Cookie");
    assert.equal(cached.headers.get("etag"), '"preview"');

    objectStatus = 304;
    const validated = await GET(new NextRequest(url, { headers: { cookie, "If-None-Match": '"preview"' } }), route);
    assert.equal(validated.status, 304);
    assert.equal(await validated.text(), "");

    objectStatus = 403;
    const fallback = await GET(new NextRequest(url, { headers: { cookie } }), route);
    assert.equal(await fallback.text(), "NAS preview");
    assert.equal(fallback.headers.get("cache-control"), "private, max-age=86400");
    assert.equal(fallback.headers.get("vary"), "Accept, Cookie");

    const legacy = await GET(new NextRequest(imageUrl, { headers: { cookie } }), route);
    assert.equal(legacy.status, 307);
    assert.equal(legacy.headers.get("location"), object);
  } finally {
    globalThis.fetch = realFetch;
  }
});
