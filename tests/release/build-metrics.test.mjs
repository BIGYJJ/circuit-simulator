import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { measureBuild } from "../../scripts/measure-build.mjs";

test("follows entry imports and CSS and does not hide unused renamed chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "fluxlab-metrics-"));
  const assets = join(root, "assets");
  await mkdir(assets);
  await mkdir(join(root, ".vite"));
  const entry = "export const entry = 1; import './vendor-aaaaaaaa.js';\n";
  const vendor = "export const vendor = 2;\n";
  const decoy = "export const decoy = 'hidden-by-rename';\n".repeat(200);
  const css = "body{color:red}\n";
  const html = `<!doctype html><link rel="stylesheet" href="/assets/main-aaaaaaaa.css"><script type="module" src="/assets/main-aaaaaaaa.js"></script>`;
  await writeFile(join(assets, "main-aaaaaaaa.js"), entry);
  await writeFile(join(assets, "vendor-aaaaaaaa.js"), vendor);
  await writeFile(join(assets, "decoy-bbbbbbbb.js"), decoy);
  await writeFile(join(assets, "main-aaaaaaaa.css"), css);
  await writeFile(join(root, "index.html"), html);
  await writeFile(
    join(root, ".vite", "manifest.json"),
    JSON.stringify({
      "src/main.tsx": {
        file: "assets/main-aaaaaaaa.js",
        src: "src/main.tsx",
        isEntry: true,
        imports: ["_vendor"],
        css: ["assets/main-aaaaaaaa.css"],
      },
      _vendor: { file: "assets/vendor-aaaaaaaa.js" },
      "src/hidden.tsx": { file: "assets/decoy-bbbbbbbb.js" },
    })
  );
  try {
    const metrics = measureBuild(root);
    const expectedJs = Buffer.byteLength(entry) + Buffer.byteLength(vendor);
    const expectedCss = Buffer.byteLength(css);
    const expectedHtml = Buffer.byteLength(html);
    assert.equal(metrics.eagerJsRaw, expectedJs);
    assert.equal(metrics.eagerJsGzip, gzipSync(Buffer.from(entry)).byteLength + gzipSync(Buffer.from(vendor)).byteLength);
    assert.equal(metrics.totalRaw, expectedJs + expectedCss + expectedHtml);
    assert.ok(metrics.eagerFiles.includes("/assets/main-aaaaaaaa.js"));
    assert.ok(metrics.eagerFiles.includes("/assets/vendor-aaaaaaaa.js"));
    assert.ok(metrics.eagerFiles.includes("/assets/main-aaaaaaaa.css"));
    assert.ok(!metrics.eagerFiles.includes("/assets/decoy-bbbbbbbb.js"));
    assert.equal(metrics.debugCollectorBytes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
