import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const GATES = {
  eagerJsRaw: 402_000,
  eagerJsGzip: 114_000,
  totalRaw: 827_000,
  totalGzip: 220_000,
  debugCollector: 0,
};

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function toUrl(file, distDir) {
  return `/${file.slice(distDir.length).split("\\").join("/").replace(/^\/+/, "")}`;
}

function measureFile(distDir, url) {
  const path = join(distDir, url.replace(/^\//, ""));
  const raw = readFileSync(path);
  return { url, raw: raw.byteLength, gzip: gzipSync(raw).byteLength };
}

function manifestEntries(manifest) {
  return Object.values(manifest);
}

function productEntry(manifest) {
  const entries = manifestEntries(manifest).filter(item => item.isEntry);
  return (
    entries.find(item => item.src?.includes("main.tsx") || item.src?.endsWith("index.html") || /\/main-[^/]+\.js$/.test(item.file ?? "")) ??
    entries.find(item => !String(item.src ?? item.file).includes("qualification"))
  );
}

function asUrl(file) {
  return `/${String(file).replace(/^\//, "")}`;
}

function followStatic(manifest, file, seen) {
  const url = asUrl(file);
  if (seen.has(url)) return;
  seen.add(url);
  const item = manifestEntries(manifest).find(entry => asUrl(entry.file) === url);
  if (!item) return;
  for (const imported of item.imports ?? []) {
    const resolved = manifest[imported];
    if (resolved?.file) followStatic(manifest, resolved.file, seen);
  }
  for (const css of item.css ?? []) followStatic(manifest, css, seen);
}

export function measureBuild(distDir) {
  const root = resolve(distDir);
  const htmlPath = join(root, "index.html");
  const manifestPath = join(root, ".vite", "manifest.json");
  if (!existsSync(htmlPath) || !existsSync(manifestPath)) {
    const error = new Error("BUILD_METRIC_MISSING_MANIFEST");
    error.code = "BUILD_METRIC_MISSING_MANIFEST";
    throw error;
  }
  const html = readFileSync(htmlPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const eagerFiles = new Set();
  const entry = productEntry(manifest);
  if (entry?.file) followStatic(manifest, entry.file, eagerFiles);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (match[1].startsWith("/") && !match[1].includes("qualification")) eagerFiles.add(match[1]);
  }

  const measured = [...eagerFiles]
    .filter(url => existsSync(join(root, url.replace(/^\//, ""))))
    .map(url => measureFile(root, url.startsWith("/") ? url : `/${url}`));

  const eagerJs = measured.filter(item => item.url.endsWith(".js") || item.url.endsWith(".mjs"));
  const eagerCss = measured.filter(item => item.url.endsWith(".css"));
  const eagerHtml = measured.filter(item => item.url.endsWith(".html"));
  const debugCollector = measured.filter(item => /debug[-.]?collector/i.test(item.url));

  const sum = items => items.reduce((acc, item) => ({ raw: acc.raw + item.raw, gzip: acc.gzip + item.gzip }), { raw: 0, gzip: 0 });
  const eagerJsSum = sum(eagerJs);
  const totalInitial = sum([...eagerJs, ...eagerCss, ...eagerHtml, ...measured.filter(item => item.url === "/index.html")]);
  if (!eagerHtml.some(item => item.url === "/index.html")) {
    const index = measureFile(root, "/index.html");
    totalInitial.raw += index.raw;
    totalInitial.gzip += index.gzip;
  }

  const allFiles = walk(root).map(file => toUrl(file, root));
  const worker = allFiles.find(url => /simulator\.worker-[^/]+\.js$/.test(url));
  const wasm = allFiles.find(url => url.endsWith(".wasm"));
  const categories = { js: 0, css: 0, html: 0, wasm: 0, worker: 0, other: 0 };
  for (const url of allFiles) {
    const size = statSync(join(root, url.replace(/^\//, ""))).size;
    if (/simulator\.worker-[^/]+\.js$/.test(url) || /qualification\.worker-[^/]+\.js$/.test(url)) categories.worker += size;
    else if (url.endsWith(".wasm")) categories.wasm += size;
    else if (url.endsWith(".js") || url.endsWith(".mjs")) categories.js += size;
    else if (url.endsWith(".css")) categories.css += size;
    else if (url.endsWith(".html")) categories.html += size;
    else categories.other += size;
  }

  return {
    eagerFiles: measured.map(item => item.url).sort(),
    eagerJsRaw: eagerJsSum.raw,
    eagerJsGzip: eagerJsSum.gzip,
    totalRaw: totalInitial.raw,
    totalGzip: totalInitial.gzip,
    debugCollectorBytes: sum(debugCollector).raw,
    worker: worker ? measureFile(root, worker) : null,
    wasm: wasm ? measureFile(root, wasm) : null,
    categories,
    gates: GATES,
  };
}

export function assertBuildGates(metrics) {
  if (metrics.eagerJsRaw > GATES.eagerJsRaw) throw new Error(`BUILD_EAGER_JS_RAW ${metrics.eagerJsRaw}`);
  if (metrics.eagerJsGzip > GATES.eagerJsGzip) throw new Error(`BUILD_EAGER_JS_GZIP ${metrics.eagerJsGzip}`);
  if (metrics.totalRaw > GATES.totalRaw) throw new Error(`BUILD_TOTAL_RAW ${metrics.totalRaw}`);
  if (metrics.totalGzip > GATES.totalGzip) throw new Error(`BUILD_TOTAL_GZIP ${metrics.totalGzip}`);
  if (metrics.debugCollectorBytes > GATES.debugCollector) throw new Error(`BUILD_DEBUG_COLLECTOR ${metrics.debugCollectorBytes}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const distDir = resolve(process.argv[2] ?? "dist/public");
  const metrics = measureBuild(distDir);
  process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
  assertBuildGates(metrics);
}
