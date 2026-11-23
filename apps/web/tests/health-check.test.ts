import assert from "node:assert/strict";
import { test } from "node:test";
import { getHealthReport } from "../lib/health-check";

const config = {
  catalog: "https://catalog.example",
  nas: "https://nas.example",
  sessionToken: "test-session",
  vercelRuntime: true,
};
const object = `https://${"a".repeat(32)}.r2.cloudflarestorage.com/private/thumbnails/v1/abc123.jpg?X-Amz-Signature=test`;
const api = { status: "ok", db: "connected" };
const vendor = { status: { indicator: "none" } };

test("reports live service checks separately and reads R2 without forwarding the Kindred session", async () => {
  let nasHealthRequests = 0;
  const report = await getHealthReport(config, async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(init?.redirect, "error");
    if (url.href === object) {
      assert.equal(headers.get("Range"), "bytes=0-0");
      assert.equal(headers.get("X-Session-Token"), null);
      return new Response("x", { status: 206, headers: { "content-type": "image/jpeg" } });
    }
    if (url.pathname === "/health") {
      if (url.origin === config.nas) nasHealthRequests++;
      return Response.json(api, { headers: { "cf-ray": "test" } });
    }
    if (url.pathname === "/storage/status") {
      assert.equal(headers.get("X-Session-Token"), config.sessionToken);
      return Response.json({ configured: true, available: true, private_mount: "/private" });
    }
    if (url.pathname === "/library/photos") {
      assert.equal(headers.get("X-Session-Token"), config.sessionToken);
      return Response.json({ photos: [{ thumbnail_url: object }] });
    }
    assert.equal(headers.get("X-Session-Token"), null);
    return Response.json(vendor);
  });

  assert.equal(nasHealthRequests, 1);
  assert.equal(report.checks.length, 8);
  assert.ok(report.checks.every((check) => check.state === "healthy"));
  assert.doesNotMatch(JSON.stringify(report), /test-session|X-Amz-Signature|private_mount/);
});

test("keeps provider checks available during a NAS failure and ignores non-R2 thumbnail URLs", async () => {
  const report = await getHealthReport(config, async (input) => {
    const url = new URL(String(input));
    if (url.origin === config.nas) throw new DOMException("Timeout", "TimeoutError");
    if (url.pathname === "/health") return Response.json(api);
    if (url.pathname === "/library/photos") return Response.json({
      photos: [{ thumbnail_url: "https://untrusted.example/thumbnails/v1/abc.jpg?X-Amz-Signature=test" }],
    });
    assert.equal(url.pathname, "/api/v2/status.json");
    return Response.json(url.hostname === "www.cloudflarestatus.com" ? vendor : { status: { indicator: "minor" } });
  });
  const states = Object.fromEntries(report.checks.map((check) => [check.id, check.state]));
  assert.equal(states["nas-api"], "unavailable");
  assert.equal(states["tunnel"], "unknown");
  assert.equal(states["r2"], "unknown");
  assert.equal(states["catalog"], "healthy");
  assert.equal(states["cloudflare-platform"], "healthy");
  assert.equal(states["vercel-platform"], "degraded");
});

test("distinguishes an R2 object failure from the provider's normal status", async () => {
  let attempted = false;
  const report = await getHealthReport(config, async (input) => {
    const url = new URL(String(input));
    if (url.href === object) {
      attempted = true;
      return new Response(null, { status: 403 });
    }
    if (url.pathname === "/library/photos") return Response.json({ photos: [{ thumbnail_url: object }] });
    if (url.pathname === "/storage/status") return Response.json({ configured: true, available: true });
    return Response.json(url.pathname === "/health" ? api : vendor);
  });
  assert.equal(attempted, true);
  assert.equal(report.checks.find((check) => check.id === "r2")?.state, "unavailable");
  assert.equal(report.checks.find((check) => check.id === "cloudflare-platform")?.state, "healthy");
});
