import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { enumerateReleaseTree, hashReleaseTree } from "../../scripts/create-release-manifest.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  EXTERNAL_GATE_IDS,
  POST_MANIFEST_GATE_IDS,
  PRE_MANIFEST_GATE_IDS,
  buildPreManifestCommands,
  runReleaseGates,
} from "../../scripts/run-release-gates.mjs";
import { readEngineFingerprint } from "../../scripts/verify-ngspice-assets.mjs";

const fingerprint = readEngineFingerprint();
const sourceCommit = "b".repeat(40);
const releaseRunId = "a".repeat(32);
const appBuildId = `git-${sourceCommit}`;

function stubGit(porcelain = "") {
  return { head: sourceCommit, porcelain };
}

test("hard-codes the pre, post and external gate IDs", () => {
  assert.deepEqual(
    PRE_MANIFEST_GATE_IDS,
    buildPreManifestCommands({ runRoot: "/tmp/run", sourceCommit }).map(item => item.id)
  );
  assert.deepEqual(POST_MANIFEST_GATE_IDS, [
    "clean-entry",
    "final-tree-before",
    "gitleaks-final-dist",
    "final-tree-after",
    "local-host-release",
    "clean-exit",
  ]);
  assert.deepEqual(EXTERNAL_GATE_IDS, [
    "clean-entry",
    "local-tree-recheck",
    "remote-static-host",
    "remote-browser-smoke",
  ]);
});

