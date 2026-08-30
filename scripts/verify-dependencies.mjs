import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_ALLOWLIST = ["react", "react-dom", "wouter", "lucide-react", "sonner", "zod", "clsx", "tailwind-merge"];
export const DEV_ALLOWLIST = [
  "@tailwindcss/vite",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@vitejs/plugin-react",
  "@playwright/test",
  "prettier",
  "tailwindcss",
  "typescript",
  "vite",
  "vite-plugin-pwa",
  "vitest",
];

const FORBIDDEN_SPEC = /^(?:https?:|git\+|github:|file:|workspace:|link:|npm:)/i;
const FORBIDDEN_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

function fail(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  throw error;
}

export function verifyDependencies(packageJsonPath) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const runtime = Object.keys(pkg.dependencies ?? {});
  const dev = Object.keys(pkg.devDependencies ?? {});
  const unexpectedRuntime = runtime.filter(name => !RUNTIME_ALLOWLIST.includes(name));
  const unexpectedDev = dev.filter(name => !DEV_ALLOWLIST.includes(name));
  const missingRuntime = RUNTIME_ALLOWLIST.filter(name => !runtime.includes(name));
  const missingDev = DEV_ALLOWLIST.filter(name => !dev.includes(name));
  if (pkg.optionalDependencies && Object.keys(pkg.optionalDependencies).length) {
    fail("DEP_OPTIONAL", "optionalDependencies are not allowed");
  }
  if (pkg.bundledDependencies || pkg.bundleDependencies) fail("DEP_BUNDLED", "bundledDependencies are not allowed");
  if (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length) fail("DEP_PEER", "peerDependencies are not allowed");
  if (pkg.resolutions && Object.keys(pkg.resolutions).length) fail("DEP_RESOLUTIONS", "resolutions are not allowed");
  if (pkg.pnpm?.patchedDependencies || pkg.pnpm?.overrides) fail("DEP_PNPM_MUTATION", "pnpm patches/overrides are not allowed");
  for (const [name, spec] of Object.entries({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })) {
    if (FORBIDDEN_SPEC.test(String(spec))) fail("DEP_SPECIFIER", `${name} uses a forbidden specifier`);
  }
  for (const name of FORBIDDEN_SCRIPTS) {
    const script = pkg.scripts?.[name];
    if (script && /https?:|curl |wget |npx |npm i|pnpm dlx|invoke-webrequest/i.test(script)) {
      fail("DEP_SCRIPT", `${name} script downloads or executes remote code`);
    }
  }
  if (unexpectedRuntime.length || unexpectedDev.length || missingRuntime.length || missingDev.length) {
    fail("DEP_ALLOWLIST", "direct dependency surface does not match the allowlist", {
      unexpectedRuntime,
      unexpectedDev,
      missingRuntime,
      missingDev,
    });
  }
  return {
    runtimeCount: runtime.length,
    devCount: dev.length,
    unexpectedRuntime,
    unexpectedDev,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = verifyDependencies(resolve(process.argv[2] ?? "package.json"));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
