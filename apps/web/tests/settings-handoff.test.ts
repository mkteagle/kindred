import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

test("settings handoffs return to the requested page after sign-in", () => {
  for (const path of ["/settings", "/settings/advanced?source=ipad", "/settings/integrations"]) {
    const response = proxy(new NextRequest(`https://photos.example.com${path}`));
    const redirect = new URL(response.headers.get("location")!);
    assert.equal(redirect.pathname, "/login");
    assert.equal(redirect.searchParams.get("return"), path);
  }
});
