import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEngineFingerprint } from "./verify-ngspice-assets.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function walk(directory, files = []) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (stat.isFile()) files.push(full);
  }
  return files;
}

export function verifyBuildIdentity(distDir, expected = {}) {
  const root = resolve(distDir);
  const htmlPath = join(root, "index.html");
  if (!existsSync(htmlPath)) fail("IDENTITY_HTML", "index.html is missing");
  const html = readFileSync(htmlPath, "utf8");
  const mainHref = /src="([^"]*main-[^"]+\.js)"/.exec(html)?.[1] ?? /src="([^"]+\.js)"/.exec(html)?.[1];
  if (!mainHref) fail("IDENTITY_MAIN", "index.html is missing the main module");
  const mainPath = join(root, mainHref.replace(/^\//, ""));
  if (!existsSync(mainPath)) fail("IDENTITY_MAIN", "main module is missing");
  const main = readFileSync(mainPath, "utf8");
  const files = walk(root);
  const workerPath = files.find(item => /simulator\.worker-[^/\\]+\.js$/.test(item));
  if (!workerPath) fail("IDENTITY_WORKER", "simulation worker is missing");
  const worker = readFileSync(workerPath, "utf8");
  const swPath = join(root, "sw.js");
  if (!existsSync(swPath)) fail("IDENTITY_SW", "sw.js is missing");
  const sw = readFileSync(swPath, "utf8");
  const fingerprint = expected.fingerprint ?? readEngineFingerprint();
  const haystack = `${html}\n${main}\n${worker}\n${sw}`;
  const appBuildId = expected.appBuildId;
  if (!appBuildId) fail("IDENTITY_APP", "expected appBuildId is required");
  if (!html.includes(appBuildId) || !main.includes(appBuildId) || !worker.includes(appBuildId) || !sw.includes(appBuildId)) {
    fail("IDENTITY_APP", "appBuildId missing from HTML/main/Worker/SW");
  }
  if (appBuildId.startsWith("git-")) {
    if (/\bnonReleaseBuild\b/.test(haystack) || /\bnonReleaseFixture\b/.test(haystack)) {
      fail("IDENTITY_NON_RELEASE", "release build still carries a non-release marker");
    }
    if (!/^git-[0-9a-f]{40}$/.test(appBuildId)) fail("IDENTITY_APP", "release appBuildId must be git-<40 hex>");
  }
  for (const [label, value] of [
    ["engineBuildId", fingerprint.engineBuildId],
    ["resultTransport", fingerprint.resultTransport],
    ["moduleSha256", fingerprint.moduleSha256],
    ["wasmSha256", fingerprint.wasmSha256],
  ]) {
    if (expected[label] && expected[label] !== value) fail("IDENTITY_ENGINE", `${label} does not match the vendor manifest`);
    if (!haystack.includes(value)) fail("IDENTITY_ENGINE", `${label} missing from emitted assets`);
  }
  if (fingerprint.resultTransport !== "binary-rawfile") fail("IDENTITY_TRANSPORT", "result transport drifted");
  return {
    ok: true,
    appBuildId,
    engineBuildId: fingerprint.engineBuildId,
    resultTransport: fingerprint.resultTransport,
    moduleSha256: fingerprint.moduleSha256,
    wasmSha256: fingerprint.wasmSha256,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dist = resolve(process.argv[2] ?? "dist/public");
  const appBuildId = process.env.APP_BUILD_ID ?? "";
  process.stdout.write(`${JSON.stringify(verifyBuildIdentity(dist, { appBuildId }), null, 2)}\n`);
}