test("refuses an existing run root and dirty or mismatched HEAD", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-gates-"));
  const runRoot = join(root, "run");
  await mkdir(runRoot);
  try {
    await assert.rejects(
      () =>
        runReleaseGates({
          phase: "pre-manifest",
          releaseRunId,
          runRoot,
          sourceCommit,
          appBuildId,
          fingerprint,
          git: stubGit(),
          commands: [{ id: "unit", argv: ["true"] }],
          exec: () => ({ status: 0 }),
        }),
      { code: "RELEASE_RUN_EXISTS" }
    );
    await assert.rejects(
      () =>
        runReleaseGates({
          phase: "pre-manifest",
          releaseRunId,
          runRoot: join(root, "dirty"),
          sourceCommit,
          appBuildId,
          fingerprint,
          git: stubGit(" M file"),
          commands: [{ id: "unit", argv: ["true"] }],
          exec: () => ({ status: 0 }),
        }),
      { code: "RELEASE_DIRTY" }
    );
    await assert.rejects(
      () =>
        runReleaseGates({
          phase: "pre-manifest",
          releaseRunId,
          runRoot: join(root, "head"),
          sourceCommit,
          appBuildId,
          fingerprint,
          git: { head: "c".repeat(40), porcelain: "" },
          commands: [{ id: "unit", argv: ["true"] }],
          exec: () => ({ status: 0 }),
        }),
      { code: "RELEASE_HEAD" }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sanitizes ambient release URLs and rejects a conflicting Playwright target", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-target-"));
  try {
    await assert.rejects(
      () =>
        runReleaseGates({
          phase: "pre-manifest",
          releaseRunId,
          runRoot: join(root, "conflict"),
          sourceCommit,
          appBuildId,
          fingerprint,
          git: stubGit(),
          playwrightTarget: "release-host",
          commands: [{ id: "unit", argv: ["true"] }],
          exec: () => ({ status: 0 }),
        }),
      { code: "RELEASE_TARGET" }
    );
    await assert.rejects(
      () =>
        runReleaseGates({
          phase: "pre-manifest",
          releaseRunId,
          runRoot: join(root, "unknown"),
          sourceCommit,
          appBuildId,
          fingerprint,
          git: stubGit(),
          env: { FLUXLAB_PLAYWRIGHT_TARGET: "nightly" },
          commands: [{ id: "unit", argv: ["true"] }],
          exec: () => ({ status: 0 }),
        }),
      { code: "RELEASE_TARGET" }
    );
    let childEnv = null;
    await runReleaseGates({
      phase: "pre-manifest",
      releaseRunId,
      runRoot: join(root, "ok"),
      sourceCommit,
      appBuildId,
      fingerprint,
      git: stubGit(),
      env: {
        FLUXLAB_PLAYWRIGHT_TARGET: "local-rc",
        FLUXLAB_RELEASE_BASE_URL: "https://stale.example",
        FLUXLAB_EXPECTED_MANIFEST: "stale.json",
      },
      commands: [
        { id: "clean-entry", argv: ["true"] },
        { id: "unit", argv: ["true"] },
        { id: "clean-exit", argv: ["true"] },
      ],
      exec: (_command, _args, options) => {
        childEnv = options.env;
        return { status: 0 };
      },
    });
    assert.equal(childEnv.FLUXLAB_PLAYWRIGHT_TARGET, "local-rc");
    assert.equal(childEnv.FLUXLAB_RELEASE_BASE_URL, undefined);
    assert.equal(childEnv.FLUXLAB_EXPECTED_MANIFEST, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when a later checkpoint is dirty or a scan mutates the dist", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-mutate-"));
  const dist = join(root, "dist");
  await mkdir(dist);
  await writeFile(join(dist, "index.html"), "one");
  const state = { porcelain: "" };
  try {
    await assert.rejects(
      () =>
        runReleaseGates({
          phase: "pre-manifest",
          releaseRunId,
          runRoot: join(root, "later"),
          sourceCommit,
          appBuildId,
          fingerprint,
          git: () => ({ head: sourceCommit, porcelain: state.porcelain }),
          commands: [
            { id: "clean-entry", argv: ["true"] },
            { id: "unit", argv: ["true"] },
            { id: "clean-exit", argv: ["true"] },
          ],
          exec: () => {
            state.porcelain = " M dirty";
            return { status: 0 };
          },
        }),
      { code: "RELEASE_DIRTY" }
    );

    const runRoot = join(root, "post");
    await mkdir(join(runRoot, "evidence", "pre-manifest"), { recursive: true });
    await assert.rejects(
      () =>
        runReleaseGates({
          phase: "post-manifest",
          releaseRunId,
          runRoot,
          sourceCommit,
          appBuildId,
          fingerprint,
          git: stubGit(),
          distDir: dist,
          expectedManifest: join(dist, "release-manifest.json"),
          scan: directory => {
            writeFileSync(join(directory, "index.html"), "two");
          },
          verifyHost: async () => ({ ok: true }),
        }),
      { code: "RELEASE_MUTATED" }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("external reports bind the same RC, base URL and provider ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-ext-"));
  const dist = join(root, "dist");
  const runRoot = join(root, "run");
  await mkdir(dist);
  await writeFile(join(dist, "index.html"), "rc");
  const inventory = enumerateReleaseTree(dist, []);
  await mkdir(join(runRoot, "evidence", "post-manifest"), { recursive: true });
  await writeFile(
    join(runRoot, "evidence", "post-manifest", "final-tree-after.json"),
    JSON.stringify({
      gateId: "final-tree-after",
      treeHash: hashReleaseTree(inventory),
      inventory,
    })
  );
  const local = {
    releaseRunId,
    releaseSourceCommit: sourceCommit,
    appBuildId,
    engineBuildId: fingerprint.engineBuildId,
    resultTransport: fingerprint.resultTransport,
    moduleSha256: fingerprint.moduleSha256,
    wasmSha256: fingerprint.wasmSha256,
  };
  const manifestPath = join(root, "release-manifest.json");
  await writeFile(manifestPath, JSON.stringify(local));
  try {
    const result = await runReleaseGates({
      phase: "external",
      releaseRunId,
      runRoot,
      sourceCommit,
      appBuildId,
      fingerprint,
      git: stubGit(),
      distDir: dist,
      expectedManifest: manifestPath,
      baseUrl: "https://example.test",
      providerReleaseId: "provider-1",
      env: { FLUXLAB_PLAYWRIGHT_TARGET: "release-host" },
      verifyHost: async () => ({ ok: true }),
    });
    assert.equal(result.ok, true);
    const staticReport = JSON.parse(await readFile(join(runRoot, "evidence", "external", "remote-static-host.json"), "utf8"));
    const smoke = JSON.parse(await readFile(join(runRoot, "evidence", "external", "remote-browser-smoke.json"), "utf8"));
    assert.equal(staticReport.providerReleaseId, "provider-1");
    assert.equal(staticReport.baseUrl, smoke.baseUrl);
    assert.equal(staticReport.localManifestSha256, smoke.remoteManifestSha256);
    assert.equal(staticReport.appBuildId, appBuildId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
