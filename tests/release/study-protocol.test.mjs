import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  STUDY_PROTOCOL_VERSION,
  assertTemplateHasNoReleaseIdentity,
  createStudyInstance,
} from "../../scripts/create-study-instance.mjs";

const template = "docs/2026-08-28-circuit-simulator-modernization/06-user-study-protocol.md";
const fingerprint = {
  releaseRunId: "a".repeat(32),
  releaseSourceCommit: "b".repeat(40),
  appBuildId: `git-${"b".repeat(40)}`,
  engineBuildId: "engine",
  resultTransport: "binary-rawfile",
  moduleSha256: "c".repeat(64),
  wasmSha256: "d".repeat(64),
};

test("committed template has no RC identity", async () => {
  const text = await readFile(template, "utf8");
  assert.match(text, new RegExp(STUDY_PROTOCOL_VERSION));
  assertTemplateHasNoReleaseIdentity(text);
});

test("rejects missing or unequal external reports and freezes matching hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-study-"));
  const local = join(root, "manifest.json");
  const staticPath = join(root, "static.json");
  const browserPath = join(root, "browser.json");
  const output = join(root, "instance.json");
  const evidence = {
    phase: "external",
    status: "passed",
    providerReleaseId: "prov",
    baseUrl: "https://study.example",
    localManifestSha256: "e".repeat(64),
    remoteManifestSha256: "e".repeat(64),
    ...fingerprint,
  };
  await writeFile(local, JSON.stringify(fingerprint));
  await writeFile(staticPath, JSON.stringify({ ...evidence, gateId: "remote-static-host" }));
  await writeFile(browserPath, JSON.stringify({ ...evidence, gateId: "remote-browser-smoke" }));
  try {
    assert.throws(
      () =>
        createStudyInstance({
          template,
          localManifest: local,
          remoteStaticEvidence: staticPath,
          remoteBrowserEvidence: join(root, "missing.json"),
          providerReleaseId: "prov",
          custody: { custodian: "owner", roles: ["researcher"], retentionDays: 90, deletionDate: "2026-12-31" },
          output,
        }),
      { code: "ENOENT" }
    );
    await writeFile(
      browserPath,
      JSON.stringify({ ...evidence, gateId: "remote-browser-smoke", localManifestSha256: "f".repeat(64), remoteManifestSha256: "f".repeat(64) })
    );
    assert.throws(
      () =>
        createStudyInstance({
          template,
          localManifest: local,
          remoteStaticEvidence: staticPath,
          remoteBrowserEvidence: browserPath,
          providerReleaseId: "prov",
          custody: { custodian: "owner", roles: ["researcher"], retentionDays: 90, deletionDate: "2026-12-31" },
          output,
        }),
      { code: "STUDY_MANIFEST_HASH" }
    );
    await writeFile(browserPath, JSON.stringify({ ...evidence, gateId: "remote-browser-smoke" }));
    const instance = createStudyInstance({
      template,
      localManifest: local,
      remoteStaticEvidence: staticPath,
      remoteBrowserEvidence: browserPath,
      providerReleaseId: "prov",
      custody: { custodian: "owner", roles: ["researcher"], retentionDays: 90, deletionDate: "2026-12-31" },
      output,
    });
    assert.equal(instance.localManifestSha256, instance.remoteManifestSha256);
    assert.equal(instance.appBuildId, fingerprint.appBuildId);
    assert.equal(instance.protocolVersion, STUDY_PROTOCOL_VERSION);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
