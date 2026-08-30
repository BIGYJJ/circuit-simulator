import { expect, test, type Page } from "@playwright/test";

async function waitSaved(page: Page) {
  await expect(page.getByTestId("project-save-state")).toContainText("已保存");
}

test("gates nominal and corner evidence without writing forged drafts", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.waitForURL(/\/project\//);
  await waitSaved(page);
  await page.waitForFunction(() => typeof (window as Window & { __fluxlabSubmitAssertionDraft?: unknown }).__fluxlabSubmitAssertionDraft === "function");

  const revisionBefore = await page.getByTestId("project-revision").innerText();
  const forgedAssert = await page.evaluate(async () => {
    const host = window as Window & { __fluxlabSubmitAssertionDraft?: (draft: never) => Promise<Array<{ code: string }>> };
    return host.__fluxlabSubmitAssertionDraft?.({
      id: "assert-forged",
      name: "bad",
      enabled: true,
      analysisId: "missing",
      expression: { function: "valueAt", vectorId: "nope", at: { value: 0, unit: "index" } },
      comparator: { kind: "near", expected: { value: 6, unit: "V" }, absoluteTolerance: { value: 0.01, unit: "V" } },
    } as never);
  });
  expect(forgedAssert?.some(item => item.code === "ASSERT_UNKNOWN_ANALYSIS" || item.code.startsWith("SCHEMA_"))).toBe(true);
  const forgedCorner = await page.evaluate(async () => {
    const host = window as Window & { __fluxlabSubmitCornerDraft?: (draft: never) => Promise<Array<{ code: string }>> };
    return host.__fluxlabSubmitCornerDraft?.({
      id: "corner-forged",
      name: "forged",
      enabled: true,
      overrides: [{ kind: "component-parameter", componentId: "R2", path: "lengthM", value: 1 }],
    } as never);
  });
  expect(forgedCorner?.some(item => item.code === "CORNER_BAD_PATH" || item.code.startsWith("SCHEMA_"))).toBe(true);
  await expect(page.getByTestId("project-revision")).toHaveText(revisionBefore);

  await page.getByLabel("断言期望").fill("6");
  await page.getByLabel("断言容差").fill("1.5");
  await page.getByRole("button", { name: "采用断言" }).click();
  await waitSaved(page);
  await expect(page.getByTestId("delivery-gate")).toHaveText("blocked");
  await expect(page.getByTestId("gate-codes")).toContainText("GATE_MISSING");

  await page.getByLabel("角点名").fill("low");
  await page.getByLabel("角点值").fill("1600");
  await page.getByRole("button", { name: "采用角点" }).click();
  await waitSaved(page);
  await page.getByLabel("角点名").fill("high");
  await page.getByLabel("角点值").fill("2400");
  await page.getByRole("button", { name: "采用角点" }).click();
  await waitSaved(page);

  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前", { timeout: 120_000 });
  await expect(page.getByTestId("delivery-gate")).toHaveText("blocked");
  await expect(page.getByTestId("gate-codes")).toContainText("GATE_MISSING_CORNER_RUN");

  await page.getByRole("button", { name: "运行名义与角点" }).click();
  await expect(page.getByTestId("delivery-gate")).toHaveText("passed", { timeout: 180_000 });
  const ids = (await page.getByTestId("gate-run-ids").innerText()).trim().split(/\s+/);
  expect(new Set(ids).size).toBe(3);
  const runCount = await page.getByTestId("run-count").innerText();
  const evalHash = await page.getByTestId("assertion-eval-hash").innerText();
  expect(evalHash).toMatch(/^[0-9a-f]{64}$/);

  await page.getByLabel("断言容差").fill("1.6");
  await page.getByRole("button", { name: "采用断言" }).click();
  await waitSaved(page);
  await page.getByRole("button", { name: "重新评估断言" }).click();
  await expect(page.getByTestId("run-count")).toHaveText(runCount);
  await expect(page.getByTestId("assertion-eval-hash")).not.toHaveText(evalHash);

  await page.getByLabel("断言期望").fill("99");
  await page.getByLabel("断言容差").fill("0.01");
  await page.getByRole("button", { name: "采用断言" }).click();
  await waitSaved(page);
  await page.getByRole("button", { name: "重新评估断言" }).click();
  await expect(page.getByTestId("delivery-gate")).toHaveText("failed");

  await page.getByRole("button", { name: "选择 R2" }).click();
  await page.getByLabel("电阻（Ω）").fill("1800");
  await page.getByRole("button", { name: "应用参数" }).click();
  await waitSaved(page);
  await expect(page.getByTestId("delivery-gate")).toHaveText("blocked");
  await expect(page.getByTestId("gate-codes")).toContainText("GATE_STALE_RUN");
});
