import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function collectItems(report) {
  const items = [];
  if (report.advisories && typeof report.advisories === "object") items.push(...Object.values(report.advisories));
  if (report.vulnerabilities && typeof report.vulnerabilities === "object") {
    items.push(...Object.values(report.vulnerabilities));
  }
  return items;
}

export function verifyAuditReport(auditJson, securityMarkdown) {
  const report = typeof auditJson === "string" ? JSON.parse(auditJson) : auditJson;
  const security = securityMarkdown ?? "";
  const meta = report.metadata?.vulnerabilities ?? {};
  if ((meta.high ?? 0) + (meta.critical ?? 0) > 0) fail("AUDIT_HIGH_CRITICAL", "high/critical vulnerabilities must be zero");
  for (const item of collectItems(report)) {
    const severity = String(item.severity ?? item.severityLabel ?? "").toLowerCase();
    if (severity === "high" || severity === "critical") fail("AUDIT_HIGH_CRITICAL", "high/critical vulnerabilities must be zero");
    if (severity === "moderate" || severity === "low") {
      const ids = [item.github_advisory_id, item.id, item.name, item.title].filter(Boolean).map(String);
      if (!ids.length || !ids.some(id => security.includes(id))) {
        fail("AUDIT_UNADJUDICATED", `unadjudicated ${severity} finding ${ids[0] ?? "unknown"}`);
      }
    }
  }
  return { ok: true, highCritical: 0 };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const audit = readFileSync(resolve(process.argv[2] ?? "audit.json"), "utf8");
  const security = readFileSync(resolve("SECURITY.md"), "utf8");
  process.stdout.write(`${JSON.stringify(verifyAuditReport(audit, security), null, 2)}\n`);
}
