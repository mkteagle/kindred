import assert from "node:assert/strict";
import test from "node:test";
import { searchCaptureMonth } from "../lib/search-capture-date";

test("month searches include the entire capture month", () => {
  assert.deepEqual(searchCaptureMonth("November 2025"), {
    label: "November 2025",
    range: { field: "taken", from: "2025-11-01", to: "2025-11-30" },
  });
  assert.equal(searchCaptureMonth("feb. 2024")?.range.to, "2024-02-29");
  assert.equal(searchCaptureMonth("December 2025")?.range.to, "2025-12-31");
  assert.equal(searchCaptureMonth("camping November 2025"), null);
});
