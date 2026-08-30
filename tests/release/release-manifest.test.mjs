import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PRE_MANIFEST_GATE_IDS,
  createReleaseManifest,
  enumerateReleaseTree,
  hashReleaseTree,
} from "../../scripts/create-release-manifest.mjs";
import { readEngineFingerprint } from "../../scripts/verify-ngspice-assets.mjs";

const fingerprint = readEngineFingerprint();
const identity = {
  releaseRunId: "c".repeat(32),
  releaseSourceCommit: "d".repeat(40),
  appBuildId: `git-${"d".repeat(40)}`,
  engineBuildId: fingerprint.engineBuildId,
  resultTransport: fingerprint.resultTransport,
};

async function writeReports(dir, mutate) {
  await mkdir(dir, { recursive: true });
  for (const id of PRE_MANIFEST_GATE_IDS) {
    const report = {
      gateId: id,
      phase: "pre-manifest",
      status: "passed",
      argv: [id],
      ...identity,
    };
    mutate?.(report, id);
    await writeFile(join(dir, `${id}.json`), JSON.stringify(report));
  }
}

async function seedDist(root) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html>");
  await writeFile(join(root, "notes.txt"), "unclassified");
  await writeFile(join(root, "third-party-licenses.json"), "{\"packages\":[]}\n");
}

test("enumerates unclassified files and hashes a complete passing set", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-manifest-"));
  const dist = join(root, "dist");
  const evidence = join(root, "evidence");
  const archive = join(root, "source.tar");
  try {
    await seedDist(dist);
    await writeFile(archive, "archive");
    await writeReports(evidence);
    const manifest = createReleaseManifest({
      distDir: dist,
      evidenceDir: evidence,
      sourceArchive: archive,
      releaseRunId: identity.releaseRunId,
    });
    assert.ok(manifest.deliveryFiles.some(item => item.path === "notes.txt"));
    assert.ok(manifest.deliveryFiles.some(item => item.path === "third-party-licenses.json"));
    assert.ok(!manifest.deliveryFiles.some(item => item.path === "release-manifest.json"));
    const tree = enumerateReleaseTree(dist, ["release-manifest.json"]);
    assert.equal(hashReleaseTree(tree), hashReleaseTree(manifest.deliveryFiles));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects missing, failed, duplicate, replayed, and mismatched reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-manifest-bad-"));
  const dist = join(root, "dist");
  const archive = join(root, "source.tar");
  await seedDist(dist);
  await writeFile(archive, "archive");
  try {
    const missing = join(root, "missing");
    await writeReports(missing);
    await rm(join(missing, "unit.json"));
    assert.throws(
      () =>
        createReleaseManifest({
          distDir: dist,
          evidenceDir: missing,
          sourceArchive: archive,
          releaseRunId: identity.releaseRunId,
        }),
      { code: "MANIFEST_EVIDENCE" }
    );

    const failed = join(root, "failed");
    await writeReports(failed, report => {
      if (report.gateId === "unit") report.status = "failed";
    });
    assert.throws(
      () =>
        createReleaseManifest({
          distDir: dist,
          evidenceDir: failed,
          sourceArchive: archive,
          releaseRunId: identity.releaseRunId,
        }),
      { code: "MANIFEST_EVIDENCE" }
    );

    const duplicate = join(root, "duplicate");
    await writeReports(duplicate);
    await writeFile(join(duplicate, "unit-copy.json"), JSON.stringify({ gateId: "unit", phase: "pre-manifest", status: "passed", ...identity }));
    assert.throws(
      () =>
        createReleaseManifest({
          distDir: dist,
          evidenceDir: duplicate,
          sourceArchive: archive,
          releaseRunId: identity.releaseRunId,
        }),
      { code: "MANIFEST_EVIDENCE" }
    );

    const replayed = join(root, "replayed");
    await writeReports(replayed, report => {
      if (report.gateId === "hygiene") report.releaseRunId = "e".repeat(32);
    });
    assert.throws(
      () =>
        createReleaseManifest({
          distDir: dist,
          evidenceDir: replayed,
          sourceArchive: archive,
          releaseRunId: identity.releaseRunId,
        }),
      { code: "MANIFEST_RUN" }
    );

    const wrongSource = join(root, "source");
    await writeReports(wrongSource, report => {
      if (report.gateId === "unit") report.releaseSourceCommit = "f".repeat(40);
    });
    assert.throws(
      () =>
        createReleaseManifest({
          distDir: dist,
          evidenceDir: wrongSource,
          sourceArchive: archive,
          releaseRunId: identity.releaseRunId,
        }),
      { code: "MANIFEST_SOURCE" }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a symlink in the release tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-tree-"));
  await writeFile(join(root, "index.html"), "x");
  try {
    await symlink(join(root, "index.html"), join(root, "link.html"));
    assert.throws(() => enumerateReleaseTree(root, []), { code: "TREE_SYMLINK" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "TREE_SYMLINK") throw error;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
