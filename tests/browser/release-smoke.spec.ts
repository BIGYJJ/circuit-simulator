import { expect, test } from "@playwright/test";

const ROUTES = ["/", "/settings", "/divider", "/led", "/engineering", "/learn/foundation-divider"];

test("official and legacy routes open, reload, and a divider run succeeds", async ({ page }) => {
  test.setTimeout(180_000);
  for (const route of ROUTES) {
    await page.goto(route);
    await page.reload();
    await expect(page.locator("body")).toBeVisible();
  }
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.waitForURL(/\/project\//);
  await expect(page.getByTestId("project-save-state")).toHaveText("已保存");
  await page.getByRole("button", { name: "运行 DC 工作点" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("成功 · 当前", { timeout: 120_000 });
  await expect(page.getByTestId("vout-value")).toHaveText("6.000000 V");
  await page.goto("/settings");
  await expect(page.getByTestId("settings-app-build-id")).not.toHaveText("");
  await expect(page.getByTestId("settings-result-transport")).toHaveText("binary-rawfile");
});
