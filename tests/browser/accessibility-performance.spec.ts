import { expect, test, type Page } from "@playwright/test";
import { createLargeEditProject } from "../fixtures/circuits/large-project";
import {
  createNearLimitHostProject,
  createNearLimitSuccessRecord,
  fillNearLimitSeries,
} from "../fixtures/circuits/large-result";

test.describe.configure({ retries: 0 });

async function waitReady(page: Page) {
  await expect(page.getByTestId("workspace-ready")).toBeVisible();
  await expect(page.getByTestId("workspace-ready")).toHaveAttribute("data-idle", "true");
}

function statusIcon(page: Page, testId: string) {
  return page.getByTestId(testId).locator("[data-status-icon]");
}

test("settings open, reload, and persist the three preferences", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByTestId("settings-app-build-id")).not.toHaveText("");
  await expect(page.getByTestId("settings-engine-version")).toHaveText("ngspice-46");
  await expect(page.getByTestId("settings-result-transport")).toHaveText("binary-rawfile");
  await expect(page.getByTestId("settings-module-sha256")).toHaveText(/^[a-f0-9]{64}$/);
  await expect(page.getByTestId("settings-wasm-sha256")).toHaveText(/^[a-f0-9]{64}$/);
  await expect(page.getByTestId("settings-online")).toHaveText(/online|offline/);
  await expect(page.getByTestId("settings-sw-status")).toHaveText(/正在准备离线仿真|离线可用|保存并关闭|离线安装失败|unsupported/);
  await expect(page.getByTestId("settings-storage-estimate")).toHaveText(/usage=|unsupported|failed/);
  await page.getByLabel("主题").selectOption("light");
  await page.getByLabel("减少动效").selectOption("reduce");
  await page.getByLabel("默认视图").selectOption("expert");
  await page.reload();
  await expect(page.getByLabel("主题")).toHaveValue("light");
  await expect(page.getByLabel("减少动效")).toHaveValue("reduce");
  await expect(page.getByLabel("默认视图")).toHaveValue("expert");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "reduce");
});

test("360px guided lesson can run and show a result", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/learn/foundation-divider");
  await waitReady(page);
  await expect(page.getByTestId("lesson-overlay")).toBeVisible();
  await expect(page.getByTestId("workspace-canvas-wrap")).toBeHidden();
  await page.getByTestId("lesson-prediction").fill("6");
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toHaveText(/成功/, { timeout: 120_000 });
  await expect(page.getByTestId("vout-value")).toHaveText("6.000000 V");
  await expect(page.getByTestId("result-dock")).toBeVisible();
});

test("768px can select, edit a parameter, and add a wire", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await waitReady(page);
  await expect(page.getByTestId("workspace-canvas-wrap")).toBeVisible();
  await page.getByRole("button", { name: "选择 R2" }).click();
  await expect(page.getByLabel("电阻（Ω）")).toBeVisible();
  await page.getByLabel("电阻（Ω）").fill("3000");
  await page.getByRole("button", { name: "应用参数" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText(/电气 2/);
  await page.getByTestId("pin-R1-n").click();
  await page.getByTestId("pin-R2-p").click();
  await expect(page.locator("[data-testid^='wire-']")).toHaveCount(5);
});

test("1024px shows rails, dock, keyboard path, and accessible status", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await waitReady(page);
  await expect(page.getByTestId("workspace-palette")).toBeVisible();
  await expect(page.getByTestId("workspace-rail")).toBeVisible();
  await expect(page.getByTestId("result-dock")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("workspace-properties")).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("run-status")).toHaveText(/成功/, { timeout: 120_000 });
  await expect(page.getByTestId("diagnostics-live")).toBeVisible();
  await page.getByRole("button", { name: "选择 R2" }).click();
  await page.getByLabel("电阻（Ω）").fill("1800");
  await page.getByRole("button", { name: "应用参数" }).click();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("project-revision")).toHaveText(/修订/);
  await page.keyboard.press("Control+Shift+Z");
  await expect(statusIcon(page, "project-save-state")).toBeVisible();
  await expect(statusIcon(page, "run-status")).toBeVisible();
  await expect(page.getByTestId("run-status")).not.toHaveClass(/color-only/);
});

