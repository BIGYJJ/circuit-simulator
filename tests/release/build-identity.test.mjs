import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyBuildIdentity } from "../../scripts/verify-build-identity.mjs";
import { readEngineFingerprint } from "../../scripts/verify-ngspice-assets.mjs";

const fingerprint = readEngineFingerprint();
const commit = "a".repeat(40);
const appBuildId = `git-${commit}`;

async function writeDist(extra = "") {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-identity-"));
  await mkdir(join(root, "assets"));
  const payload = `${appBuildId} ${fingerprint.engineBuildId} ${fingerprint.resultTransport} ${fingerprint.moduleSha256} ${fingerprint.wasmSha256}${extra}`;
  await writeFile(
    join(root, "index.html"),
    `<!doctype html><meta name="app-build-id" content="${appBuildId}"><script type="module" src="/assets/main-aaaa1111.js"></script>`
  );
  await writeFile(join(root, "assets", "main-aaaa1111.js"), payload);
  await writeFile(join(root, "assets", "simulator.worker-bbbb2222.js"), payload);
  await writeFile(join(root, "sw.js"), `cacheName=${appBuildId}-${fingerprint.engineBuildId}\n${payload}`);
  return root;
}

test("release identity follows HTML, main, worker and SW", async () => {
  const root = await writeDist();
  try {
    const result = verifyBuildIdentity(root, { appBuildId, fingerprint });
    assert.equal(result.ok, true);
    assert.equal(result.engineBuildId, fingerprint.engineBuildId);
    assert.equal(result.resultTransport, "binary-rawfile");
    assert.equal(result.moduleSha256, fingerprint.moduleSha256);
    assert.equal(result.wasmSha256, fingerprint.wasmSha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification and fixture markers are rejected on a release ID", async () => {
  const root = await writeDist("\nnonReleaseBuild");
  try {
    assert.throws(() => verifyBuildIdentity(root, { appBuildId, fingerprint }), { code: "IDENTITY_NON_RELEASE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
