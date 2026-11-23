import { strict as assert } from "node:assert";
import { test } from "node:test";
import { thumbnailUrlIsFresh } from "../lib/image-delivery";

test("expired and near-expiry R2 signatures are skipped before requesting a thumbnail", () => {
  const url = "https://thumbs.example/photo.jpg?X-Amz-Date=20261122T120000Z&X-Amz-Expires=300";
  assert.equal(thumbnailUrlIsFresh(url, Date.parse("2026-11-22T12:02:00Z")), true);
  assert.equal(thumbnailUrlIsFresh(url, Date.parse("2026-11-22T12:04:55Z")), false);
  assert.equal(thumbnailUrlIsFresh(url, Date.parse("2026-11-22T12:05:05Z")), false);
  assert.equal(thumbnailUrlIsFresh("/api/photos/1/local?variant=thumb"), true);
  assert.equal(thumbnailUrlIsFresh("https://thumbs.example/photo.jpg?X-Amz-Expires=300"), false);
});
