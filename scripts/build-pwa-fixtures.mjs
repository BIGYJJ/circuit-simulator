import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureOutputDir, resolveBuildIdentity } from "./resolve-build-identity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runVite(appBuildId) {
  const outDir = fixtureOutputDir(root, appBuildId);
  resolveBuildIdentity(root, { ...process.env, BUILD_PURPOSE: "pwa-fixture", APP_BUILD_ID: appBuildId }, { outDir });
  return new Promise((resolveExit, reject) => {
    const child = spawn("corepack", ["pnpm", "exec", "vite", "build"], {
      cwd: root,
      env: { ...process.env, BUILD_PURPOSE: "pwa-fixture", APP_BUILD_ID: appBuildId },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolveExit();
      else reject(new Error(`pwa fixture ${appBuildId} failed with exit ${code}`));
    });
  });
}

async function buildOne(appBuildId) {
  const outDir = fixtureOutputDir(root, appBuildId);
  await runVite(appBuildId);
  await writeFile(
    join(outDir, "non-release-fixture.json"),
    `${JSON.stringify({ nonReleaseFixture: true, appBuildId, purpose: "pwa-fixture" }, null, 2)}\n`
  );
}

await buildOne("pwa-v1");
await buildOne("pwa-v2");
