import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { uploadBackup } from "../lib/upload-backup";

test("resumes at the NAS offset and retains a pending Flickr receipt", async () => {
  const byteOffset = 25;
  const file = new File([new Uint8Array(4 * 1024 * 1024 + byteOffset + 5)], "fixture.jpg", { type: "image/jpeg" });
  const bytes: number[] = [];
  let next = byteOffset;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith("/complete")) return Response.json({ upload_id: "test", status: "completed", next_offset: next,
      receipt: { kindred_photo_id: "nas-receipt", photo_id: null, nas_status: "available", flickr_status: "pending" } });
    if (init?.method === "PUT") {
      assert.ok(path.endsWith(`?offset=${next}`));
      assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/octet-stream");
      const size = (init.body as Blob).size;
      bytes.push(size);
      next += size;
    }
    return Response.json({ upload_id: "test", status: next === file.size ? "ready" : "pending", next_offset: next });
  };
  try {
    const receipt = await uploadBackup(file, "request-id", "fixture", "", () => {}, new AbortController().signal);
    assert.deepEqual(bytes, [4 * 1024 * 1024, 5]);
    assert.deepEqual(receipt, { kindredPhotoId: "nas-receipt", flickrPhotoId: undefined });
  } finally {
    globalThis.fetch = original;
  }
});

test("a Flickr-only receipt does not complete a household backup", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ upload_id: "test", status: "completed", next_offset: 1,
    receipt: { photo_id: "flickr-only", nas_status: "disabled", flickr_status: "available" } });
  try {
    await assert.rejects(uploadBackup(new File(["x"], "fixture.jpg"), "request-id", "fixture", "", () => {},
      new AbortController().signal), /not confirmed the NAS copy/);
  } finally {
    globalThis.fetch = original;
  }
});

test("the authenticated web bridge forwards resumable chunks byte for byte", async () => {
  process.env.COOKIE_SECRET = "fixture-cookie-key";
  const { encryptToken } = await import("../lib/oauth");
  const { PUT } = await import("../app/api/backend/[...path]/route");
  const bytes = Uint8Array.from([0, 127, 128, 255, 47]);
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/uploads\/resumable\/test\?offset=2$/);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("content-type"), "application/octet-stream");
    assert.equal(headers.get("x-session-token"), "fixture-session");
    assert.deepEqual(new Uint8Array(init?.body as ArrayBuffer), bytes);
    return Response.json({ upload_id: "test", status: "ready", next_offset: 7 });
  };
  try {
    const req = new NextRequest("https://kindred.example/api/backend/uploads/resumable/test?offset=2", {
      method: "PUT", body: bytes, headers: { "Content-Type": "application/octet-stream",
        cookie: `kindred_session=${encryptToken({ session_token: "fixture-session" })}` },
    });
    const result = await PUT(req, { params: Promise.resolve({ path: ["uploads", "resumable", "test"] }) });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).next_offset, 7);
  } finally {
    globalThis.fetch = original;
  }
});