test("500-component edits stay under the longtask ceiling", async ({ page }) => {
  const project = createLargeEditProject();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "新建分压项目" })).toBeVisible();
  const saved = await page.evaluate(async fixture => {
    return window.__fluxlabRunStorage.saveProject(null, fixture);
  }, project);
  expect(saved.ok).toBe(true);
  await page.goto(`/project/${project.id}`);
  await waitReady(page);
  const supported = await page.evaluate(() => PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false);
  expect(supported, "longtask observer must be available").toBe(true);
  const samples = await page.evaluate(async () => {
    const entries: Array<{ start: number; duration: number; name: string }> = [];
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        entries.push({ start: entry.startTime, duration: entry.duration, name: entry.name });
      }
    });
    observer.observe({ type: "longtask", buffered: false });
    const startMark = performance.now();
    const ids = ["R001", "R002", "R003", "R004", "R005", "R006", "R007", "R008", "R009", "R010", "R011", "R012", "R013", "R014", "R015", "R016", "R017", "R018", "R019", "R020"];
    for (const id of ids) {
      document.querySelector<HTMLElement>(`[data-testid="component-${id}"]`)?.focus();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    }
    for (const id of ids) {
      const node = document.querySelector<SVGElement>(`[data-testid="component-${id}"]`);
      if (!node) continue;
      node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20 }));
      node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 40, clientY: 24 }));
      node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 40, clientY: 24 }));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    const endMark = performance.now();
    observer.disconnect();
    return {
      startMark,
      endMark,
      interactions: ids.length * 2,
      hardware: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
      userAgent: navigator.userAgent,
      entries: entries.filter(item => item.start + item.duration >= startMark && item.start <= endMark),
    };
  });
  expect(samples.interactions, "instrumented interaction samples").toBeGreaterThanOrEqual(40);
  expect(Math.max(0, ...samples.entries.map(item => item.duration))).toBeLessThanOrEqual(50);
  await test.info().attach("large-edit-longtasks.json", {
    body: Buffer.from(JSON.stringify(samples, null, 2)),
    contentType: "application/json",
  });
});

test("near-limit result table paginates 200 rows without long tasks", async ({ page }) => {
  const project = createNearLimitHostProject();
  const series = fillNearLimitSeries();
  const record = await createNearLimitSuccessRecord(project, series.axis, series.values);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "新建分压项目" })).toBeVisible();
  const seeded = await page.evaluate(
    async ({ fixture, run }) => {
      const saved = await window.__fluxlabRunStorage.saveProject(null, fixture);
      if (!saved.ok) return saved;
      const asF64 = (value: unknown) =>
        value instanceof Float64Array ? value : new Float64Array(Array.isArray(value) ? value : Object.values(value as Record<string, number>));
      run.snapshot.axes[0].values = asF64(run.snapshot.axes[0].values);
      run.snapshot.vectors[0].values = asF64(run.snapshot.vectors[0].values);
      return window.__fluxlabRunStorage.adoptImportedRun(run);
    },
    { fixture: project, run: record }
  );
  expect(seeded.ok).toBe(true);
  await page.goto(`/project/${project.id}`);
  await waitReady(page);
  await expect(page.getByTestId("result-table")).toBeVisible();
  const supported = await page.evaluate(() => PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false);
  expect(supported).toBe(true);
  const samples = await page.evaluate(async () => {
    const entries: Array<{ start: number; duration: number }> = [];
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) entries.push({ start: entry.startTime, duration: entry.duration });
    });
    observer.observe({ type: "longtask", buffered: false });
    const startMark = performance.now();
    const rowCount = () => document.querySelectorAll("[data-testid='result-table-row']").length;
    const counts = [rowCount()];
    (document.querySelector("[data-testid='result-table-middle']") as HTMLButtonElement | null)?.click();
    counts.push(rowCount());
    (document.querySelector("[data-testid='result-table-last']") as HTMLButtonElement | null)?.click();
    counts.push(rowCount());
    (document.querySelector("[data-testid='result-table-first']") as HTMLButtonElement | null)?.click();
    counts.push(rowCount());
    (document.querySelector("[data-testid='result-col-probe-v']") as HTMLInputElement | null)?.click();
    await new Promise(resolve => setTimeout(resolve, 50));
    const endMark = performance.now();
    observer.disconnect();
    return {
      startMark,
      endMark,
      counts,
      range: document.querySelector("[data-testid='result-table-range']")?.textContent ?? "",
      hardware: navigator.platform,
      userAgent: navigator.userAgent,
      entries: entries.filter(item => item.start + item.duration >= startMark && item.start <= endMark),
    };
  });
  expect(samples.counts.every(count => count <= 200)).toBe(true);
  expect(samples.counts.length).toBeGreaterThanOrEqual(4);
  expect(Math.max(0, ...samples.entries.map(item => item.duration))).toBeLessThanOrEqual(50);
  await test.info().attach("result-table-longtasks.json", {
    body: Buffer.from(JSON.stringify(samples, null, 2)),
    contentType: "application/json",
  });
});

test("cancel returns Run to enabled within 500ms", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建RC暂态" }).click();
  await waitReady(page);
  await page.getByRole("button", { name: "运行暂态" }).click();
  await expect(page.getByRole("button", { name: "取消运行" })).toBeEnabled();
  const elapsed = await page.evaluate(async () => {
    const cancel = document.querySelector("button") &&
      [...document.querySelectorAll("button")].find(item => item.textContent === "取消运行");
    const started = performance.now();
    (cancel as HTMLButtonElement | undefined)?.click();
    while (performance.now() - started < 2_000) {
      const run = [...document.querySelectorAll("button")].find(item => item.textContent === "运行暂态");
      if (run && !(run as HTMLButtonElement).disabled) return performance.now() - started;
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    return performance.now() - started;
  });
  expect(elapsed).toBeLessThanOrEqual(500);
});
