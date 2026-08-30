import { expect, test, type Page } from "@playwright/test";
import { fillLabeled } from "./support/fill-labeled";

async function openDatabase(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("fluxlab", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("projects")) {
          const projects = db.createObjectStore("projects");
          projects.createIndex("listKey", "listKey", { unique: true });
          projects.createIndex("revisionKey", "revisionKey", { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return Boolean(database.objectStoreNames.contains("projects"));
  });
}

test("edits electrical and layout state, undo/redoes, and reloads one project", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.waitForURL(/\/project\//);
  const projectUrl = page.url();
  await expect(page.getByText("9V 分压器实验")).toBeVisible();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 1 / 电气 1");

  await page.getByRole("button", { name: "选择 R2" }).click();
  await fillLabeled(page, "电阻（Ω）", "3000");
  await page.getByRole("button", { name: "应用参数" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 2 / 电气 2");

  await page.getByTestId("component-R2").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("project-revision")).toHaveText("修订 3 / 电气 2");
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 4 / 电气 2");
  await page.getByRole("button", { name: "重做" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 5 / 电气 2");
  await expect(page.getByText("已保存")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByTestId("project-revision")).toHaveText("修订 5 / 电气 2");

  const storedCount = await page.evaluate(async () => {
    const request = indexedDB.open("fluxlab");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = database.transaction("projects").objectStore("projects").count();
    return await new Promise<number>((resolve, reject) => {
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  });
  expect(storedCount).toBe(1);
});

test("broken project records stay diagnostic and leave the library usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "新建分压项目" })).toBeVisible();
  await openDatabase(page);
  await page.evaluate(async () => {
    const request = indexedDB.open("fluxlab", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("projects", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("projects").put({ schemaVersion: 2, id: "broken" }, "broken");
    });
  });
  await page.goto("/project/broken");
  await expect(page.getByText("STORAGE_INVALID_PROJECT")).toBeVisible();
  await expect(page.getByRole("link", { name: "项目库" })).toBeVisible();
  await page.getByRole("link", { name: "项目库" }).click();
  await expect(page.getByRole("button", { name: "新建分压项目" })).toBeVisible();
});

test("coalesces a later revision while an earlier save is delayed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 1 / 电气 1");
  await page.evaluate(() => {
    window.__fluxlabTestDelaySaveMs = 800;
  });
  await page.getByRole("button", { name: "选择 R2" }).click();
  await fillLabeled(page, "电阻（Ω）", "3000");
  await page.getByRole("button", { name: "应用参数" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 2 / 电气 2");
  await page.getByTestId("component-R2").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("project-revision")).toHaveText("修订 3 / 电气 2");
  await expect(page.getByTestId("project-save-state")).not.toContainText("已保存");
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("project-revision")).toHaveText("修订 3 / 电气 2");
  await page.reload();
  await expect(page.getByTestId("project-revision")).toHaveText("修订 3 / 电气 2");
});

test("project library lists a large envelope from key cursors only", async ({ page }) => {
  await page.addInitScript(() => {
    const proto = IDBObjectStore.prototype;
    if ((window as Window & { __idbPatched?: boolean }).__idbPatched) return;
    (window as Window & { __idbPatched?: boolean }).__idbPatched = true;
    window.__idbGets = 0;
    window.__idbGetAlls = 0;
    const get = proto.get;
    const getAll = proto.getAll;
    proto.get = function patchedGet(...args) {
      if (this.name === "projects") window.__idbGets = (window.__idbGets ?? 0) + 1;
      return get.apply(this, args);
    };
    proto.getAll = function patchedGetAll(...args) {
      if (this.name === "projects") window.__idbGetAlls = (window.__idbGetAlls ?? 0) + 1;
      return getAll.apply(this, args);
    };
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "新建分压项目" })).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open("fluxlab", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const project = {
      schemaVersion: 2,
      id: "proj-large",
      title: "large-list-fixture",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
      revision: 1,
      electricalRevision: 1,
      schematic: { components: [], wires: [] },
      layout: { components: {}, wireRoutes: {} },
      models: [],
      analyses: [],
      probes: [],
      assertions: [],
      corners: [],
      notes: [],
    };
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("projects", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("projects").put(
        {
          envelopeVersion: 1,
          storageVersion: 1,
          project,
          listKey: ["2026-08-31T00:00:00.000Z", "proj-large", "large-list-fixture", 1],
          revisionKey: ["proj-large", 1, 1],
          padding: "x".repeat(12 * 1024 * 1024),
        },
        "proj-large"
      );
    });
  });
  await page.reload();
  await expect(page.getByRole("link", { name: "large-list-fixture" })).toBeVisible();
  const listCounts = await page.evaluate(() => ({ gets: window.__idbGets ?? 0, getAlls: window.__idbGetAlls ?? 0 }));
  expect(listCounts.gets).toBe(0);
  expect(listCounts.getAlls).toBe(0);
  await page.getByRole("link", { name: "large-list-fixture" }).click();
  await expect(page.getByText("STORAGE_INVALID_PROJECT")).toBeVisible();
  const openCounts = await page.evaluate(() => window.__idbGets ?? 0);
  expect(openCounts).toBe(1);
});

test("settings page reports real storage and does not invent engine success", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByTestId("settings-app-build-id")).not.toHaveText("");
  await expect(page.getByTestId("settings-engine-version")).toHaveText("ngspice-46");
  await expect(page.getByTestId("settings-result-transport")).toHaveText("binary-rawfile");
  await expect(page.getByTestId("settings-storage-estimate")).toHaveText(/usage=|unsupported|failed/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByRole("link", { name: "项目库" }).click();
  await expect(page.getByRole("button", { name: "新建分压项目" })).toBeVisible();
});
