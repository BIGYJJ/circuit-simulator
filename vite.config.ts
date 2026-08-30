import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { readEngineFingerprint } from "./scripts/verify-ngspice-assets.mjs";

readEngineFingerprint();

const PREVIEW_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  worker: {
    format: "es",
  },
  assetsInclude: ["**/*.wasm"],
  build: {
    outDir: path.resolve(import.meta.dirname, "dist", "public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "client", "index.html"),
        qualification: path.resolve(import.meta.dirname, "client", "qualification.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    fs: {
      allow: [path.resolve(import.meta.dirname)],
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
