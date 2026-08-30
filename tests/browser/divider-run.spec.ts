import { expect, test, type Page } from "@playwright/test";

const ALLOWED = /^(?:\/|\/index\.html|\/project\/[^?#]+|\/learn\/[^?#]+|\/settings|\/assets\/[^?#]+|\/vendor\/ngspice\/[^?#]+|\/manifest\.webmanifest|\/sw\.js|\/qualification\.html)$/;

async function waitSaved(page: Page) {
  await expect(page.getByTestId("project-save-state")).toContainText("已保存");
}

function parseQuantity(text: string) {
  return Number.parseFloat(text);
}

test("runs a real divider and never reuses it after an electrical change", async ({ context, page }) => {
  test.setTimeout(300_000);
  const forbidden: string[] = [];
  context.on("request", request => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4173" || !["GET", "HEAD"].includes(request.method()) || !ALLOWED.test(url.pathname)) {
      forbidden.push(`${request.resourceType()} ${url.origin}${url.pathname}`);
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.waitForURL(/\/project\//);
  await waitSaved(page);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toHaveText(/成功 · 当前|failed|timeout/, { timeout: 120_000 });
  await expect(page.getByTestId("vout-value")).toHaveText("6.000000 V");
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前"));
  await expect(page.getByText(/ngspice .* SHA-256/)).toBeVisible();

  await page.getByRole("button", { name: "选择 R2" }).click();
  await page.getByLabel("电阻（Ω）").fill("3000");
  await page.getByRole("button", { name: "应用参数" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 历史结果");
  await expect(page.getByTestId("vout-current-value")).toHaveText("尚无当前结果");

  await page.getByLabel("电阻（Ω）").fill("2000");
  await page.getByRole("button", { name: "应用参数" }).click();
  await waitSaved(page);
  const firstCount = await page.locator("[data-testid^='run-row-']").count();

  await page.getByTestId("select-wire-w3").click();
  await page.getByRole("button", { name: "删除连线" }).click();
  await page.getByTestId("select-wire-w4").click();
  await page.getByRole("button", { name: "删除连线" }).click();
  await page.getByRole("button", { name: "选择 GND" }).click();
  await page.getByRole("button", { name: "删除元件" }).click();
  await waitSaved(page);
  const workersBeforeGround = await page.evaluate(() => window.__fluxlabWorkerCreations ?? 0);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("diagnostic-ERC_NO_GROUND")).toBeVisible();
  expect(await page.locator("[data-testid^='run-row-']").count()).toBe(firstCount);
  expect(await page.evaluate(() => window.__fluxlabWorkerCreations ?? 0)).toBe(workersBeforeGround);

  await page.getByRole("button", { name: "撤销" }).click();
  await page.getByRole("button", { name: "撤销" }).click();
  await page.getByRole("button", { name: "撤销" }).click();
  await waitSaved(page);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前"), { timeout: 120_000 });
  const restoredId = await page.locator("[data-testid^='run-row-']").last().getAttribute("data-testid");

  await page.evaluate(async () => {
    const listed = await window.__fluxlabRunStorage!.listRuns(location.pathname.split("/project/")[1]!);
    const success = listed.value.find((item: { status: string }) => item.status === "success");
    const loaded = await window.__fluxlabRunStorage!.loadRun(success.runId);
    const envelope = structuredClone(loaded.value);
    envelope.record.snapshot.runId = "forged-run";
    envelope.record.runId = "corrupt-run";
    envelope.listKey = [...envelope.listKey.slice(0, 6), "corrupt-run"];
    const request = indexedDB.open("fluxlab");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("runs", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("runs").put(envelope, "corrupt-run");
    });
  });
  await page.reload();
  await expect(page.getByTestId("diagnostic-RUN_SNAPSHOT_MISMATCH")).toBeVisible();
  await expect(page.getByTestId("vout-value")).toHaveText("6.000000 V");

  await page.getByRole("button", { name: "添加电阻" }).click();
  await page.getByRole("button", { name: "选择 R3" }).click();
  await page.getByLabel("电阻（Ω）").fill("2000");
  await page.getByRole("button", { name: "应用参数" }).click();
  await page.getByRole("button", { name: "添加支路电流探针" }).click();
  await page.locator("[data-testid='pin-R3-p']").click();
  await page.locator("[data-testid='pin-R2-p']").click();
  await page.locator("[data-testid='pin-R3-n']").click();
  await page.locator("[data-testid='pin-R2-n']").click();
  await waitSaved(page);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前"), { timeout: 120_000 });
  expect(parseQuantity(await page.getByTestId("vout-value").innerText())).toBeCloseTo(4.5, 5);
  expect(Math.abs(parseQuantity(await page.getByTestId("current-R1").innerText()))).toBeCloseTo(4.5, 4);
  expect(Math.abs(parseQuantity(await page.getByTestId("current-R2").innerText()))).toBeCloseTo(2.25, 4);
  expect(Math.abs(parseQuantity(await page.getByTestId("current-R3").innerText()))).toBeCloseTo(2.25, 4);
  expect(await page.locator("[data-testid^='run-row-']").last().getAttribute("data-testid")).not.toBe(restoredId);

  const captured = await page.getByTestId("captured-netlist").innerText();
  expect(captured).toMatch(/R1 /);
  expect(captured).toMatch(/R2 /);
  expect(captured).toMatch(/R3 /);
  const recordHash = await page.getByTestId("record-netlist-hash").innerText();
  const computedHash = await page.getByTestId("provenance-netlist-hash").innerText();
  expect(computedHash).toBe(recordHash);
  await expect(page.getByTestId("sourcemap-target")).toBeVisible();

  const workersBeforeFloat = await page.evaluate(() => window.__fluxlabWorkerCreations ?? 0);
  await page.locator("[data-testid^='select-wire-wire-']").first().click();
  await page.getByRole("button", { name: "删除连线" }).click();
  await waitSaved(page);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("diagnostic-ERC_FLOATING_REQUIRED_PIN")).toBeVisible();
  expect(await page.evaluate(() => window.__fluxlabWorkerCreations ?? 0)).toBe(workersBeforeFloat);
  await page.getByRole("button", { name: "撤销" }).click();
  await waitSaved(page);

  const workersBeforeShort = await page.evaluate(() => window.__fluxlabWorkerCreations ?? 0);
  await page.locator("[data-testid='pin-V1-p']").click();
  await page.locator("[data-testid='pin-V1-n']").click();
  await waitSaved(page);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("diagnostic-ERC_VOLTAGE_SOURCE_SHORT")).toBeVisible();
  expect(await page.evaluate(() => window.__fluxlabWorkerCreations ?? 0)).toBe(workersBeforeShort);
  await page.getByRole("button", { name: "撤销" }).click();
  await waitSaved(page);
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toContainText("成功 · 当前"), { timeout: 120_000 });
  expect(parseQuantity(await page.getByTestId("vout-value").innerText())).toBeCloseTo(4.5, 5);

  const historicalNetlist = await page.getByTestId("captured-netlist").innerText();
  await page.getByRole("button", { name: "选择 R2" }).click();
  await page.getByLabel("电阻（Ω）").fill("1800");
  await page.getByRole("button", { name: "应用参数" }).click();
  await expect(page.getByTestId("captured-netlist")).toHaveText(historicalNetlist);

  expect(forbidden).toEqual([]);
});
