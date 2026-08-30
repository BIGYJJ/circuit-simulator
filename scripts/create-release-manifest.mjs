import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readEngineFingerprint } from "./verify-ngspice-assets.mjs";

export const PRE_MANIFEST_GATE_IDS = [
  "clean-entry",
  "frozen-install",
  "lockfile-diff",
  "typecheck",
  "unit",
  "release-unit",
  "pwa-fixtures",
  "offline-update",
  "clean-before-release-build",
  "release-build",
  "build-identity",
  "license-inventory",
  "qualification",
  "core-browsers",
  "chromium-suite",
  "prod-audit",
  "hygiene",
  "gitleaks-history",
  "source-archive",
  "gitleaks-unpacked-source",
  "build-metrics",
  "local-host-contract",
  "clean-exit",
];

export const POST_MANIFEST_GATE_IDS = [
  "clean-entry",
  "final-tree-before",
  "gitleaks-final-dist",
  "final-tree-after",
  "local-host-release",
  "clean-exit",
];

export const EXTERNAL_GATE_IDS = ["clean-entry", "local-tree-recheck", "remote-static-host", "remote-browser-smoke"];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function enumerateReleaseTree(root, excludedPaths = []) {
  const excluded = new Set(excludedPaths.map(item => item.replace(/^\/+/, "")));
  const files = [];
  const seen = new Set();
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      if (rel.split("/").includes("..")) fail("TREE_TRAVERSAL", rel);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) fail("TREE_SYMLINK", rel);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) fail("TREE_ENTRY", rel);
      if (excluded.has(rel)) continue;
      if (seen.has(rel)) fail("TREE_DUPLICATE", rel);
      seen.add(rel);
      files.push({
        path: rel,
        size: stat.size,
        sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
      });
    }
  }
  walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function hashReleaseTree(entries) {
  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
}

function readEvidence(evidenceDir) {
  const files = readdirSync(evidenceDir).filter(name => name.endsWith(".json"));
  const reports = new Map();
  for (const name of files) {
    const report = JSON.parse(readFileSync(join(evidenceDir, name), "utf8"));
    if (reports.has(report.gateId)) fail("MANIFEST_EVIDENCE", `duplicate pre-manifest report ${report.gateId}`);
    reports.set(report.gateId, report);
  }
  for (const id of PRE_MANIFEST_GATE_IDS) {
    const report = reports.get(id);
    if (!report) fail("MANIFEST_EVIDENCE", `missing pre-manifest report ${id}`);
    if (report.gateId !== id || report.status !== "passed" || report.phase !== "pre-manifest") {
      fail("MANIFEST_EVIDENCE", `pre-manifest report ${id} is not a passed gate`);
    }
  }
  if (reports.size !== PRE_MANIFEST_GATE_IDS.length) fail("MANIFEST_EVIDENCE", "unexpected extra pre-manifest report");
  return PRE_MANIFEST_GATE_IDS.map(id => reports.get(id));
}

export function createReleaseManifest({ distDir, evidenceDir, sourceArchive, releaseRunId, output }) {
  const reports = readEvidence(evidenceDir);
  const first = reports[0];
  const fingerprint = readEngineFingerprint();
  for (const report of reports) {
    if (report.releaseRunId !== releaseRunId) fail("MANIFEST_RUN", "releaseRunId drifted across pre-manifest reports");
    if (report.releaseSourceCommit !== first.releaseSourceCommit) fail("MANIFEST_SOURCE", "source commit drifted");
    if (report.appBuildId !== first.appBuildId) fail("MANIFEST_APP", "appBuildId drifted");
    if (report.engineBuildId !== first.engineBuildId) fail("MANIFEST_ENGINE", "engineBuildId drifted");
    if (report.resultTransport !== first.resultTransport) fail("MANIFEST_TRANSPORT", "result transport drifted");
    if (report.engineBuildId !== fingerprint.engineBuildId) fail("MANIFEST_ENGINE", "engineBuildId does not match vendor");
    if (report.resultTransport !== fingerprint.resultTransport) fail("MANIFEST_TRANSPORT", "result transport drifted");
  }
  const resolvedDist = resolve(distDir);
  if (!existsSync(join(resolvedDist, "third-party-licenses.json"))) {
    fail("MANIFEST_LICENSE", "third-party-licenses.json is missing from the release tree");
  }
  const deliveryFiles = enumerateReleaseTree(resolvedDist, ["release-manifest.json"]);
  const archiveBytes = readFileSync(sourceArchive);
  const manifest = {
    schemaVersion: 1,
    releaseRunId,
    releaseSourceCommit: first.releaseSourceCommit,
    appBuildId: first.appBuildId,
    engineBuildId: fingerprint.engineBuildId,
    resultTransport: fingerprint.resultTransport,
    moduleSha256: fingerprint.moduleSha256,
    wasmSha256: fingerprint.wasmSha256,
    sourceArchiveSha256: createHash("sha256").update(archiveBytes).digest("hex"),
    deliveryFiles,
    createdAt: new Date().toISOString(),
  };
  const dest = resolve(output ?? join(resolvedDist, "release-manifest.json"));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  createReleaseManifest({
    distDir: flag("--dist") ?? "dist/public",
    evidenceDir: flag("--evidence"),
    sourceArchive: flag("--source-archive"),
    releaseRunId: flag("--release-run-id"),
    output: flag("--output"),
  });
}
