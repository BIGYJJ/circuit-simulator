import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startVersionedStaticServer } from "../browser/support/versioned-static-server.mjs";
import { verifyStaticHost } from "../../scripts/verify-static-host.mjs";

test("rewrites navigation but returns a real 404 for a missing module", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-host-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>fixture</title>");
  await writeFile(join(root, "assets", "app-12345678.js"), "export {};");
  const server = await startVersionedStaticServer({ root, allowImmutableCache: true });
  try {
    const route = await fetch(`${server.url}/learn/foundation-divider`, { headers: { accept: "text/html" } });
    const missing = await fetch(`${server.url}/assets/missing.js`);
    assert.equal(route.status, 200);
    assert.match(route.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(missing.status, 404);
    assert.doesNotMatch(missing.headers.get("content-type") ?? "", /text\/html/);
  } finally {
    await server.close();
    await rm(root, { recursive: true });
  }
});

function manifest(overrides = {}) {
  return {
    releaseRunId: "a".repeat(32),
    releaseSourceCommit: "b".repeat(40),
    appBuildId: `git-${"b".repeat(40)}`,
    engineBuildId: "engine",
    resultTransport: "binary-rawfile",
    moduleSha256: "c".repeat(64),
    wasmSha256: "d".repeat(64),
    deliveryFiles: [{ path: "index.html", size: 12, sha256: "e".repeat(64) }],
    ...overrides,
  };
}

test("release mode fails a missing, drifted, older, omitted, or tampered manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-rel-"));
  const local = join(root, "local-manifest.json");
  const expected = manifest();
  await writeFile(local, JSON.stringify(expected));
  await writeFile(join(root, "index.html"), "<!doctype html><title>x</title>");
  const server = await startVersionedStaticServer({ root, allowImmutableCache: true });
  try {
    await assert.rejects(() => verifyStaticHost(server.url, local), { code: "HOST_VERIFY_FAILED" });

    await writeFile(join(root, "release-manifest.json"), JSON.stringify({ ...expected, appBuildId: "older" }));
    await assert.rejects(() => verifyStaticHost(server.url, local), { code: "HOST_VERIFY_FAILED" });

    await writeFile(join(root, "release-manifest.json"), `${JSON.stringify(expected)} `);
    await assert.rejects(() => verifyStaticHost(server.url, local), { code: "HOST_VERIFY_FAILED" });

    await writeFile(
      join(root, "release-manifest.json"),
      JSON.stringify(manifest({ deliveryFiles: [] }))
    );
    await assert.rejects(() => verifyStaticHost(server.url, local), { code: "HOST_VERIFY_FAILED" });

    await writeFile(
      join(root, "release-manifest.json"),
      JSON.stringify(manifest({ deliveryFiles: [{ path: "index.html", size: 12, sha256: "f".repeat(64) }] }))
    );
    await assert.rejects(() => verifyStaticHost(server.url, local), { code: "HOST_VERIFY_FAILED" });
  } finally {
    await server.close();
    await rm(root, { recursive: true });
  }
});

test("release mode accepts matching raw manifest bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-rel-ok-"));
  const expected = manifest();
  const local = join(root, "local-manifest.json");
  const body = JSON.stringify(expected);
  await writeFile(local, body);
  await writeFile(join(root, "index.html"), "<!doctype html><title>ok</title>");
  await writeFile(join(root, "release-manifest.json"), body);
  const server = await startVersionedStaticServer({ root, allowImmutableCache: true });
  try {
    const report = await verifyStaticHost(server.url, local);
    assert.equal(report.ok, true);
    assert.equal(report.mode, "release");
  } finally {
    await server.close();
    await rm(root, { recursive: true });
  }
});
