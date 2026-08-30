import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isReleasePredicate, resolveBuildIdentity } from "../../scripts/resolve-build-identity.mjs";

async function seedTree(root) {
  await mkdir(join(root, "client"), { recursive: true });
  await mkdir(join(root, "vendor", "ngspice"), { recursive: true });
  await writeFile(join(root, "client", "a.ts"), "export const a = 1;\n");
  await writeFile(join(root, "vendor", "ngspice", "VERSION"), "ngspice-46\n");
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
  await writeFile(join(root, "vite.config.ts"), "export default {};\n");
  await writeFile(join(root, "tsconfig.json"), "{}\n");
  await writeFile(join(root, "tsconfig.node.json"), "{}\n");
}

test("verification identity is stable across directory order and changes with one byte", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-id-"));
  try {
    await seedTree(root);
    await writeFile(join(root, "client", "z.ts"), "export const z = 1;\n");
    const first = resolveBuildIdentity(root, { BUILD_PURPOSE: "verification" });
    const second = resolveBuildIdentity(root, {});
    assert.equal(first.appBuildId, second.appBuildId);
    assert.match(first.appBuildId, /^verify-[a-f0-9]{64}$/);
    assert.equal(first.nonReleaseBuild, true);
    assert.equal(isReleasePredicate(first), false);
    await writeFile(join(root, "client", "a.ts"), "export const a = 2;\n");
    const changed = resolveBuildIdentity(root, { BUILD_PURPOSE: "verification" });
    assert.notEqual(changed.appBuildId, first.appBuildId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown purpose and symlink fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-id-bad-"));
  try {
    await seedTree(root);
    assert.throws(() => resolveBuildIdentity(root, { BUILD_PURPOSE: "nightly" }), { code: "BUILD_PURPOSE_UNKNOWN" });
    try {
      await symlink(join(root, "client", "a.ts"), join(root, "client", "link.ts"));
      assert.throws(() => resolveBuildIdentity(root, { BUILD_PURPOSE: "verification" }), { code: "BUILD_IDENTITY_SYMLINK" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "BUILD_IDENTITY_SYMLINK") throw error;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pwa fixture ids are non-release and unknown fixture ids fail", () => {
  const root = process.cwd();
  const identity = resolveBuildIdentity(root, { BUILD_PURPOSE: "pwa-fixture", APP_BUILD_ID: "pwa-v1" });
  assert.equal(identity.appBuildId, "pwa-v1");
  assert.equal(identity.nonReleaseBuild, true);
  assert.equal(identity.nonReleaseFixture, true);
  assert.equal(isReleasePredicate(identity), false);
  assert.throws(() => resolveBuildIdentity(root, { BUILD_PURPOSE: "pwa-fixture", APP_BUILD_ID: "pwa-v3" }), {
    code: "BUILD_PURPOSE_FIXTURE",
  });
  assert.throws(() => resolveBuildIdentity(root, { BUILD_PURPOSE: "pwa-fixture" }), { code: "BUILD_PURPOSE_FIXTURE" });
  assert.throws(
    () => resolveBuildIdentity(root, { BUILD_PURPOSE: "verification", APP_BUILD_ID: "pwa-v1" }),
    { code: "BUILD_PURPOSE_FIXTURE" }
  );
  assert.throws(
    () => resolveBuildIdentity(root, { BUILD_PURPOSE: "pwa-fixture", APP_BUILD_ID: "pwa-v1" }, { outDir: join(root, "dist", "public") }),
    { code: "BUILD_PURPOSE_FIXTURE" }
  );
  assert.throws(
    () => resolveBuildIdentity(root, { BUILD_PURPOSE: "pwa-fixture", APP_BUILD_ID: "pwa-v1" }, { outDir: join(root, "tmp", "pwa-v1") }),
    { code: "BUILD_PURPOSE_FIXTURE" }
  );
  const okDir = resolveBuildIdentity(root, { BUILD_PURPOSE: "pwa-fixture", APP_BUILD_ID: "pwa-v2" }, {
    outDir: join(root, "tests", ".artifacts", "pwa-v2"),
  });
  assert.equal(okDir.appBuildId, "pwa-v2");
});

test("release identity requires a matching clean HEAD", () => {
  const commit = "1".repeat(40);
  const identity = resolveBuildIdentity(process.cwd(), {
    BUILD_PURPOSE: "release",
    RELEASE_SOURCE_COMMIT: commit,
    APP_BUILD_ID: `git-${commit}`,
  }, { git: { head: commit, porcelain: "" } });
  assert.equal(identity.appBuildId, `git-${commit}`);
  assert.equal(identity.nonReleaseBuild, false);
  assert.equal(isReleasePredicate(identity), true);
  const withViteTemp = resolveBuildIdentity(
    process.cwd(),
    { BUILD_PURPOSE: "release", RELEASE_SOURCE_COMMIT: commit, APP_BUILD_ID: `git-${commit}` },
    { git: { head: commit, porcelain: "?? vite.config.ts.timestamp-1-abc.mjs\n" } }
  );
  assert.equal(withViteTemp.appBuildId, `git-${commit}`);
  assert.throws(
    () =>
      resolveBuildIdentity(
        process.cwd(),
        { BUILD_PURPOSE: "release", RELEASE_SOURCE_COMMIT: commit, APP_BUILD_ID: `git-${commit}` },
        { git: { head: "2".repeat(40), porcelain: "" } }
      ),
    { code: "BUILD_PURPOSE_RELEASE" }
  );
  assert.throws(
    () =>
      resolveBuildIdentity(
        process.cwd(),
        { BUILD_PURPOSE: "release", RELEASE_SOURCE_COMMIT: commit, APP_BUILD_ID: `git-${commit}` },
        { git: { head: commit, porcelain: " M vite.config.ts" } }
      ),
    { code: "BUILD_PURPOSE_RELEASE" }
  );
});
