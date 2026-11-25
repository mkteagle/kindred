import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarCrop, CENTERED_AVATAR, moveAvatar } from "../lib/avatar-crop";

test("a landscape photo starts centered and can pan to both edges without showing blank space", () => {
  assert.deepEqual(avatarCrop(1200, 800, CENTERED_AVATAR), { left: 200, top: 0, size: 800 });
  const left = moveAvatar(1200, 800, CENTERED_AVATAR, 900, 900);
  assert.deepEqual(avatarCrop(1200, 800, left), { left: 0, top: 0, size: 800 });
  const right = moveAvatar(1200, 800, left, -900, -900);
  assert.deepEqual(avatarCrop(1200, 800, right), { left: 400, top: 0, size: 800 });
});

test("zoom opens up panning on both axes of a portrait photo", () => {
  const zoomed = { ...CENTERED_AVATAR, zoom: 2 };
  assert.deepEqual(avatarCrop(800, 1200, zoomed), { left: 200, top: 400, size: 400 });
  const moved = moveAvatar(800, 1200, zoomed, 100, -125);
  assert.deepEqual(avatarCrop(800, 1200, moved), { left: 100, top: 525, size: 400 });
});
