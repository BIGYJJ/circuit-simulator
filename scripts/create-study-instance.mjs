import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STUDY_PROTOCOL_VERSION = "2026-08-28-user-study-v1";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function assertTemplateHasNoReleaseIdentity(templateText) {
  if (/git-[0-9a-f]{40}/i.test(templateText)) fail("STUDY_TEMPLATE_IDENTITY", "template must not contain a release commit");
  if (/releaseSourceCommit\s*[:=]\s*["']?[0-9a-f]{40}/i.test(templateText)) {
    fail("STUDY_TEMPLATE_IDENTITY", "template must not freeze a source commit");
  }
  if (/appBuildId\s*[:=]\s*["']?git-/i.test(templateText)) {
    fail("STUDY_TEMPLATE_IDENTITY", "template must not freeze an app build ID");
  }
  if (/releaseRunId\s*[:=]\s*["']?[0-9a-f]{32}/i.test(templateText)) {
    fail("STUDY_TEMPLATE_IDENTITY", "template must not freeze a release run ID");
  }
}

function readJson(value, label) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") fail("STUDY_INPUT", `${label} is required`);
  return JSON.parse(readFileSync(resolve(value), "utf8"));
}

function requirePassed(report, gateId) {
  if (report.gateId !== gateId || report.phase !== "external" || report.status !== "passed") {
    fail("STUDY_EVIDENCE", `${gateId} is not a passed external report`);
  }
}

const IDENTITY_KEYS = [
  "releaseRunId",
  "releaseSourceCommit",
  "appBuildId",
  "engineBuildId",
  "resultTransport",
  "moduleSha256",
  "wasmSha256",
];

export function createStudyInstance(options) {
  const templatePath = resolve(options.template);
  const templateText = readFileSync(templatePath, "utf8");
  assertTemplateHasNoReleaseIdentity(templateText);
  if (!templateText.includes(STUDY_PROTOCOL_VERSION)) {
    fail("STUDY_PROTOCOL", "template must declare the checked-in protocol version");
  }
  const local = readJson(options.localManifest, "localManifest");
  const remoteStatic = readJson(options.remoteStaticEvidence, "remoteStaticEvidence");
  const remoteBrowser = readJson(options.remoteBrowserEvidence, "remoteBrowserEvidence");
  requirePassed(remoteStatic, "remote-static-host");
  requirePassed(remoteBrowser, "remote-browser-smoke");
  if (remoteStatic.releaseRunId !== remoteBrowser.releaseRunId) fail("STUDY_RUN", "external reports disagree on releaseRunId");
  for (const key of IDENTITY_KEYS) {
    if (!local[key] || local[key] !== remoteStatic[key] || local[key] !== remoteBrowser[key]) {
      fail("STUDY_IDENTITY", `identity field ${key} is missing or unequal`);
    }
  }
  const providerReleaseId = options.providerReleaseId ?? "";
  if (!providerReleaseId) fail("STUDY_PROVIDER", "providerReleaseId is required");
  if (remoteStatic.providerReleaseId !== providerReleaseId || remoteBrowser.providerReleaseId !== providerReleaseId) {
    fail("STUDY_PROVIDER", "provider release ID drifted");
  }
  if (!remoteStatic.localManifestSha256 || remoteStatic.localManifestSha256 !== remoteStatic.remoteManifestSha256) {
    fail("STUDY_MANIFEST_HASH", "static evidence local/remote manifest hashes must match");
  }
  if (
    remoteStatic.localManifestSha256 !== remoteBrowser.localManifestSha256 ||
    remoteStatic.remoteManifestSha256 !== remoteBrowser.remoteManifestSha256
  ) {
    fail("STUDY_MANIFEST_HASH", "static and browser evidence disagree on manifest hashes");
  }
  if (remoteStatic.baseUrl !== remoteBrowser.baseUrl) fail("STUDY_BASE", "external reports disagree on base URL");
  const custody = readJson(options.custody, "custody");
  for (const field of ["custodian", "roles", "retentionDays", "deletionDate"]) {
    if (custody[field] === undefined || custody[field] === "") fail("STUDY_CUSTODY", `custody.${field} is required`);
  }
  const instance = {
    schemaVersion: 1,
    protocolVersion: STUDY_PROTOCOL_VERSION,
    releaseRunId: local.releaseRunId,
    releaseSourceCommit: local.releaseSourceCommit,
    appBuildId: local.appBuildId,
    engineBuildId: local.engineBuildId,
    resultTransport: local.resultTransport,
    moduleSha256: local.moduleSha256,
    wasmSha256: local.wasmSha256,
    providerReleaseId,
    baseUrl: remoteStatic.baseUrl,
    localManifestSha256: remoteStatic.localManifestSha256,
    remoteManifestSha256: remoteStatic.remoteManifestSha256,
    custody: {
      custodian: custody.custodian,
      roles: custody.roles,
      retentionDays: custody.retentionDays,
      deletionDate: custody.deletionDate,
    },
    createdAt: new Date().toISOString(),
  };
  const output = resolve(options.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(instance, null, 2)}\n`);
  return instance;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  createStudyInstance({
    template: flag("--template"),
    localManifest: flag("--local-manifest"),
    remoteStaticEvidence: flag("--remote-static-evidence"),
    remoteBrowserEvidence: flag("--remote-browser-evidence"),
    providerReleaseId: flag("--provider-release-id"),
    custody: flag("--custody"),
    output: flag("--output"),
  });
}
