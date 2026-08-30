import { expect, test, type Page } from "@playwright/test";

async function waitSaved(page: Page) {
  await expect(page.getByTestId("project-save-state")).toContainText("已保存");
}

test("legacy URLs redirect to lessons or the current workspace", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/engineering");
  await page.waitForURL(/\/(?:\?|$)/);
  await expect(page.getByTestId("legacy-need-project")).toHaveText("请先选择项目");
  await expect(page.getByTestId("legacy-notice")).toBeVisible();
  const libraryProjects = await page.locator(".library-list li").count();
  expect(libraryProjects).toBe(0);

  await page.goto("/engineering");
  await page.waitForURL(/\/(?:\?|$)/);
  await expect(page.getByTestId("legacy-need-project")).toHaveText("请先选择项目");
  await expect(page.getByTestId("legacy-notice")).toHaveCount(0);

  await page.goto("/divider");
  await page.waitForURL(/\/project\/.+/);
  await waitSaved(page);
  expect(page.url()).toContain("lesson=foundation-divider");
  await expect(page.getByTestId("legacy-notice")).toBeVisible();
  const dividerUrl = page.url();
  const dividerId = dividerUrl.split("/project/")[1]!.split("?")[0]!;

  await page.goto("/divider");
  await page.waitForURL(/\/project\/.+/);
  await waitSaved(page);
  expect(page.url()).toContain(`/project/${dividerId}`);
  expect(page.url()).toContain("lesson=foundation-divider");
  await expect(page.getByTestId("legacy-notice")).toHaveCount(0);

  await page.goto("/led");
  await page.waitForURL(/\/project\/.+/);
  await waitSaved(page);
  expect(page.url()).toContain("lesson=foundation-led");
  await expect(page.getByTestId("legacy-notice")).toBeVisible();
  const ledId = page.url().split("/project/")[1]!.split("?")[0]!;

  await page.goto("/led");
  await page.waitForURL(/\/project\/.+/);
  expect(page.url()).toContain(`/project/${ledId}`);
  await expect(page.getByTestId("legacy-notice")).toHaveCount(0);

  await page.goto("/engineering");
  await page.waitForURL(/\/project\/.+/);
  expect(page.url()).toContain(`/project/${ledId}`);
  expect(page.url()).toContain("panel=analysis");
  await expect(page.getByTestId("workspace-panel-analysis")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("legacy-notice")).toHaveCount(0);

  await page.goto("/engineering/ops");
  await page.waitForURL(/\/project\/.+/);
  expect(page.url()).toContain(`/project/${ledId}`);
  expect(page.url()).toContain("panel=verification");
  await expect(page.getByTestId("workspace-panel-verification")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("legacy-notice")).toBeVisible();

  await page.goto("/engineering/ops");
  await page.waitForURL(/\/project\/.+/);
  expect(page.url()).toContain("panel=verification");
  await expect(page.getByTestId("legacy-notice")).toHaveCount(0);
});

test("engineering routes open the last workspace with a one-time notice", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建分压项目" }).click();
  await page.waitForURL(/\/project\//);
  await waitSaved(page);
  const projectId = page.url().split("/project/")[1]!.split("?")[0]!;

  await page.goto("/engineering");
  await page.waitForURL(/\/project\/.+/);
  expect(page.url()).toContain(`/project/${projectId}`);
  expect(page.url()).toContain("panel=analysis");
  await expect(page.getByTestId("workspace-panel-analysis")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("legacy-notice")).toBeVisible();

  await page.goto("/engineering");
  await page.waitForURL(/\/project\/.+/);
  expect(page.url()).toContain("panel=analysis");
  await expect(page.getByTestId("legacy-notice")).toHaveCount(0);

  await page.goto("/engineering/ops");
  await page.waitForURL(/\/project\/.+/);
  expect(page.url()).toContain("panel=verification");
  await expect(page.getByTestId("workspace-panel-verification")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("legacy-notice")).toBeVisible();
});
