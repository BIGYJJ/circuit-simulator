import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  parseSha256Sums,
  readEngineFingerprint,
  verifyQualifiedObservations,
} from "../../scripts/verify-ngspice-assets.mjs";
import { parseQualifiedVectorManifest } from "../../client/src/simulation/qualified-vectors.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("parses the pinned engine and rejects unknown vector keys", () => {
  const fingerprint = readEngineFingerprint(ROOT);
  assert.equal(fingerprint.version, "ngspice-46");
  assert.equal(fingerprint.resultTransport, "binary-rawfile");
  assert.equal(fingerprint.moduleSha256.length, 64);
  assert.throws(() =>
    parseQualifiedVectorManifest({
      schemaVersion: 1,
      capabilities: [],
      extra: true,
    })
  );
});

test("rejects bad {ref} syntax, duplicates, and unsorted tuples", () => {
  const base = {
    quantity: "branch-current",
    family: "R",
    analysis: "dc-op",
    rawNameTemplate: "i({ref})",
    positiveDirection: "p-to-n",
  };
  assert.throws(() =>
    parseQualifiedVectorManifest({
      schemaVersion: 1,
      capabilities: [{ ...base, rawNameTemplate: "i({REF})" }],
    })
  );
  assert.throws(() =>
    parseQualifiedVectorManifest({
      schemaVersion: 1,
      capabilities: [base, { ...base }],
    })
  );
  assert.throws(() =>
    parseQualifiedVectorManifest({
      schemaVersion: 1,
      capabilities: [
        { ...base, family: "V" },
        { ...base, family: "R" },
      ],
    })
  );
});

test("observation mismatch fails the asset verifier", () => {
  const fingerprint = readEngineFingerprint(ROOT);
  assert.throws(() => verifyQualifiedObservations(fingerprint.manifest, []));
});

test("a one-byte module change is ENGINE_MODULE_HASH_MISMATCH", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ngspice-assets-"));
  const vendor = join(dir, "vendor", "ngspice");
  await mkdir(vendor, { recursive: true });
  for (const name of [
    "ngspice.mjs",
    "ngspice.wasm",
    "RESULT_TRANSPORT.json",
    "QUALIFIED_VECTORS.json",
    "SHA256SUMS",
    "VERSION",
  ]) {
    await copyFile(join(ROOT, "vendor", "ngspice", name), join(vendor, name));
  }
  const bytes = Buffer.from(await readFile(join(vendor, "ngspice.mjs")));
  bytes[0] ^= 1;
  await writeFile(join(vendor, "ngspice.mjs"), bytes);
  try {
    assert.throws(() => readEngineFingerprint(dir), /ENGINE_MODULE_HASH_MISMATCH/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SHA256SUMS parser accepts the pinned four-file list", () => {
  const sums = parseSha256Sums(
    `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  ngspice.mjs\n`
  );
  assert.equal(sums.get("ngspice.mjs")?.length, 64);
});
