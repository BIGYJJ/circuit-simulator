import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const EXTRA_FILES = ["package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json", "tsconfig.node.json"];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function walkFiles(root, directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) fail("BUILD_IDENTITY_SYMLINK", `symlink is not allowed: ${fullPath}`);
    if (stat.isDirectory()) {
      walkFiles(root, fullPath, files);
      continue;
    }
    if (!stat.isFile()) fail("BUILD_IDENTITY_ENTRY", `unsupported tree entry: ${fullPath}`);
    files.push(fullPath);
  }
}

function slashRelative(root, fullPath) {
  return relative(root, fullPath).split(sep).join("/");
}

export function isReleasePredicate(identity) {
  return Boolean(identity && identity.nonReleaseBuild === false && typeof identity.appBuildId === "string" && identity.appBuildId.startsWith("git-"));
}

export function fixtureOutputDir(root, appBuildId) {
  return resolve(root, "tests", ".artifacts", appBuildId);
}

export function resolveBuildIdentity(root, env = process.env, options = {}) {
  const purpose = env.BUILD_PURPOSE ?? "verification";
  if (purpose !== "verification" && purpose !== "pwa-fixture" && purpose !== "release") {
    fail("BUILD_PURPOSE_UNKNOWN", `unknown BUILD_PURPOSE: ${purpose}`);
  }
  if (purpose !== "pwa-fixture" && (env.APP_BUILD_ID === "pwa-v1" || env.APP_BUILD_ID === "pwa-v2")) {
    fail("BUILD_PURPOSE_FIXTURE", "fixture IDs are invalid outside pwa-fixture");
  }
  if (purpose === "pwa-fixture") {
    const appBuildId = env.APP_BUILD_ID;
    if (appBuildId !== "pwa-v1" && appBuildId !== "pwa-v2") {
      fail("BUILD_PURPOSE_FIXTURE", "pwa-fixture accepts only pwa-v1 or pwa-v2");
    }
    const identity = { purpose, appBuildId, nonReleaseBuild: true, nonReleaseFixture: true };
    if (isReleasePredicate(identity)) fail("BUILD_PURPOSE_FIXTURE", "fixture identity must not be a release");
    if (options.outDir) {
      const resolved = resolve(options.outDir);
      if (resolved === resolve(root, "dist", "public")) {
        fail("BUILD_PURPOSE_FIXTURE", "fixture must not write dist/public");
      }
      if (resolved !== fixtureOutputDir(root, appBuildId)) {
        fail("BUILD_PURPOSE_FIXTURE", "fixture output must be tests/.artifacts/pwa-v1|pwa-v2");
      }
    }
    return identity;
  }
  if (purpose === "release") {
    const source = String(env.RELEASE_SOURCE_COMMIT ?? "").toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(source)) fail("BUILD_PURPOSE_RELEASE", "RELEASE_SOURCE_COMMIT must be 40 lowercase hex");
    const appBuildId = env.APP_BUILD_ID;
    if (appBuildId !== `git-${source}`) fail("BUILD_PURPOSE_RELEASE", "APP_BUILD_ID must be git-<releaseSourceCommit>");
    const git = options.git ?? {
      head: execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim().toLowerCase(),
      porcelain: execSync("git status --porcelain=v1 --untracked-files=all", { cwd: root, encoding: "utf8" }),
    };
    if (git.head !== source) fail("BUILD_PURPOSE_RELEASE", "HEAD must equal RELEASE_SOURCE_COMMIT");
    if (String(git.porcelain ?? "").trim()) fail("BUILD_PURPOSE_RELEASE", "release requires a clean worktree");
    const identity = { purpose: "release", appBuildId, releaseSourceCommit: source, nonReleaseBuild: false };
    if (!isReleasePredicate(identity)) fail("BUILD_PURPOSE_RELEASE", "release identity is invalid");
    return identity;
  }
  const files = [];
  walkFiles(root, join(root, "client"), files);
  walkFiles(root, join(root, "vendor", "ngspice"), files);
  for (const name of EXTRA_FILES) files.push(join(root, name));
  const entries = files
    .map(fullPath => {
      const bytes = readFileSync(fullPath);
      return { path: slashRelative(root, fullPath), bytes };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.path, "utf8");
    hash.update("\0");
    hash.update(String(entry.bytes.byteLength), "utf8");
    hash.update("\0");
    hash.update(entry.bytes);
    hash.update("\0");
  }
  return {
    purpose: "verification",
    appBuildId: `verify-${hash.digest("hex")}`,
    nonReleaseBuild: true,
  };
}
