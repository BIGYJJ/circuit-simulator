import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIR_NAMES = new Set([
  ".git",
  ".serena",
  ".pnpm-store",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  "docs",
]);

const SKIP_FILE_NAMES = new Set(["verify-release-hygiene.mjs", "hygiene.test.mjs"]);

const SECRET_CONFIG_NAME = ".project-config.json";

const TEXT_RULES = [
  { rule: "manus-vendor", pattern: /__manus__/gi },
  { rule: "manus-plugin", pattern: /vite-plugin-manus/gi },
  { rule: "forge-proxy", pattern: /BUILT_IN_FORGE|manus-storage/gi },
  { rule: "analytics", pattern: /VITE_ANALYTICS|\/umami\b/gi },
  { rule: "collector", pattern: /debug-collector/gi },
  { rule: "remote-font", pattern: /fonts\.googleapis|fonts\.gstatic/gi },
];

const FORBIDDEN_PATH_RULES = [
  { rule: "secret-config", test: relative => path.basename(relative) === SECRET_CONFIG_NAME },
  { rule: "manus-public", test: relative => relative.split(path.sep).includes("__manus__") },
  { rule: "hosted-server", test: relative => relative === "server" || relative.startsWith(`server${path.sep}`) },
  { rule: "template-json", test: relative => relative === "template.json" },
  { rule: "components-json", test: relative => relative === "components.json" },
  { rule: "wouter-patch", test: relative => relative.startsWith(`patches${path.sep}`) },
];

function posixPath(relative) {
  return relative.split(path.sep).join("/");
}

export function scanText(filePath, source) {
  const findings = [];
  for (const { rule, pattern } of TEXT_RULES) {
    const matches = source.match(pattern);
    if (matches?.length) {
      findings.push({ rule, path: filePath, count: matches.length });
    }
  }
  return { findings };
}

async function walk(root, relativeDir, findings) {
  const absDir = path.join(root, relativeDir);
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      for (const rule of FORBIDDEN_PATH_RULES) {
        if (rule.test(relative)) {
          findings.push({ rule: rule.rule, path: posixPath(relative), count: 1 });
        }
      }
      await walk(root, relative, findings);
      continue;
    }
    if (!entry.isFile()) continue;
    for (const rule of FORBIDDEN_PATH_RULES) {
      if (rule.test(relative)) {
        findings.push({ rule: rule.rule, path: posixPath(relative), count: 1 });
      }
    }
    if (entry.name === SECRET_CONFIG_NAME) continue;
    if (SKIP_FILE_NAMES.has(entry.name)) continue;
    const abs = path.join(root, relative);
    const info = await stat(abs);
    if (info.size > 2_000_000) continue;
    if (!/\.(?:[cm]?[jt]sx?|json|html|css|md|yml|yaml|mjs|cjs|txt)$/i.test(entry.name)) continue;
    const source = await readFile(abs, "utf8");
    const scanned = scanText(posixPath(relative), source);
    findings.push(...scanned.findings);
  }
}

export async function verifyReleaseHygiene(root) {
  const findings = [];
  await walk(root, "", findings);
  return { findings };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = await verifyReleaseHygiene(process.cwd());
  if (report.findings.length > 0) {
    console.error(JSON.stringify({ findings: report.findings }, null, 2));
    process.exit(1);
  }
}
