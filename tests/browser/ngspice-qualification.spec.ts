import { expect, test } from "@playwright/test";

test("qualifies the pinned runtime, cleanup, cancellation, model loading, and limits", async ({
  page,
}) => {
  const responses = new Map<string, string>();
  page.on("response", response =>
    responses.set(
      new URL(response.url()).pathname,
      response.headers()["content-security-policy"] ?? ""
    )
  );
  page.on("pageerror", error => console.log("PAGEERROR", error.message));
  page.on("console", message => {
    if (message.type() === "error") console.log("CONSOLE", message.text());
  });
  await page.goto("/qualification.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => ["done", "failed"].includes(document.body.dataset.qualification ?? ""),
    null,
    { timeout: 160_000 }
  );
  const status = await page.evaluate(() => ({
    state: document.body.dataset.qualification,
    error: document.body.dataset.qualificationError ?? "",
  }));
  if (status.state !== "done") throw new Error(status.error || "qualification failed");
  const result = await page.evaluate(async () => await window.__qualificationResult);
  expect(result.dividerVout).toBeCloseTo(6, 6);
  expect(result.rcAt1Tau).toBeCloseTo(3.160602794, 2);
  expect(result.rcAt5Tau).toBeCloseTo(4.966310266, 2);
  expect(result.diodeCurrentRatio).toBeGreaterThan(10);
  expect(result.lowpassCutoffHz).toBeGreaterThan(157.56);
  expect(result.lowpassCutoffHz).toBeLessThan(160.75);
  expect(result.subcircuitVout).toBeCloseTo(2.5, 6);
  expect(result.dividerR1PowerW).toBeCloseTo(0.009, 9);
  expect(result.diodePowerMatchesVI).toBe(true);
  expect(result.secondRunEqualsFirst).toBe(true);
  expect(result.cancelledWorkerRebuilt).toBe(true);
  expect(result.webLocksAvailable).toBe(true);
  expect(result.cancelReadyMs).toBeLessThanOrEqual(500);
  expect(result.hashMismatchCode).toBe("ENGINE_HASH_MISMATCH");
  expect(result.moduleHashMismatchCode).toBe("ENGINE_MODULE_HASH_MISMATCH");
  expect(result.versionMismatchCode).toBe("ENGINE_VERSION_MISMATCH");
  expect(result.transportMismatchCode).toBe("ENGINE_TRANSPORT_MISMATCH");
  expect(result.engineBuildMismatchCode).toBe("ENGINE_BUILD_MISMATCH");
  expect(["vector-callback", "binary-rawfile"]).toContain(result.resultTransport);
  if (result.resultTransport === "vector-callback")
    expect(result.rawfileFsBytes).toBe(0);
  else expect(result.rawfileEstimateCoversActual).toBe(true);
  expect(result.limitCodes).toEqual([
    "RESOURCE_FS",
    "RESOURCE_HEAP",
    "RESOURCE_LOG",
    "RESOURCE_POINTS",
    "RESOURCE_RAW_RESULT",
    "RESOURCE_VECTOR",
  ]);
  expect(result.fsEntriesAfterRun).toEqual([]);
  expect(result.plotsAfterCleanup).toEqual([]);
  expect(result.businessRequests).toEqual([]);
  expect(responses.get("/qualification.html")).toContain("default-src 'self'");
});
