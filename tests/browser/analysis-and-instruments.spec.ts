import { expect, test, type Page } from "@playwright/test";

const ALLOWED =
  /^(?:\/|\/index\.html|\/project\/[^?#]+|\/learn\/[^?#]+|\/settings|\/assets\/[^?#]+|\/vendor\/ngspice\/[^?#]+|\/manifest\.webmanifest|\/sw\.js|\/qualification\.html)$/;

async function waitSaved(page: Page) {
  await expect(page.getByTestId("project-save-state")).toContainText("已保存");
}

test.describe("traceable analyses and instruments", () => {
  test.setTimeout(300_000);

  test("diode sweep records a hashed monotonic current", async ({ context, page }) => {
    const forbidden: string[] = [];
    context.on("request", request => {
      const url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:4173" || !["GET", "HEAD"].includes(request.method()) || !ALLOWED.test(url.pathname)) {
        forbidden.push(`${request.resourceType()} ${url.origin}${url.pathname}`);
      }
    });
    await page.goto("/");
    await page.getByRole("button", { name: "新建二极管扫描" }).click();
    await page.waitForURL(/\/project\//);
    await waitSaved(page);
    await page.getByRole("button", { name: "运行 DC 扫描" }).click();
    await expect(page.getByTestId("run-status")).toContainText("成功 · 当前", { timeout: 120_000 });
    await expect(page.getByTestId("diode-monotonic")).toHaveText("单调上升");
    const instrumentHash = await page.getByTestId("instrument-model-hash").innerText();
    expect(instrumentHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(page.getByTestId("result-table")).toBeVisible();
    await expect(page.getByRole("img", { name: /示波器/ })).toBeVisible();
    expect(forbidden).toEqual([]);
  });

  test("rc transient matches one and five time constants", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "新建RC暂态" }).click();
    await page.waitForURL(/\/project\//);
    await waitSaved(page);
    await page.getByRole("button", { name: "运行暂态" }).click();
    await expect(page.getByTestId("run-status")).toContainText("成功 · 当前", { timeout: 120_000 });
    const oneTau = Number.parseFloat(await page.getByTestId("v-1tau").innerText());
    const fiveTau = Number.parseFloat(await page.getByTestId("v-5tau").innerText());
    expect(Math.abs(oneTau - 3.1606) / 3.1606).toBeLessThan(0.005);
    expect(Math.abs(fiveTau - 4.9663) / 4.9663).toBeLessThan(0.005);
    await expect(page.getByTestId("result-table")).toBeVisible();
    await expect(page.getByRole("img", { name: /示波器/ })).toBeVisible();
    const runId = await page.getByTestId("instrument-run-id").innerText();
    expect(runId.length).toBeGreaterThan(8);
  });

  test("lowpass ac exposes db20 phase and cutoff", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "新建低通交流" }).click();
    await page.waitForURL(/\/project\//);
    await waitSaved(page);
    await page.getByRole("button", { name: "运行交流" }).click();
    await expect(page.getByTestId("run-status")).toContainText("成功 · 当前", { timeout: 120_000 });
    const cutoff = Number.parseFloat(await page.getByTestId("ac-cutoff-hz").innerText());
    const expected = 1 / (2 * Math.PI * 1000 * 1e-6);
    expect(Math.abs(cutoff - expected) / expected).toBeLessThan(0.01);
    await expect(page.getByRole("img", { name: /Bode/ })).toBeVisible();
    await expect(page.locator("desc")).toContainText("db20");
    await expect(page.locator("desc")).toContainText("phase");
    await expect(page.getByTestId("result-table")).toBeVisible();
  });

  test("cancel stops an rc run and re-enables run quickly", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "新建RC暂态" }).click();
    await page.waitForURL(/\/project\//);
    await waitSaved(page);
    await page.getByRole("button", { name: "运行暂态" }).click();
    await expect(page.getByTestId("run-status")).toContainText("运行中", { timeout: 30_000 });
    const started = Date.now();
    await page.getByRole("button", { name: "取消运行" }).click();
    await expect(page.getByRole("button", { name: "运行暂态" })).toBeEnabled({ timeout: 500 });
    expect(Date.now() - started).toBeLessThanOrEqual(500);
    await expect(page.getByTestId("run-status")).toHaveText(/已取消|尚未运行|cancelled/);
    await expect(page.getByTestId("result-dock")).toHaveText(/没有选中的成功运行/);
    await page.getByRole("button", { name: "运行暂态" }).click();
    await expect(page.getByTestId("run-status")).toContainText("成功 · 当前", { timeout: 120_000 });
    expect(Number.parseFloat(await page.getByTestId("v-1tau").innerText())).toBeGreaterThan(3);
  });

  test("probes stay on the selected run and reject a forged current-source draft", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "新建分压项目" }).click();
    await page.waitForURL(/\/project\//);
    await waitSaved(page);
    await page.getByRole("button", { name: "添加电流源" }).click();
    await waitSaved(page);
    const revisionBeforeForge = await page.getByTestId("project-revision").innerText();
    await expect(page.getByTestId("add-current-I1")).toHaveCount(0);
    await page.waitForFunction(() => typeof (window as Window & { __fluxlabSubmitProbeDraft?: unknown }).__fluxlabSubmitProbeDraft === "function");
    await page.evaluate(() => {
      const host = window as Window & {
        __fluxlabDefaultQualifiedVectors?: { capabilities: Array<{ quantity: string; family: string }> };
        __fluxlabQualifiedVectorManifest?: unknown;
      };
      const base = structuredClone(host.__fluxlabDefaultQualifiedVectors);
      if (base) {
        host.__fluxlabQualifiedVectorManifest = {
          ...base,
          capabilities: base.capabilities.filter(item => !(item.quantity === "branch-current" && item.family === "I")),
        };
      }
    });
    const forged = await page.evaluate(async () => {
      const host = window as Window & {
        __fluxlabSubmitProbeDraft?: (probe: {
          id: string;
          kind: "branch-current";
          componentId: string;
          label: string;
        }) => Promise<Array<{ code: string }>>;
      };
      return host.__fluxlabSubmitProbeDraft?.({
        id: "pr-forged-i1",
        kind: "branch-current",
        componentId: "I1",
        label: "I(I1)",
      });
    });
    expect(forged?.some(item => item.code === "PROBE_UNSUPPORTED_BRANCH_CURRENT")).toBe(true);
    await expect(page.getByTestId("diagnostic-PROBE_UNSUPPORTED_BRANCH_CURRENT")).toBeVisible();
    await expect(page.getByTestId("project-revision")).toHaveText(revisionBeforeForge);
    await expect(page.getByTestId("model-count")).toHaveText("0");
    await page.getByRole("button", { name: "选择 I1" }).click();
    await page.getByRole("button", { name: "删除元件" }).click();
    await waitSaved(page);

    await page.getByRole("button", { name: "添加 R1 节点电压" }).click();
    await page.getByRole("button", { name: /添加差分电压/ }).click();
    await page.getByTestId("add-current-R1").click();
    await page.getByTestId("add-power-R1").click();
    await waitSaved(page);
    await page.getByRole("button", { name: "运行 DC 工作点" }).click();
    await expect(page.getByTestId("run-status")).toContainText("成功 · 当前", { timeout: 120_000 });
    const runId = await page.getByTestId("instrument-run-id").innerText();
    expect(runId.length).toBeGreaterThan(8);
  });

  test("adopting a safe diode model binds D1 and a dangerous model writes nothing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "新建分压项目" }).click();
    await page.waitForURL(/\/project\//);
    await waitSaved(page);
    await page.getByLabel("模型源").fill(".model DMOD D(IS=1e-14 N=1)\n");
    await page.getByRole("button", { name: "预览模型" }).click();
    await expect(page.getByTestId("model-preview")).toContainText("DMOD");
    await page.getByRole("button", { name: "采用模型" }).click();
    await waitSaved(page);
    await expect(page.getByTestId("model-count")).toHaveText("1");
    await page.getByRole("button", { name: "添加二极管" }).click();
    await page.getByRole("button", { name: "选择 D1" }).click();
    await expect(page.getByLabel("模型引用")).toHaveValue("dmod");
    const revision = await page.getByTestId("project-revision").innerText();
    await page.getByLabel("模型源").fill(".model DMOD D(IS=1e-14 N=1)\n+ .shell calc\n");
    await page.getByRole("button", { name: "预览模型" }).click();
    await expect(page.getByTestId("diagnostic-SPICE_FORBIDDEN_DIRECTIVE")).toBeVisible();
    await page.getByRole("button", { name: "采用模型" }).click();
    await expect(page.getByTestId("model-count")).toHaveText("1");
    await expect(page.getByTestId("project-revision")).toHaveText(revision);
  });
});
