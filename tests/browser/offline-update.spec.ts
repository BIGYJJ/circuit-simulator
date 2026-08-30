import { expect, test, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startVersionedStaticServer } from "./support/versioned-static-server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const v1 = join(root, "tests/.artifacts/pwa-v1");
const v2 = join(root, "tests/.artifacts/pwa-v2");

async function waitOfflineReady(page: Page) {
  await expect(page.getByTestId("sw-status")).toHaveText("离线可用", { timeout: 120_000 });
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId("project-save-state")).toHaveText("已保存");
}

async function createAndRunRc(page: Page) {
  await page.getByRole("button", { name: "新建RC暂态" }).click();
  await page.waitForURL(/\/project\//);
  await waitSaved(page);
  await page.getByRole("button", { name: "运行暂态" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("成功 · 当前", { timeout: 120_000 });
}

test.describe.configure({ timeout: 300_000 });

test("first install stays offline-capable and V1 to V2 updates stay atomic", async ({ browser }) => {
  const server = await startVersionedStaticServer({ versions: { v1, v2 }, active: "v1" });
  const context = await browser.newContext({ baseURL: server.url, serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await waitOfflineReady(page);
    await expect(page.getByTestId("app-build-id")).toHaveText("pwa-v1");
    await createAndRunRc(page);
    const projectUrl = page.url();
    await page.close();

    await context.setOffline(true);
    const offlinePage = await context.newPage();
    await offlinePage.goto(projectUrl, { waitUntil: "domcontentloaded" });
    await waitSaved(offlinePage);
    await expect(offlinePage.getByTestId("app-build-id")).toHaveText("pwa-v1");
    await offlinePage.getByRole("button", { name: "运行暂态" }).click();
    await expect(offlinePage.getByTestId("run-status")).toHaveText("成功 · 当前", { timeout: 120_000 });
    await offlinePage.close();
    await context.setOffline(false);

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await tabA.goto("/");
    await tabB.goto("/");
    await waitOfflineReady(tabA);
    await waitOfflineReady(tabB);
    await expect(tabA.getByTestId("app-build-id")).toHaveText("pwa-v1");
    await expect(tabB.getByTestId("app-build-id")).toHaveText("pwa-v1");
    const engineV1 = await tabA.getByTestId("engine-build-id").innerText();

    server.switch("v2");
    await tabA.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect(tabA.getByTestId("sw-status")).toHaveText("保存并关闭所有 FLUXLAB 标签页后重新打开", { timeout: 60_000 });
    await expect(tabA.getByTestId("app-build-id")).toHaveText("pwa-v1");
    await expect(tabB.getByTestId("app-build-id")).toHaveText("pwa-v1");
    await expect(tabA.getByTestId("engine-build-id")).toHaveText(engineV1);
    await expect(tabB.getByTestId("engine-build-id")).toHaveText(engineV1);

    await tabA.close();
    await expect(tabB.getByTestId("app-build-id")).toHaveText("pwa-v1");
    await tabB.close();
    await new Promise(resolve => setTimeout(resolve, 2_000));

    await context.setOffline(true);
    const v2Page = await context.newPage();
    await v2Page.goto("/");
    await v2Page.reload();
    await expect(v2Page.getByTestId("app-build-id")).toHaveText("pwa-v2", { timeout: 30_000 });
    await expect(v2Page.getByTestId("engine-build-id")).toHaveText(engineV1);
    await waitOfflineReady(v2Page);
  } finally {
    await context.close();
    await server.close();
  }
});

test("a broken V2 wasm leaves V1 intact and caches never hold user data", async ({ browser }) => {
  const server = await startVersionedStaticServer({ versions: { v1, v2 }, active: "v1" });
  const context = await browser.newContext({ baseURL: server.url, serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await waitOfflineReady(page);
    await page.getByRole("button", { name: "新建RC暂态" }).click();
    await page.waitForURL(/\/project\//);
    await waitSaved(page);
    const projectId = page.url().split("/project/")[1]!.split("?")[0]!;

    server.switch("v2");
    server.failWasm(true);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await page.waitForTimeout(4_000);
    await expect(page.getByTestId("app-build-id")).toHaveText("pwa-v1");
    await expect(page.getByTestId("sw-status")).toHaveText(/离线可用|正在准备离线仿真/);

    const cacheAudit = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return { names, urls };
    });
    expect(cacheAudit.names.join(" ")).toMatch(/pwa-v1|fluxlab-pwa-v1/);
    expect(cacheAudit.urls.join("\n")).not.toContain(projectId);
    expect(cacheAudit.urls.join("\n")).not.toMatch(/\.fluxproj|RunRecord|learning-evidence/i);
  } finally {
    await context.close();
    await server.close();
  }
});
