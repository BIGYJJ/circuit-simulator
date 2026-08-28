import { expect, test } from "@playwright/test";

test("startup sends no business or cross-origin request", async ({ context, page }) => {
  const forbidden: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    const allowedStatic = /^(?:\/|\/assets\/[^?#]+|\/vendor\/ngspice\/[^?#]+|\/manifest\.webmanifest|\/sw\.js)$/;
    if (
      url.origin !== "http://127.0.0.1:4173" ||
      !["GET", "HEAD"].includes(request.method()) ||
      !allowedStatic.test(url.pathname)
    ) {
      forbidden.push(`${request.resourceType()} ${url.origin}${url.pathname}`);
    }
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});
