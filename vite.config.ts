import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { fixtureOutputDir, resolveBuildIdentity } from "./scripts/resolve-build-identity.mjs";
import { readEngineFingerprint } from "./scripts/verify-ngspice-assets.mjs";

const root = path.resolve(import.meta.dirname);
const fingerprint = readEngineFingerprint();
const purpose = process.env.BUILD_PURPOSE ?? "verification";
const tentativeOutDir =
  purpose === "pwa-fixture" && (process.env.APP_BUILD_ID === "pwa-v1" || process.env.APP_BUILD_ID === "pwa-v2")
    ? fixtureOutputDir(root, process.env.APP_BUILD_ID)
    : path.resolve(root, "dist", "public");
const buildIdentity = resolveBuildIdentity(root, process.env, { outDir: tentativeOutDir });
const outDir =
  buildIdentity.purpose === "pwa-fixture"
    ? fixtureOutputDir(root, buildIdentity.appBuildId)
    : path.resolve(root, "dist", "public");
const engineFiles = fingerprint.files as Record<string, Uint8Array>;
const maximumFileSizeToCacheInBytes =
  Math.max(engineFiles["ngspice.wasm"]!.byteLength, engineFiles["ngspice.mjs"]!.byteLength) + 65_536;

const PREVIEW_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'";

function walkFiles(directory: string, files: string[]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, files);
    else if (entry.isFile()) files.push(fullPath);
  }
}

function assertPwaPrecache(): Plugin {
  return {
    name: "assert-pwa-precache",
    closeBundle: {
      sequential: true,
      order: "post",
      handler() {
      if (!existsSync(path.join(outDir, "sw.js"))) throw new Error("PWA_PRECACHE_MISSING_SW");
      const sw = readFileSync(path.join(outDir, "sw.js"), "utf8");
      const files: string[] = [];
      walkFiles(outDir, files);
      const relative = files.map(item => path.relative(outDir, item).split(path.sep).join("/"));
      if (relative.some(item => item.endsWith("ngspice.mjs"))) throw new Error("PWA_STANDALONE_NGSPICE_MJS");
      const worker = relative.find(item => /simulator\.worker-[^/]+\.js$/.test(item));
      const wasm = relative.find(item => item.endsWith(".wasm"));
      if (!worker || !sw.includes(path.posix.basename(worker))) throw new Error("PWA_PRECACHE_MISSING_WORKER");
      if (!wasm || !sw.includes(path.posix.basename(wasm))) throw new Error("PWA_PRECACHE_MISSING_WASM");
      if (!relative.includes("manifest.webmanifest") || !sw.includes("manifest.webmanifest")) {
        throw new Error("PWA_PRECACHE_MISSING_MANIFEST");
      }
      const appJs = relative.filter(item => item.startsWith("assets/") && item.endsWith(".js") && !item.includes("worker"));
      const appSource = appJs.map(item => readFileSync(path.join(outDir, item), "utf8")).join("\n");
      if (!appSource.includes("foundation-divider") || !appSource.includes(".model DLED")) {
        throw new Error("PWA_PRECACHE_MISSING_LESSON_OR_MODEL");
      }
      },
    },
  };
}

export default defineConfig({
  define: {
    __FLUXLAB_APP_BUILD_ID__: JSON.stringify(buildIdentity.appBuildId),
    __FLUXLAB_NON_RELEASE_BUILD__: JSON.stringify(buildIdentity.nonReleaseBuild),
    __FLUXLAB_NON_RELEASE_FIXTURE__: JSON.stringify("nonReleaseFixture" in buildIdentity && buildIdentity.nonReleaseFixture === true),
    __FLUXLAB_ENGINE_BUILD_ID__: JSON.stringify(fingerprint.engineBuildId),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      integration: { closeBundleOrder: "pre" },
      registerType: "prompt",
      injectRegister: false,
      strategies: "generateSW",
      filename: "sw.js",
      scope: "/",
      includeAssets: ["icons/fluxlab.svg"],
      manifest: {
        name: "FLUXLAB",
        short_name: "FLUXLAB",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#090b0a",
        theme_color: "#090b0a",
        icons: [{ src: "/icons/fluxlab.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        cleanupOutdatedCaches: true,
        cacheId: `fluxlab-${buildIdentity.appBuildId}-${fingerprint.engineBuildId}`,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /\.js$/i,
          /\.mjs$/i,
          /\.wasm$/i,
          /\.css$/i,
          /\.json$/i,
          /\.(?:png|svg|jpe?g|gif|webp|ico)$/i,
          /\.(?:woff2?|ttf|otf)$/i,
          /\/assets\//,
        ],
        globPatterns: ["**/*.{js,css,html,wasm,svg,webmanifest,json}"],
        maximumFileSizeToCacheInBytes,
      },
    }),
    assertPwaPrecache(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
    },
  },
  root: path.resolve(root, "client"),
  publicDir: path.resolve(root, "client", "public"),
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  assetsInclude: ["**/*.wasm"],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(root, "client", "index.html"),
        qualification: path.resolve(root, "client", "qualification.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    fs: {
      allow: [root],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: {
      "Content-Security-Policy": PREVIEW_CSP,
    },
  },
});
