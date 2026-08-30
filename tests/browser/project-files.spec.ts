import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

async function waitSaved(page: Page) {
  await expect(page.getByTestId("project-save-state")).toContainText("已保存");
}

test("imports and exports trusted files without a business network", async ({ page }) => {
  test.setTimeout(300_000);
  const requests: string[] = [];
  page.on("request", request => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:4173") && !url.startsWith("blob:")) requests.push(url);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.waitForURL(/\/project\//);
  await waitSaved(page);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前", { timeout: 120_000 });

  const [projectDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出项目" }).click(),
  ]);
  const projectPath = await projectDownload.path();
  expect(projectPath).toBeTruthy();

  const [runDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出运行", exact: true }).click(),
  ]);
  expect(await runDownload.path()).toBeTruthy();

  const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "导出 CSV" }).click()]);
  expect(await csvDownload.path()).toBeTruthy();

  const [cirDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "导出 CIR" }).click()]);
  expect(await cirDownload.path()).toBeTruthy();

  await page.goto("/");
  await page.getByTestId("import-file").setInputFiles(projectPath!);
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await page.getByTestId("adopt-import").click();
  await page.waitForURL(/\/project\//, { timeout: 30_000 });
  await waitSaved(page);

  await page.goto("/");
  await page.getByTestId("import-file").setInputFiles(join(fixtures, "imports/malformed.json"));
  await expect(page.getByTestId("import-diagnostic")).toContainText(/FILE_|SCHEMA_/);

  await page.getByTestId("import-file").setInputFiles(join(fixtures, "imports/cir-equivalence.cir"));
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await expect(page.getByTestId("import-counts")).toContainText("0 探针");
  await page.getByTestId("adopt-import").click();
  await page.waitForURL(/\/project\//);
  await waitSaved(page);
  await page.waitForFunction(() => Boolean(window.__fluxlabRunStorage));
  await page.getByRole("button", { name: "添加 R2 节点电压" }).click();
  await expect(page.getByTestId("project-revision")).toHaveText(/电气 [2-9]/, { timeout: 15_000 });
  await waitSaved(page);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前", { timeout: 120_000 });
  const mid = await page.evaluate(async () => {
    const id = location.pathname.split("/project/")[1] ?? "";
    const listed = await window.__fluxlabRunStorage!.listRuns(id);
    const runId = listed.ok ? listed.value.at(-1)?.runId : undefined;
    if (!runId) return [];
    const loaded = await window.__fluxlabRunStorage!.loadRun(runId);
    if (!loaded.ok || !loaded.value || loaded.value.record.status !== "success") return [];
    return loaded.value.record.snapshot.vectors.map((vector: { values: Float64Array }) => vector.values[0]);
  });
  expect(mid.some((value: unknown) => typeof value === "number" && Math.abs(value - 6) < 0.02)).toBe(true);

  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("circuit-simulator:learning-progress", JSON.stringify({ done: true }));
  });
  await page.evaluate(async divider => {
    localStorage.setItem("circuit-simulator:active-document", divider);
  }, readFileSync(join(fixtures, "migrations/divider-v1.json"), "utf8"));
  await page.reload();
  await expect(page.getByTestId("legacy-progress-discarded")).toBeVisible();
  await page.getByTestId("legacy-adopt-circuit-simulator:active-document").click();
  await page.waitForURL(/\/project\//);
  await waitSaved(page);

  expect(requests).toEqual([]);
});
