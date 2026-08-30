import { defineConfig, devices } from "@playwright/test";

const qualificationCsp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      FLUXLAB_PLAYWRIGHT: "1",
    },
    headers: {
      "Content-Security-Policy": qualificationCsp,
    },
  },
});
