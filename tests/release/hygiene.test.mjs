import assert from "node:assert/strict";
import { test } from "node:test";
import { scanText } from "../../scripts/verify-release-hygiene.mjs";

test("reports a forbidden vendor reference without echoing source text", () => {
  const source = "load https://example.invalid/__manus__/debug.js";
  const report = scanText("fixture.txt", source);
  assert.equal(report.findings.length, 1);
  assert.equal(JSON.stringify(report).includes(source), false);
});
