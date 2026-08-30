import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

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

export function resolveBuildIdentity(root, env = process.env) {
  const purpose = env.BUILD_PURPOSE ?? "verification";
  if (purpose !== "verification" && purpose !== "pwa-fixture" && purpose !== "release") {
    fail("BUILD_PURPOSE_UNKNOWN", `unknown BUILD_PURPOSE: ${purpose}`);
  }
  if (purpose === "pwa-fixture") {
    const appBuildId = env.APP_BUILD_ID;
    if (appBuildId !== "pwa-v1" && appBuildId !== "pwa-v2") {
      fail("BUILD_PURPOSE_FIXTURE", "pwa-fixture accepts only pwa-v1 or pwa-v2");
    }
    return { purpose, appBuildId, nonReleaseBuild: true, nonReleaseFixture: true };
  }
  if (purpose === "release") {
    fail("BUILD_PURPOSE_RELEASE", "release identity is reserved for a clean Task 23 commit");
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
