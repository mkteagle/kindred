import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogRequest, isR2ThumbnailRedirect } from "../lib/backend-url";

test("catalog routing sends account, library, and quick search requests to Vercel", () => {
  assert.equal(catalogRequest("POST", "auth/social/exchange", new URLSearchParams()), true);
  assert.equal(catalogRequest("GET", "library/photos", new URLSearchParams()), true);
  assert.equal(catalogRequest("GET", "search", new URLSearchParams("q=bees&mode=quick")), true);
  assert.equal(catalogRequest("GET", "search", new URLSearchParams("q=bees&mode=visual")), false);
});

test("catalog routing keeps originals and alternate image transforms on the NAS", () => {
  for (const query of ["size=o&w=480", "w=2560", "w=480&format=webp", ""]) {
    assert.equal(catalogRequest("GET", "photos/321/image", new URLSearchParams(query)), false);
  }
  assert.equal(catalogRequest("GET", "photos/321/image", new URLSearchParams("w=480")), true);
  assert.equal(catalogRequest("GET", "photos/321/local", new URLSearchParams("variant=thumb")), true);
  assert.equal(catalogRequest("GET", "photos/321/local", new URLSearchParams()), false);
});

test("thumbnail redirects must be signed URLs on the R2 endpoint", () => {
  const host = `${"a".repeat(32)}.r2.cloudflarestorage.com`;
  const key = "kindred-thumbnails/thumbnails/v1/321.jpg";
  assert.equal(isR2ThumbnailRedirect(`https://${host}/${key}?X-Amz-Signature=test`), true);
  assert.equal(isR2ThumbnailRedirect(`https://${host}/${key}`), false);
  assert.equal(isR2ThumbnailRedirect(`https://${host}.example.org/${key}?X-Amz-Signature=test`), false);
  assert.equal(isR2ThumbnailRedirect(`https://${host}/originals/321.jpg?X-Amz-Signature=test`), false);
});
