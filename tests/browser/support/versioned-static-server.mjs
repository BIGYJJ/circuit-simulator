import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const NO_CACHE = new Set(["/index.html", "/sw.js", "/manifest.webmanifest", "/release-manifest.json"]);
const NAV_PATH = /^\/(?:project(?:\/[^/]+)?|learn(?:\/[^/]+)?|settings|divider|led|engineering(?:\/ops)?)?$/;

const SECURITY = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isNavigation(request, pathname) {
  return request.method === "GET" && (request.headers.accept ?? "").includes("text/html") && NAV_PATH.test(pathname);
}

function cacheControl(pathname) {
  if (NO_CACHE.has(pathname) || pathname === "/") return "no-cache";
  if (pathname.startsWith("/assets/") || /-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm)$/.test(pathname)) {
    return "public,max-age=31536000,immutable";
  }
  return "no-cache";
}

function safeJoin(root, pathname) {
  const relative = pathname.replace(/^\/+/, "").split("/").join(sep);
  const resolved = resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + sep)) fail("HOST_TRAVERSAL", pathname);
  return resolved;
}

export async function startVersionedStaticServer(options = {}) {
  const versions = options.versions ? { ...options.versions } : options.root ? { default: options.root } : null;
  if (!versions) fail("HOST_ROOT_REQUIRED", "root or versions is required");
  let active = options.active ?? Object.keys(versions)[0];
  if (!active || !versions[active]) fail("HOST_VERSION_UNKNOWN", `unknown version ${active}`);
  const overrides = new Map();
  let failWasm = false;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const root = resolve(versions[active]);
    for (const [name, value] of Object.entries(SECURITY)) response.setHeader(name, value);

    if (failWasm && pathname.endsWith(".wasm")) {
      response.statusCode = 404;
      response.setHeader("Content-Type", "application/wasm");
      response.setHeader("Cache-Control", "no-store");
      response.end("");
      return;
    }
    const forced = overrides.get(pathname);
    if (forced) {
      response.statusCode = forced.status;
      response.setHeader("Content-Type", forced.contentType ?? "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(forced.body ?? "");
      return;
    }

    const serveFile = filePath => {
      if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
      const type = MIME[extname(filePath)] ?? "application/octet-stream";
      response.statusCode = 200;
      response.setHeader("Content-Type", type);
      response.setHeader("Cache-Control", options.allowImmutableCache ? cacheControl(pathname === "/" ? "/index.html" : pathname) : "no-store");
      createReadStream(filePath).pipe(response);
      return true;
    };

    if (isNavigation(request, pathname)) {
      if (serveFile(join(root, "index.html"))) return;
      response.statusCode = 404;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("not found");
      return;
    }

    if (serveFile(safeJoin(root, pathname === "/" ? "/index.html" : pathname))) return;
    response.statusCode = 404;
    const missingType = MIME[extname(pathname)] ?? "application/octet-stream";
    response.setHeader("Content-Type", missingType);
    response.setHeader("Cache-Control", "no-store");
    response.end("");
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") fail("HOST_LISTEN", "server address unavailable");

  return {
    url: `http://${options.host ?? "127.0.0.1"}:${address.port}`,
    switch(version) {
      if (!versions[version]) fail("HOST_VERSION_UNKNOWN", `unknown version ${version}`);
      active = version;
    },
    override(pathname, response) {
      if (!response) overrides.delete(pathname);
      else overrides.set(pathname, response);
    },
    failWasm(enabled) {
      failWasm = enabled;
    },
    close() {
      return new Promise((resolveClose, reject) => {
        server.close(error => (error ? reject(error) : resolveClose()));
      });
    },
  };
}
