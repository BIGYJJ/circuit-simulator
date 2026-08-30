import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startVersionedStaticServer } from "../tests/browser/support/versioned-static-server.mjs";

const ROUTES = ["/", "/settings", "/project/demo", "/learn/foundation-divider", "/divider", "/led", "/engineering", "/engineering/ops"];
const REQUIRED_SECURITY = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function discoverAssets(distDir) {
  const urls = new Set(["/index.html", "/sw.js", "/manifest.webmanifest"]);
  const manifestPath = join(distDir, ".vite", "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const entry of Object.values(manifest)) {
      if (entry.file) urls.add(`/${entry.file}`);
      for (const css of entry.css ?? []) urls.add(`/${css}`);
    }
  }
  const index = readFileSync(join(distDir, "index.html"), "utf8");
  for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (match[1].startsWith("/")) urls.add(match[1]);
  }
  for (const file of walk(distDir)) {
    const rel = file.slice(distDir.length).split("\\").join("/");
    if (rel.endsWith(".wasm") || /simulator\.worker-[^/]+\.js$/.test(rel)) urls.add(rel.startsWith("/") ? rel : `/${rel}`);
  }
  return [...urls];
}

async function fetchNoStore(url, headers) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "manual",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel();
  return response;
}

function header(response, name) {
  return (response.headers.get(name) ?? "").toLowerCase();
}

function assertSecurity(response) {
  for (const [name, expected] of Object.entries(REQUIRED_SECURITY)) {
    const actual = header(response, name);
    if (!actual.includes(expected.toLowerCase())) fail("HOST_SECURITY", `${name} missing or wrong`);
  }
}

export async function verifyStaticHost(baseUrl, expectedRelease) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(base.hostname)) {
    fail("HOST_HTTPS", "production hosts must use HTTPS");
  }
  const report = { ok: true, mode: expectedRelease ? "release" : "contract", checks: [] };
  const record = (name, ok, detail = "") => {
    report.checks.push({ name, ok, detail });
    if (!ok) report.ok = false;
  };

  for (const route of ROUTES) {
    const response = await fetchNoStore(new URL(route, base).href, { accept: "text/html" });
    try {
      assertSecurity(response);
      const type = header(response, "content-type");
      record(`route ${route}`, response.status === 200 && type.includes("text/html"), `${response.status} ${type}`);
    } catch (error) {
      record(`route ${route}`, false, error instanceof Error ? error.message : String(error));
    }
  }

  const missingJs = await fetchNoStore(new URL("/assets/missing.js", base).href);
  record("missing js 404", missingJs.status === 404 && !header(missingJs, "content-type").includes("text/html"), header(missingJs, "content-type"));
  const missingWasm = await fetchNoStore(new URL("/assets/missing.wasm", base).href);
  record("missing wasm 404", missingWasm.status === 404 && header(missingWasm, "content-type").includes("application/wasm"), header(missingWasm, "content-type"));

  if (expectedRelease) {
    const localBytes = readFileSync(expectedRelease);
    const bust = `?fluxlab=${crypto.randomUUID()}`;
    const remote = await fetch(new URL(`/release-manifest.json${bust}`, base).href, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const cache = header(remote, "cache-control");
    const remoteBytes = Buffer.from(await remote.arrayBuffer());
    record("release manifest no-cache", remote.status === 200 && cache.includes("no-cache"), cache);
    record("release manifest bytes", remote.status === 200 && sha256(remoteBytes) === sha256(localBytes), `${remote.status} ${sha256(remoteBytes)} vs ${sha256(localBytes)}`);
    let parsed = null;
    try {
      parsed = JSON.parse(remoteBytes.toString("utf8"));
    } catch {
      record("release manifest json", false, "remote manifest is not JSON");
    }
    const local = JSON.parse(localBytes.toString("utf8"));
    if (!parsed) {
      // identity/delivery checks skipped when the remote file is absent or unreadable
    } else {
    for (const key of ["releaseSourceCommit", "appBuildId", "engineBuildId", "resultTransport", "moduleSha256", "wasmSha256"]) {
      record(`identity ${key}`, local[key] === parsed[key], `${parsed[key]}`);
    }
    const localFiles = new Map((local.deliveryFiles ?? []).map(item => [item.path, item]));
    const remoteFiles = new Map((parsed.deliveryFiles ?? []).map(item => [item.path, item]));
    if (localFiles.size !== remoteFiles.size) record("delivery count", false, `${remoteFiles.size} vs ${localFiles.size}`);
    for (const [path, item] of localFiles) {
      const other = remoteFiles.get(path);
      record(`delivery ${path}`, Boolean(other && other.size === item.size && other.sha256 === item.sha256), other?.sha256 ?? "missing");
    }
    }
  }

  report.failed = report.checks.filter(item => !item.ok);
  if (!report.ok) {
    const error = new Error(report.failed.map(item => `${item.name}: ${item.detail}`).join("; "));
    error.code = "HOST_VERIFY_FAILED";
    error.report = report;
    throw error;
  }
  return report;
}

export async function verifyLocalRoot(distDir, expectedRelease) {
  const resolvedDist = resolve(distDir);
  const assets = discoverAssets(resolvedDist);
  const server = await startVersionedStaticServer({
    root: resolvedDist,
    host: "127.0.0.1",
    allowImmutableCache: true,
  });
  try {
    const report = await verifyStaticHost(server.url, expectedRelease);
    for (const asset of assets) {
      const response = await fetchNoStore(new URL(asset, server.url).href);
      if (response.status !== 200) fail("HOST_ASSET_MISSING", `${asset} -> ${response.status}`);
      if (asset.endsWith(".wasm") && !header(response, "content-type").includes("application/wasm")) {
        fail("HOST_MIME", `${asset} is not application/wasm`);
      }
      if ((asset.endsWith(".js") || asset.endsWith(".mjs") || asset.endsWith("/sw.js")) && !header(response, "content-type").includes("javascript")) {
        fail("HOST_MIME", `${asset} is not javascript`);
      }
      const cache = header(response, "cache-control");
      if (["/index.html", "/sw.js", "/manifest.webmanifest"].includes(asset) && !cache.includes("no-cache")) {
        fail("HOST_CACHE", `${asset} must be no-cache`);
      }
      if (asset.startsWith("/assets/") && asset !== "/assets/missing.js" && !cache.includes("immutable")) {
        fail("HOST_CACHE", `${asset} must be immutable`);
      }
    }
    return { ...report, assets: assets.length };
  } finally {
    await server.close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const manifestFlag = args.indexOf("--expected-manifest");
  try {
    if (rootFlag >= 0) {
      const distDir = resolve(args[rootFlag + 1] ?? "dist/public");
      const expected = manifestFlag >= 0 ? resolve(args[manifestFlag + 1]) : undefined;
      const report = await verifyLocalRoot(distDir, expected);
      process.stdout.write(`${JSON.stringify({ ok: true, assets: report.assets }, null, 2)}\n`);
    } else {
      const base = args.find(item => !item.startsWith("--"));
      if (!base) fail("HOST_BASE_REQUIRED", "pass --root or a base URL");
      const expected = manifestFlag >= 0 ? resolve(args[manifestFlag + 1]) : undefined;
      const report = await verifyStaticHost(base, expected);
      process.stdout.write(`${JSON.stringify({ ok: true, mode: report.mode }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
