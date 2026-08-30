import { expect, test, type Page } from "@playwright/test";

async function waitSaved(page: Page) {
  await expect(page.getByTestId("project-save-state")).toContainText("已保存");
}

async function waitStorage(page: Page) {
  await page.waitForFunction(() => Boolean(window.__fluxlabRunStorage));
}

async function countOwned(page: Page, storeName: string, projectId: string) {
  return page.evaluate(
    async ({ store, id }) => {
      const request = indexedDB.open("fluxlab");
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (store === "projects" || store === "runSequences") {
        return new Promise<number>((resolve, reject) => {
          const req = db.transaction(store).objectStore(store).count(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      const indexName = store === "runs" ? "listKey" : "projectKey";
      return new Promise<number>((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).index(indexName).count(IDBKeyRange.bound([id], [id, "\uffff"]));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    { store: storeName, id: projectId }
  );
}

test("guided lessons share one project and five-store deletes stay atomic", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await expect(page.getByTestId("lesson-locked-foundation-led")).toBeVisible();
  await page.getByRole("link", { name: "分压器基础" }).click();
  await page.waitForURL(/\/project\/.+/);
  await waitSaved(page);
  const firstUrl = page.url();
  const projectId = firstUrl.split("/project/")[1]!.split("?")[0]!;
  expect(firstUrl).toContain("lesson=foundation-divider");

  await page.getByTestId("lesson-prediction").fill("6");
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前"), { timeout: 120_000 });
  await expect(page.getByTestId("vout-value")).toHaveText("6.000000 V");
  await page.getByTestId("save-checkpoint").click();
  await expect(page.getByTestId("lesson-completed-steps")).toContainText("step-predict-6v");

  await page.getByTestId("expand-standard").click();
  await expect(page.getByTestId("lesson-view")).toHaveText("standard");
  expect(page.url()).toContain(`/project/${projectId}`);
  expect(page.url()).toContain("view=standard");
  await expect(page.getByTestId("project-revision")).toContainText("修订 1");
  await expect(page.getByTestId("run-count")).toHaveText("1");

  await page.getByRole("button", { name: "选择 R2" }).click();
  await page.getByLabel("电阻（Ω）").fill("3000");
  await page.getByRole("button", { name: "应用参数" }).click();
  await waitSaved(page);
  await expect(page.getByTestId("run-status")).toContainText("成功 · 历史结果");
  await page.getByTestId("lesson-prediction").fill("6.75");
  await page.getByTestId("save-checkpoint").click();
  await expect(page.getByTestId("lesson-diagnostic")).toContainText(/LESSON_STALE|LESSON_ASSERTION/);

  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前"), { timeout: 120_000 });
  await page.getByTestId("save-checkpoint").click();
  await expect(page.getByTestId("lesson-completed-steps")).toContainText("step-after-r2");
  await expect(page.getByTestId("run-count")).toHaveText("2");

  await page.goto("/");
  await expect(page.getByTestId("lesson-complete-foundation-divider")).toBeVisible();
  await expect(page.getByRole("link", { name: "LED 限流" })).toBeVisible();

  await page.getByRole("link", { name: "LED 限流" }).click();
  await page.waitForURL(/\/project\/.+/);
  await waitSaved(page);
  await page.getByTestId("lesson-prediction").fill("4.4");
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前"), { timeout: 120_000 });
  await page.getByTestId("save-checkpoint").click();
  await expect(page.getByTestId("lesson-diagnostic")).toContainText("LESSON_ASSERTION_FAILED");

  await page.getByRole("button", { name: "选择 R1" }).click();
  await page.getByLabel("电阻（Ω）").fill("330");
  await page.getByRole("button", { name: "应用参数" }).click();
  await waitSaved(page);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前"), { timeout: 120_000 });
  await page.getByTestId("lesson-prediction").fill("10");
  await page.getByTestId("save-checkpoint").click();
  await expect(page.getByTestId("lesson-completed-steps")).toContainText("step-led-current");

  await page.goto("/");
  await page.getByRole("link", { name: "RC 暂态" }).click();
  await page.waitForURL(/\/project\/.+/);
  await waitSaved(page);
  await page.getByTestId("lesson-prediction").fill("3.16");
  await page.getByRole("button", { name: "运行暂态" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前"), { timeout: 180_000 });
  await page.getByTestId("save-checkpoint").click();
  await expect(page.getByTestId("lesson-completed-steps")).toContainText("step-rc-tau");
});

test("project deletion cancel, confirm, and settings cursor failure cover five stores", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.waitForURL(/\/project\//);
  await waitSaved(page);
  await waitStorage(page);
  const targetId = page.url().split("/project/")[1]!.split("?")[0]!;
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.waitForURL(/\/project\//);
  await waitSaved(page);
  const otherId = page.url().split("/project/")[1]!.split("?")[0]!;

  await page.evaluate(
    async ({ target, other }) => {
      const api = window.__fluxlabRunStorage!;
      const evidence = {
        projectId: target,
        lessonId: "foundation-divider",
        steps: [
          {
            stepId: "step-predict-6v",
            projectRevision: 1,
            runId: "run-ev-1",
            prediction: 6,
            assertionResultIds: ["assertion-result:v1:keep"],
            completedAt: "2026-08-31T00:00:00.000Z",
          },
        ],
      };
      const put = await api.putLearningEvidence(null, evidence);
      if (!put.ok) throw new Error(put.diagnostics[0]?.code ?? "evidence");
      const session = await api.saveLessonSession({
        kind: "lesson-session",
        lessonId: "foundation-divider",
        projectId: target,
        templateKey: "divider",
      });
      if (!session.ok) throw new Error("session");
      await api.saveLastOpenedProject(target);
      await api.saveLocalSettings({ schemaVersion: 1, theme: "dark", reducedMotion: "system", defaultView: "guided" });
      await api.acknowledgeLegacyNotice("/divider");
      const project = await api.loadProject(other);
      if (!project.ok || !project.value) throw new Error("other project");
    },
    { target: targetId, other: otherId }
  );

  await page.goto("/");
  await waitStorage(page);
  await page.getByTestId(`delete-project-${targetId}`).click();
  await page.getByTestId("cancel-delete-project").click();
  expect(await countOwned(page, "projects", targetId)).toBe(1);
  expect(await countOwned(page, "runSequences", targetId)).toBe(1);
  expect(await countOwned(page, "lessonEvidence", targetId)).toBe(1);
  expect(await countOwned(page, "settings", targetId)).toBeGreaterThan(0);
  expect(await countOwned(page, "projects", otherId)).toBe(1);

  await page.evaluate(() => {
    const original = IDBIndex.prototype.openKeyCursor;
    IDBIndex.prototype.openKeyCursor = function patched(...args) {
      const request = original.apply(this, args);
      if (this.name === "projectKey" && this.objectStore.name === "settings") {
        const tx = this.objectStore.transaction;
        queueMicrotask(() => {
          try {
            tx.abort();
          } catch {
            /* already finishing */
          }
        });
      }
      return request;
    };
    window.__fluxlabPatchedCursor = () => {
      IDBIndex.prototype.openKeyCursor = original;
    };
  });
  try {
    await page.getByTestId(`delete-project-${targetId}`).click();
    await page.getByTestId("confirm-delete-project").click();
    await expect(page.getByTestId("library-diagnostic")).toBeVisible();
    expect(await countOwned(page, "projects", targetId)).toBe(1);
    expect(await countOwned(page, "lessonEvidence", targetId)).toBe(1);
    expect(await countOwned(page, "settings", targetId)).toBeGreaterThan(0);
    expect(await countOwned(page, "projects", otherId)).toBe(1);
  } finally {
    await page.evaluate(() => window.__fluxlabPatchedCursor?.());
  }

  await page.getByTestId(`delete-project-${targetId}`).click();
  await page.getByTestId("confirm-delete-project").click();
  await expect(page.getByTestId(`project-row-${targetId}`)).toHaveCount(0);
  expect(await countOwned(page, "projects", targetId)).toBe(0);
  expect(await countOwned(page, "runSequences", targetId)).toBe(0);
  expect(await countOwned(page, "runs", targetId)).toBe(0);
  expect(await countOwned(page, "lessonEvidence", targetId)).toBe(0);
  expect(await countOwned(page, "settings", targetId)).toBe(0);
  expect(await countOwned(page, "projects", otherId)).toBe(1);
  const globals = await page.evaluate(async () => {
    const settings = await window.__fluxlabRunStorage!.loadLocalSettings();
    const notice = await window.__fluxlabRunStorage!.hasAcknowledgedLegacyNotice("/divider");
    return { settings: settings.ok ? settings.value?.theme : null, notice: notice.ok ? notice.value : null };
  });
  expect(globals.settings).toBe("dark");
  expect(globals.notice).toBe(true);
});
