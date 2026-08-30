import { expect, test, type Page } from "@playwright/test";

const ENGINE = {
  name: "ngspice" as const,
  version: "ngspice-46",
  resultTransport: "binary-rawfile" as const,
  moduleSha256: "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93",
  wasmSha256: "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c",
  engineBuildId: "ngspice-46-emscripten-singlethread-256m-20260527",
};

async function waitForStorage(page: Page) {
  await page.waitForFunction(() => Boolean(window.__fluxlabRunStorage && window.__fluxlabBuildRunningRecord));
}

async function createDivider(page: Page) {
  await page.goto("/");
  await waitForStorage(page);
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.waitForURL(/\/project\//);
  const projectId = page.url().split("/project/")[1]!;
  await waitForStorage(page);
  return projectId;
}

async function loadProject(page: Page, projectId: string) {
  return page.evaluate(async id => {
    const result = await window.__fluxlabRunStorage!.loadProject(id);
    if (!result.ok || !result.value) throw new Error("load project failed");
    return result.value;
  }, projectId);
}

async function seedRunning(page: Page, projectId: string, runId: string) {
  const project = await loadProject(page, projectId);
  return page.evaluate(
    async ({ project: current, runId: id, engine }) => {
      const record = await window.__fluxlabBuildRunningRecord!({
        project: current,
        analysisId: current.analyses[0]!.id,
        runId: id,
        appBuildId: "verify-test",
        engine,
        startedAt: new Date().toISOString(),
      });
      if (!record.ok) throw new Error(record.diagnostics[0]?.message ?? "build running failed");
      const created = await window.__fluxlabRunStorage!.createRunningRun(record.value);
      if (!created.ok) throw new Error(created.diagnostics[0]?.code ?? "create running failed");
      return created.value.localAttempt;
    },
    { project, runId, engine: ENGINE }
  );
}

async function countStore(page: Page, store: string, projectId?: string) {
  return page.evaluate(
    async ({ storeName, id }) => {
      const request = indexedDB.open("fluxlab");
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (storeName === "projects") {
        return new Promise<number>((resolve, reject) => {
          const req = db.transaction(storeName).objectStore(storeName).count(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      if (storeName === "runSequences") {
        return new Promise<number>((resolve, reject) => {
          const req = db.transaction(storeName).objectStore(storeName).count(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      return new Promise<number>((resolve, reject) => {
        const req = db.transaction("runs").objectStore("runs").index("listKey").count(id ? IDBKeyRange.bound([id], [id, "\uffff"]) : undefined);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    { storeName: store, id: projectId }
  );
}

test("canceling project deletion writes nothing and confirmation removes the three-store graph", async ({ page }) => {
  const targetId = await createDivider(page);
  await page.goto("/");
  const otherId = await createDivider(page);
  await seedRunning(page, targetId, "run-target-a");
  await seedRunning(page, targetId, "run-target-b");
  await seedRunning(page, otherId, "run-other");
  await page.goto("/");
  await waitForStorage(page);
  await page.getByTestId(`delete-project-${targetId}`).click();
  await page.getByTestId("cancel-delete-project").click();
  expect(await countStore(page, "projects", targetId)).toBe(1);
  expect(await countStore(page, "runSequences", targetId)).toBe(1);
  expect(await countStore(page, "runs", targetId)).toBe(2);
  expect(await countStore(page, "projects", otherId)).toBe(1);

  await page.getByTestId(`delete-project-${targetId}`).click();
  await page.getByTestId("confirm-delete-project").click();
  await expect(page.getByTestId(`project-row-${targetId}`)).toHaveCount(0);
  expect(await countStore(page, "projects", targetId)).toBe(0);
  expect(await countStore(page, "runSequences", targetId)).toBe(0);
  expect(await countStore(page, "runs", targetId)).toBe(0);
  expect(await countStore(page, "projects", otherId)).toBe(1);
  expect(await countStore(page, "runs", otherId)).toBe(1);
});

test("a failing second run delete rolls the project graph back", async ({ page }) => {
  const targetId = await createDivider(page);
  await page.goto("/");
  const otherId = await createDivider(page);
  await seedRunning(page, targetId, "run-fail-a");
  await seedRunning(page, targetId, "run-fail-b");
  await seedRunning(page, otherId, "run-fail-other");
  await page.goto("/");
  await waitForStorage(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    let runDeletes = 0;
    IDBObjectStore.prototype.delete = function patched(query) {
      const name = this.name;
      if (name === "runs") {
        runDeletes += 1;
        if (runDeletes === 2) throw new Error("injected delete failure");
      }
      return original.call(this, query);
    };
    window.__fluxlabPatchedDelete = () => {
      IDBObjectStore.prototype.delete = original;
    };
  });
  try {
    await page.getByTestId(`delete-project-${targetId}`).click();
    await page.getByTestId("confirm-delete-project").click();
    await expect(page.getByTestId("library-diagnostic")).toBeVisible();
    expect(await countStore(page, "projects", targetId)).toBe(1);
    expect(await countStore(page, "runSequences", targetId)).toBe(1);
    expect(await countStore(page, "runs", targetId)).toBe(2);
    expect(await countStore(page, "projects", otherId)).toBe(1);
  } finally {
    await page.evaluate(() => window.__fluxlabPatchedDelete?.());
  }
});

test("run allocation and a delayed save serialize without losing the sequence", async ({ page }) => {
  const projectId = await createDivider(page);
  await page.evaluate(() => {
    window.__fluxlabTestDelaySaveMs = 250;
  });
  await page.getByRole("button", { name: "选择 R2" }).click();
  await page.getByLabel("电阻（Ω）").fill("3000");
  await page.getByRole("button", { name: "应用参数" }).click();
  const attempt = await seedRunning(page, projectId, "run-interleave");
  expect(attempt).toBe(1);
  await expect(page.getByTestId("project-revision")).toHaveText("修订 2 / 电气 2");
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 10_000 });
  const listed = await page.evaluate(async id => {
    const runs = await window.__fluxlabRunStorage!.listRuns(id);
    const project = await window.__fluxlabRunStorage!.loadProject(id);
    return { runCount: runs.ok ? runs.value.length : -1, revision: project.ok ? project.value?.revision : -1 };
  }, projectId);
  expect(listed.runCount).toBe(1);
  expect(listed.revision).toBe(2);
});

test("listRuns uses keys only for a large envelope and another tab cannot steal a live lock", async ({ page, context }) => {
  const projectId = await createDivider(page);
  await seedRunning(page, projectId, "run-live");
  const getCounts = await page.evaluate(async id => {
    const store = IDBObjectStore.prototype;
    const originalGet = store.get;
    const originalGetAll = store.getAll;
    let gets = 0;
    let getAlls = 0;
    store.get = function patchedGet(...args) {
      gets += 1;
      return originalGet.apply(this, args);
    };
    store.getAll = function patchedGetAll(...args) {
      getAlls += 1;
      return originalGetAll.apply(this, args);
    };
    try {
      const listed = await window.__fluxlabRunStorage!.listRuns(id);
      return { listed: listed.ok ? listed.value.length : -1, gets, getAlls };
    } finally {
      store.get = originalGet;
      store.getAll = originalGetAll;
    }
  }, projectId);
  expect(getCounts.listed).toBe(1);
  expect(getCounts.gets).toBe(0);
  expect(getCounts.getAlls).toBe(0);

  await page.evaluate(async () => {
    window.__fluxlabHeldLock = await new Promise<boolean>(resolve => {
      void navigator.locks.request("fluxlab-run:run-live", { mode: "exclusive" }, async () => {
        resolve(true);
        await new Promise(hold => {
          window.__fluxlabReleaseHeldLock = () => hold(null);
        });
      });
    });
  });
  const other = await context.newPage();
  await other.goto("/");
  await waitForStorage(other);
  const busy = await other.evaluate(async () => {
    const result = await window.__fluxlabRunStorage!.recoverInterruptedRuns();
    return result.ok ? result.value : [];
  });
  expect(busy.some((item: { runId: string; code?: string }) => item.runId === "run-live" && item.code === "RUN_ACTIVE_IN_OTHER_TAB")).toBe(true);
  await page.close();
  await other.waitForFunction(async () => {
    const state = await navigator.locks.query();
    return !(state.held ?? []).some(lock => lock.name === "fluxlab-run:run-live");
  });
  const recovered = await other.evaluate(async () => {
    const result = await window.__fluxlabRunStorage!.recoverInterruptedRuns();
    return result.ok ? result.value : result.diagnostics;
  });
  expect(recovered).toEqual(
    expect.arrayContaining([expect.objectContaining({ runId: "run-live", code: "RUN_INTERRUPTED" })])
  );
  await other.close();
});
