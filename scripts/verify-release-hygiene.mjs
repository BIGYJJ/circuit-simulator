import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_PATHS = [
  ".project-config.json",
  "client/public/__manus__",
  "server",
  "shared",
  "template.json",
  "components.json",
  "patches/wouter@3.7.1.patch",
];

const FORBIDDEN_REFERENCES = [
  ["manus-runtime", /vite-plugin-manus-runtime/gi],
  ["manus-collector", /__manus__\//gi],
  ["forge-proxy", /(?:BUILT_IN_FORGE|manus-storage|forge\/storage)/gi],
  ["analytics", /(?:VITE_ANALYTICS|manus-analytics\.com|\/umami)/gi],
  ["server-proxy", /(?:express|createServer\(|\/api\/)/gi],
  ["remote-font", /(?:fonts\.googleapis\.com|fonts\.gstatic\.com)/gi],
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html", ".json", ".mjs", ".yml", ".yaml"]);

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

export function scanText(relativePath, source) {
  const findings = [];
  for (const [rule, expression] of FORBIDDEN_REFERENCES) {
    const matches = source.match(expression);
    if (matches?.length) {
      findings.push({ rule, path: normalize(relativePath), count: matches.length });
    }
  }
  return { findings };
}

async function walk(root, current = "") {
  const directory = path.join(root, current);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(current, entry.name);
    const normalized = normalize(relative);
    if ([".git", "node_modules", "dist", ".pnpm-store", ".webdev"].some((skip) => normalized === skip || normalized.startsWith(`${skip}/`))) continue;
    if (entry.isDirectory()) files.push(...await walk(root, relative));
    if (entry.isFile()) files.push(relative);
  }
  return files;
}

export async function verifyReleaseHygiene(root) {
  const findings = [];
  for (const relative of FORBIDDEN_PATHS) {
    try {
      await stat(path.join(root, relative));
      findings.push({ rule: "forbidden-path", path: relative, count: 1 });
    } catch (error) {
      if (error && typeof error === "object" && error.code !== "ENOENT") throw error;
    }
  }

  const files = await walk(root);
  for (const relative of files) {
    const normalized = normalize(relative);
    const topLevelBuildSurface = normalized === "package.json" || normalized === "vite.config.ts" || normalized.startsWith("client/") || normalized.startsWith(".github/");
    if (!topLevelBuildSurface || !SOURCE_EXTENSIONS.has(path.extname(relative))) continue;
    const source = await readFile(path.join(root, relative), "utf8");
    findings.push(...scanText(relative, source).findings);
  }
  return { findings, scannedFiles: files.length };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const report = await verifyReleaseHygiene(root);
  if (report.findings.length) {
    for (const finding of report.findings) console.error(`${finding.rule}: ${finding.path} (${finding.count})`);
    process.exitCode = 1;
    return;
  }
  console.log(`release hygiene passed (${report.scannedFiles} files scanned)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
