import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyAuditReport } from "../../scripts/verify-audit-report.mjs";

test("accepts a clean production audit", () => {
  const result = verifyAuditReport(
    {
      advisories: {},
      metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 0, low: 0 } },
    },
    "# SECURITY"
  );
  assert.equal(result.ok, true);
  assert.equal(result.highCritical, 0);
});

test("rejects high/critical and unadjudicated lower findings", () => {
  assert.throws(
    () =>
      verifyAuditReport({
        metadata: { vulnerabilities: { high: 1, critical: 0 } },
        advisories: { a: { severity: "high", github_advisory_id: "GHSA-high" } },
      }),
    { code: "AUDIT_HIGH_CRITICAL" }
  );
  assert.throws(
    () =>
      verifyAuditReport(
        {
          metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 1 } },
          advisories: { a: { severity: "moderate", github_advisory_id: "GHSA-unlisted" } },
        },
        "no matching advisory"
      ),
    { code: "AUDIT_UNADJUDICATED" }
  );
  const accepted = verifyAuditReport(
    {
      metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 1 } },
      advisories: { a: { severity: "moderate", github_advisory_id: "GHSA-accepted" } },
    },
    "GHSA-accepted is accepted until 2026-12-31 because no runtime path remains."
  );
  assert.equal(accepted.ok, true);
});
