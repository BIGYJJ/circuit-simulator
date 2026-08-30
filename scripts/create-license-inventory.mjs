import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_ALLOWLIST, RUNTIME_ALLOWLIST } from "./verify-dependencies.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function packageLicenseFromManifest(pkg) {
  const license = pkg.license ?? pkg.licenses?.[0]?.type;
  if (!license || license === "UNLICENSED" || String(license).startsWith("SEE LICENSE IN")) {
    fail("LICENSE_UNKNOWN", `${pkg.name ?? "package"} is missing a usable license`);
  }
  return String(license);
}

function packageMeta(root, name) {
  const pkg = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
  return { name, version: pkg.version, license: packageLicenseFromManifest({ ...pkg, name }) };
}

function assertVendorLicenses(root) {
  const licenseDir = join(root, "vendor", "ngspice", "LICENSES");
  if (!existsSync(licenseDir)) fail("LICENSE_VENDOR", "vendor/ngspice/LICENSES is missing");
  for (const name of readdirSync(licenseDir)) {
    const text = readFileSync(join(licenseDir, name), "utf8");
    if (text.startsWith("version https://git-lfs.github.com/spec/v1")) fail("LICENSE_LFS", name);
  }
}

export function createLicenseInventory({ root = process.cwd(), notices, json }) {
  if (!notices || !json) fail("LICENSE_PATHS", "--notices and --json are required");
  assertVendorLicenses(root);
  const entries = [...RUNTIME_ALLOWLIST, ...DEV_ALLOWLIST]
    .map(name => packageMeta(root, name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const vendor = [
    { name: "ngspice", version: "46", license: "BSD-3-Clause AND LGPL-2.1", source: "vendor/ngspice/LICENSES" },
  ];
  const inventory = {
    schemaVersion: 1,
    generatedBy: "create-license-inventory",
    packages: [...entries, ...vendor].sort((a, b) => a.name.localeCompare(b.name)),
  };
  const lines = [
    "# Third-party notices",
    "",
    "This inventory covers the exact allowlisted runtime/dev packages plus vendored ngspice.",
    "",
    ...inventory.packages.map(item => `- ${item.name}@${item.version}: ${item.license}`),
    "",
  ];
  mkdirSync(dirname(resolve(notices)), { recursive: true });
  mkdirSync(dirname(resolve(json)), { recursive: true });
  writeFileSync(resolve(notices), lines.join("\n"));
  writeFileSync(resolve(json), `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const notices = args[args.indexOf("--notices") + 1];
  const json = args[args.indexOf("--json") + 1];
  createLicenseInventory({ notices, json });
}
