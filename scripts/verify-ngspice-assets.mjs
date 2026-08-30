import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseQualifiedVectorManifest } from "../client/src/simulation/qualified-vectors.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "vendor", "ngspice");

const REQUIRED = [
  "ngspice.mjs",
  "ngspice.wasm",
  "RESULT_TRANSPORT.json",
  "QUALIFIED_VECTORS.json",
];

export function parseSha256Sums(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-fA-F0-9]{64})\s+(\S+)$/.exec(line.trim());
    if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`);
    map.set(match[2], match[1].toLowerCase());
  }
  return map;
}

export function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readEngineFingerprint(root = ROOT) {
  const vendor = join(root, "vendor", "ngspice");
  const sums = parseSha256Sums(readFileSync(join(vendor, "SHA256SUMS"), "utf8"));
  for (const name of REQUIRED) {
    if (!sums.has(name)) throw new Error(`SHA256SUMS missing ${name}`);
  }
  const files = {};
  for (const name of REQUIRED) {
    const bytes = readFileSync(join(vendor, name));
    const actual = hashBytes(bytes);
    if (actual !== sums.get(name)) {
      const code =
        name === "ngspice.mjs"
          ? "ENGINE_MODULE_HASH_MISMATCH"
          : name === "ngspice.wasm"
            ? "ENGINE_HASH_MISMATCH"
            : "ENGINE_TRANSPORT_MISMATCH";
      const error = new Error(`${code}: ${name}`);
      error.code = name === "ngspice.mjs" ? "ENGINE_MODULE_HASH_MISMATCH" : name === "ngspice.wasm" ? "ENGINE_HASH_MISMATCH" : "ENGINE_BUILD_MISMATCH";
      throw error;
    }
    files[name] = bytes;
  }
  const transport = JSON.parse(files["RESULT_TRANSPORT.json"].toString("utf8"));
  if (transport.schemaVersion !== 1 || (transport.kind !== "vector-callback" && transport.kind !== "binary-rawfile")) {
    const error = new Error("ENGINE_TRANSPORT_MISMATCH");
    error.code = "ENGINE_TRANSPORT_MISMATCH";
    throw error;
  }
  const versionText = readFileSync(join(vendor, "VERSION"), "utf8");
  const version = versionText.split(/\r?\n/)[0].trim();
  const engineBuildId = /engineBuildId=(\S+)/.exec(versionText)?.[1];
  if (!version || !engineBuildId) {
    const error = new Error("ENGINE_VERSION_MISMATCH");
    error.code = "ENGINE_VERSION_MISMATCH";
    throw error;
  }
  const manifest = parseQualifiedVectorManifest(
    JSON.parse(files["QUALIFIED_VECTORS.json"].toString("utf8"))
  );
  return {
    version,
    engineBuildId,
    resultTransport: transport.kind,
    transport,
    manifest,
    moduleSha256: sums.get("ngspice.mjs"),
    wasmSha256: sums.get("ngspice.wasm"),
    files,
  };
}

export function verifyQualifiedObservations(manifest, observations) {
  const parsed = parseQualifiedVectorManifest(manifest);
  const expected = new Set(
    parsed.capabilities.map(item => `${item.quantity}|${item.family}|${item.analysis}`)
  );
  const seen = new Set(
    observations.map(item => `${item.quantity}|${item.family}|${item.analysis}`)
  );
  if (expected.size !== seen.size || [...expected].some(key => !seen.has(key))) {
    throw new Error("observation/matrix mismatch");
  }
}

if (process.argv.includes("--check")) {
  readEngineFingerprint(ROOT);
  console.log("ngspice assets verified");
}
