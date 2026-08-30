import { defineConfig, devices } from "@playwright/test";

const target = process.env.FLUXLAB_PLAYWRIGHT_TARGET ?? "local-rc";
if (target !== "local-rc" && target !== "release-host") {
  throw new Error(`FLUXLAB_PLAYWRIGHT_TARGET must be local-rc or release-host, got ${target}`);
}
if (target === "local-rc" && (process.env.FLUXLAB_RELEASE_BASE_URL || process.env.FLUXLAB_EXPECTED_MANIFEST)) {
  throw new Error("local-rc rejects FLUXLAB_RELEASE_BASE_URL and FLUXLAB_EXPECTED_MANIFEST");
}
if (target === "release-host") {
  const base = process.env.FLUXLAB_RELEASE_BASE_URL ?? "";
  if (!base.startsWith("https://")) throw new Error("release-host requires HTTPS FLUXLAB_RELEASE_BASE_URL");
  if (!process.env.FLUXLAB_EXPECTED_MANIFEST) throw new Error("release-host requires FLUXLAB_EXPECTED_MANIFEST");
}

const skipServer = process.env.FLUXLAB_SKIP_WEBSERVER || target === "release-host";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  use: {
    baseURL: target === "release-host" ? process.env.FLUXLAB_RELEASE_BASE_URL : "http://127.0.0.1:4173",
    trace: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: skipServer
    ? undefined
    : {
        command:
          process.env.FLUXLAB_SKIP_BUILD === "1"
            ? "node scripts/serve-local-rc.mjs"
            : "corepack pnpm build && node scripts/serve-local-rc.mjs",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
