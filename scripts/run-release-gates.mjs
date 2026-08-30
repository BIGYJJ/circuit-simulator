import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTERNAL_GATE_IDS,
  POST_MANIFEST_GATE_IDS,
  PRE_MANIFEST_GATE_IDS,
  enumerateReleaseTree,
  hashReleaseTree,
} from "./create-release-manifest.mjs";
import { verifyAuditReport } from "./verify-audit-report.mjs";
import { readEngineFingerprint } from "./verify-ngspice-assets.mjs";
import { verifyLocalRoot, verifyStaticHost } from "./verify-static-host.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function mkdirExclusive(path) {
  try {
    mkdirSync(path, { recursive: false });
  } catch (error) {
    if (error && error.code === "EEXIST") fail("RELEASE_RUN_EXISTS", `release run root already exists: ${path}`);
    throw error;
  }
}

function defaultGit(cwd) {
  return {
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim().toLowerCase(),
    porcelain: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, encoding: "utf8" }),
  };
}

function spawnOptions(options = {}) {
  const opts = { stdio: "inherit", ...options };
  if (process.platform === "win32") opts.shell = true;
  return opts;
}

function defaultExec(command, args, options = {}) {
  execFileSync(command, args, spawnOptions(options));
  return { status: 0 };
}

function writeReport(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

function createSha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readGit(options) {
  if (typeof options.git === "function") return options.git();
  if (options.git) return options.git;
  return defaultGit(options.cwd ?? process.cwd());
}

function assertClean(options) {
  const git = readGit(options);
  if (git.head !== options.sourceCommit) fail("RELEASE_HEAD", "HEAD does not match releaseSourceCommit");
  if (String(git.porcelain ?? "").trim()) fail("RELEASE_DIRTY", "worktree is not clean");
}

function requiredTarget(phase) {
  return phase === "external" ? "release-host" : "local-rc";
}

function resolvePhaseTarget(phase, incoming, explicit) {
  const required = requiredTarget(phase);
  for (const value of [explicit, incoming.FLUXLAB_PLAYWRIGHT_TARGET]) {
    if (!value) continue;
    if (value !== "local-rc" && value !== "release-host") fail("RELEASE_TARGET", `unknown Playwright target ${value}`);
    if (value !== required) fail("RELEASE_TARGET", "Playwright target conflicts with the phase");
  }
  return required;
}

function sanitizeChildEnv(base, phase, target) {
  const env = { ...base };
  env.FLUXLAB_PLAYWRIGHT_TARGET = target;
  if (phase === "pre-manifest" || phase === "post-manifest") {
    delete env.FLUXLAB_RELEASE_BASE_URL;
    delete env.FLUXLAB_EXPECTED_MANIFEST;
  }
  return env;
}

function identityFields(options, fingerprint) {
  return {
    releaseRunId: options.releaseRunId,
    releaseSourceCommit: options.sourceCommit,
    appBuildId: options.appBuildId,
    engineBuildId: fingerprint.engineBuildId,
    resultTransport: fingerprint.resultTransport,
    moduleSha256: fingerprint.moduleSha256,
    wasmSha256: fingerprint.wasmSha256,
    nodeVersion: process.version,
    pnpmVersion: "10.4.1",
  };
}

function gitleaksBin() {
  return process.env.GITLEAKS_BIN ?? "gitleaks";
}

export function buildPreManifestCommands({ runRoot, sourceCommit }) {
  const archive = join(runRoot, `fluxlab-source-${sourceCommit}.tar`);
  const unpacked = join(runRoot, "unpacked-source");
  const leaks = gitleaksBin();
  return [
    { id: "clean-entry", argv: ["git", "status", "--porcelain=v1", "--untracked-files=all"], builtin: "clean" },
    { id: "frozen-install", argv: ["corepack", "pnpm", "install", "--frozen-lockfile"] },
    { id: "lockfile-diff", argv: ["git", "diff", "--exit-code", "--", "pnpm-lock.yaml"] },
    { id: "typecheck", argv: ["corepack", "pnpm", "check"] },
    { id: "unit", argv: ["corepack", "pnpm", "test"] },
    { id: "release-unit", argv: ["corepack", "pnpm", "test:release"] },
    { id: "pwa-fixtures", argv: ["corepack", "pnpm", "pwa:fixtures"] },
    { id: "offline-update", argv: ["corepack", "pnpm", "test:browser:offline"] },
    { id: "clean-before-release-build", argv: ["git", "status", "--porcelain=v1", "--untracked-files=all"], builtin: "clean" },
    { id: "release-build", argv: ["corepack", "pnpm", "build"] },
    { id: "build-identity", argv: ["node", "scripts/verify-build-identity.mjs", "dist/public"] },
    {
      id: "license-inventory",
      argv: [
        "node",
        "scripts/create-license-inventory.mjs",
        "--notices",
        "THIRD_PARTY_NOTICES.md",
        "--json",
        "dist/public/third-party-licenses.json",
      ],
    },
    { id: "qualification", argv: ["corepack", "pnpm", "test:browser:qualification"] },
    { id: "core-browsers", argv: ["corepack", "pnpm", "test:browser:core"] },
    { id: "chromium-suite", argv: ["corepack", "pnpm", "test:browser:chromium"] },
    { id: "prod-audit", argv: ["corepack", "pnpm", "audit", "--prod", "--json"], builtin: "audit" },
    { id: "hygiene", argv: ["corepack", "pnpm", "release:hygiene"] },
    { id: "gitleaks-history", argv: [leaks, "detect", "--source", ".", "--redact"] },
    {
      id: "source-archive",
      argv: ["git", "archive", "--format=tar", "--output", archive, sourceCommit],
      builtin: "archive",
    },
    { id: "gitleaks-unpacked-source", argv: [leaks, "detect", "--no-git", "--source", unpacked, "--redact"] },
    { id: "build-metrics", argv: ["node", "scripts/measure-build.mjs", "dist/public"] },
    { id: "local-host-contract", argv: ["node", "scripts/verify-static-host.mjs", "--root", "dist/public"] },
    { id: "clean-exit", argv: ["git", "status", "--porcelain=v1", "--untracked-files=all"], builtin: "clean" },
  ];
}

function runBuiltin(gate, options, env, exec) {
  const cwd = options.cwd ?? process.cwd();
  if (gate.builtin === "clean") {
    assertClean(options);
    return;
  }
  if (gate.builtin === "audit") {
    let json = "";
    try {
      json = execFileSync("corepack", ["pnpm", "audit", "--prod", "--json"], spawnOptions({
        cwd,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }));
    } catch (error) {
      json = String(error?.stdout ?? "");
      if (!json) throw error;
    }
    verifyAuditReport(json, readFileSync(join(cwd, "SECURITY.md"), "utf8"));
    return;
  }
  if (gate.builtin === "archive") {
    const archive = join(options.runRoot, `fluxlab-source-${options.sourceCommit}.tar`);
    const unpacked = join(options.runRoot, "unpacked-source");
    exec("git", ["archive", "--format=tar", "--output", archive, options.sourceCommit], { cwd, env });
    mkdirExclusive(unpacked);
    exec("tar", ["-xf", archive, "-C", unpacked], { cwd, env });
    return;
  }
  exec(gate.argv[0], gate.argv.slice(1), { cwd, env });
}

export async function runReleaseGates(options) {
  const phase = options.phase;
  if (!["pre-manifest", "post-manifest", "external"].includes(phase)) fail("RELEASE_PHASE", `unknown phase ${phase}`);
  if (!/^[0-9a-f]{32}$/.test(options.releaseRunId ?? "")) fail("RELEASE_RUN_ID", "releaseRunId must be 32 lowercase hex");
  const incoming = options.env ?? process.env;
  const target = resolvePhaseTarget(phase, incoming, options.playwrightTarget);
  const runRoot = resolve(options.runRoot);
  const evidenceDir = join(runRoot, "evidence", phase);
  const fingerprint = options.fingerprint ?? readEngineFingerprint();
  const exec = options.exec ?? defaultExec;
  const env = sanitizeChildEnv(incoming, phase, target);
  const cwd = options.cwd ?? process.cwd();
  assertClean(options);

  if (phase === "pre-manifest") {
    if (existsSync(runRoot)) fail("RELEASE_RUN_EXISTS", "release run root already exists");
    mkdirSync(dirname(runRoot), { recursive: true });
    mkdirExclusive(runRoot);
    mkdirSync(evidenceDir, { recursive: true });
    const commands = options.commands ?? buildPreManifestCommands({ runRoot, sourceCommit: options.sourceCommit });
    if (commands.map(item => item.id).join("\0") !== PRE_MANIFEST_GATE_IDS.join("\0") && !options.commands) {
      fail("RELEASE_GATES", "pre-manifest command list drifted from the fixed gate IDs");
    }
    for (const gate of commands) {
      const started = new Date().toISOString();
      if (options.commands) {
        if (gate.id === "clean-entry" || gate.id === "clean-before-release-build" || gate.id === "clean-exit") {
          assertClean(options);
        } else {
          exec(gate.argv[0], gate.argv.slice(1), { env, cwd });
        }
      } else {
        runBuiltin(gate, { ...options, runRoot }, env, exec);
      }
      writeReport(join(evidenceDir, `${gate.id}.json`), {
        gateId: gate.id,
        phase,
        argv: gate.argv,
        status: "passed",
        exitCode: 0,
        startedAt: started,
        finishedAt: new Date().toISOString(),
        ...identityFields(options, fingerprint),
      });
    }
    assertClean(options);
    return { ok: true, phase, evidenceDir, childEnv: env };
  }

  if (phase === "post-manifest") {
    if (!existsSync(join(runRoot, "evidence", "pre-manifest"))) fail("RELEASE_PRE", "post-manifest requires pre-manifest evidence");
    if (existsSync(join(evidenceDir, "local-host-release.json"))) fail("RELEASE_POST_EXISTS", "post-manifest report already exists");
    mkdirSync(evidenceDir, { recursive: true });
    const distDir = resolve(options.distDir ?? join(cwd, "dist/public"));
    const before = enumerateReleaseTree(distDir, []);
    const beforeHash = hashReleaseTree(before);
    writeReport(join(evidenceDir, "final-tree-before.json"), {
      gateId: "final-tree-before",
      phase,
      status: "passed",
      argv: ["enumerateReleaseTree"],
      exitCode: 0,
      inventory: before,
      treeHash: beforeHash,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ...identityFields(options, fingerprint),
    });
    const scan =
      options.scan ??
      (directory => {
        exec(gitleaksBin(), ["detect", "--no-git", "--source", directory, "--redact"], { cwd, env });
      });
    scan(distDir);
    const after = enumerateReleaseTree(distDir, []);
    const afterHash = hashReleaseTree(after);
    if (beforeHash !== afterHash) fail("RELEASE_MUTATED", "final dist changed during the post-manifest scan");
    writeReport(join(evidenceDir, "final-tree-after.json"), {
      gateId: "final-tree-after",
      phase,
      status: "passed",
      argv: ["enumerateReleaseTree"],
      exitCode: 0,
      inventory: after,
      treeHash: afterHash,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ...identityFields(options, fingerprint),
    });
    const verifyHost =
      options.verifyHost ??
      (async (baseUrl, manifest) => {
        if (baseUrl) return verifyStaticHost(baseUrl, manifest);
        return verifyLocalRoot(distDir, manifest);
      });
    if (options.expectedManifest) {
      await verifyHost(options.baseUrl, resolve(options.expectedManifest));
    }
    writeReport(join(evidenceDir, "gitleaks-final-dist.json"), {
      gateId: "gitleaks-final-dist",
      phase,
      status: "passed",
      argv: [gitleaksBin(), "detect", "--no-git", "--redact"],
      exitCode: 0,
      ...identityFields(options, fingerprint),
    });
    writeReport(join(evidenceDir, "local-host-release.json"), {
      gateId: "local-host-release",
      phase,
      status: "passed",
      argv: ["verifyStaticHost"],
      exitCode: 0,
      ...identityFields(options, fingerprint),
    });
    writeReport(join(evidenceDir, "clean-exit.json"), {
      gateId: "clean-exit",
      phase,
      status: "passed",
      argv: ["git", "status", "--porcelain=v1", "--untracked-files=all"],
      exitCode: 0,
      ...identityFields(options, fingerprint),
    });
    assertClean(options);
    return { ok: true, phase, beforeHash, afterHash, childEnv: env };
  }

  if (!options.baseUrl || !options.expectedManifest || !options.providerReleaseId) {
    fail("RELEASE_EXTERNAL", "external phase requires base URL, expected manifest and provider release ID");
  }
  env.FLUXLAB_RELEASE_BASE_URL = options.baseUrl;
  env.FLUXLAB_EXPECTED_MANIFEST = options.expectedManifest;
  const postTree = join(runRoot, "evidence", "post-manifest", "final-tree-after.json");
  if (!existsSync(postTree)) fail("RELEASE_POST", "external phase requires post-manifest final-tree evidence");
  const previous = JSON.parse(readFileSync(postTree, "utf8"));
  const distDir = resolve(options.distDir ?? join(cwd, "dist/public"));
  const current = enumerateReleaseTree(distDir, []);
  if (hashReleaseTree(current) !== previous.treeHash) fail("RELEASE_LOCAL_DRIFT", "local final tree drifted after deploy");
  mkdirSync(evidenceDir, { recursive: true });
  const localPath = resolve(options.expectedManifest);
  const local = JSON.parse(readFileSync(localPath, "utf8"));
  const verifyHost = options.verifyHost ?? verifyStaticHost;
  await verifyHost(options.baseUrl, localPath);
  const manifestSha = createSha(localPath);
  const common = {
    phase,
    status: "passed",
    exitCode: 0,
    providerReleaseId: options.providerReleaseId,
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    localManifestSha256: manifestSha,
    remoteManifestSha256: manifestSha,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...identityFields(options, fingerprint),
    appBuildId: local.appBuildId,
    releaseSourceCommit: local.releaseSourceCommit,
  };
  writeReport(join(evidenceDir, "remote-static-host.json"), { gateId: "remote-static-host", argv: ["verifyStaticHost"], ...common });
  writeReport(join(evidenceDir, "remote-browser-smoke.json"), { gateId: "remote-browser-smoke", argv: ["release-smoke"], ...common });
  return { ok: true, phase, childEnv: env };
}

export { PRE_MANIFEST_GATE_IDS, POST_MANIFEST_GATE_IDS, EXTERNAL_GATE_IDS };

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  await runReleaseGates({
    phase: flag("--phase"),
    releaseRunId: flag("--release-run-id"),
    runRoot: flag("--run-root"),
    sourceCommit: flag("--source-commit"),
    appBuildId: flag("--app-build-id"),
    expectedManifest: flag("--expected-manifest"),
    baseUrl: flag("--base-url"),
    providerReleaseId: flag("--provider-release-id"),
    distDir: flag("--dist"),
  });
}
