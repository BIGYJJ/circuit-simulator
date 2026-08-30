import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLicenseInventory, packageLicenseFromManifest } from "../../scripts/create-license-inventory.mjs";
import { DEV_ALLOWLIST, RUNTIME_ALLOWLIST } from "../../scripts/verify-dependencies.mjs";

test("writes deterministic notices and JSON for the allowlisted surface", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fluxlab-license-"));
  const notices = join(dir, "THIRD_PARTY_NOTICES.md");
  const json = join(dir, "licenses.json");
  try {
    const inventory = createLicenseInventory({ notices, json });
    assert.equal(inventory.packages.length, RUNTIME_ALLOWLIST.length + DEV_ALLOWLIST.length + 1);
    assert.ok(inventory.packages.every(item => item.license && item.version));
    assert.ok(inventory.packages.some(item => item.name === "ngspice"));
    const text = await readFile(notices, "utf8");
    assert.match(text, /react@/);
    assert.match(text, /ngspice@46/);
    const parsed = JSON.parse(await readFile(json, "utf8"));
    assert.deepEqual(
      parsed.packages.map(item => item.name),
      [...parsed.packages.map(item => item.name)].sort()
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects an unknown or missing license", () => {
  assert.throws(() => packageLicenseFromManifest({ name: "evil", license: "UNLICENSED" }), { code: "LICENSE_UNKNOWN" });
  assert.throws(() => packageLicenseFromManifest({ name: "blank" }), { code: "LICENSE_UNKNOWN" });
});
