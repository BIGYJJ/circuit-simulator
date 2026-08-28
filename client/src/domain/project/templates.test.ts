import { describe, expect, it } from "vitest";
import { createDividerTemplate, createLedTemplate, createRcTemplate } from "./templates";

describe("v2 templates", () => {
  it("creates deterministic circuit facts without any pre-completed learning evidence", async () => {
    const led = await createLedTemplate("led-a", "2026-08-28T00:00:00.000Z");
    expect(led.ok).toBe(true);
    if (!led.ok) return;
    expect(led.value.schematic.components.find((item) => item.id === "R1")?.params).toEqual({ resistanceOhm: 680 });
    expect("learning" in led.value).toBe(false);
    await expect(createDividerTemplate("divider-a", "2026-08-28T00:00:00.000Z")).resolves.toMatchObject({ ok: true });
    await expect(createRcTemplate("rc-a", "2026-08-28T00:00:00.000Z")).resolves.toMatchObject({ ok: true });
  });
});
