import { describe, expect, it } from "vitest";
import legacyDivider from "../../../../tests/fixtures/migrations/divider-v1.json";
import { migrateV1CircuitDocument } from "./migrate-v1";
import { createLedTemplate } from "./templates";

describe("v2 templates and migration", () => {
  it("does not ship a pre-completed LED lesson", async () => {
    const result = await createLedTemplate("led-a", "2026-08-28T00:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resistor = result.value.schematic.components.find(item => item.id === "R1");
    expect(resistor?.params).toEqual({ resistanceOhm: 680 });
    expect("learning" in result.value).toBe(false);
  });

  it("preserves divider ids/layout and discards legacy evidence", async () => {
    const result = await migrateV1CircuitDocument(legacyDivider, {
      projectId: "migrated-a",
      migratedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(result.kind).toBe("candidate");
    if (result.kind === "candidate") {
      expect(result.project.layout.components.R1.x).toBe(490);
      expect(result.project.schematic.components.some(item => item.id === "R1")).toBe(true);
      expect("learning" in result.project).toBe(false);
    }
  });
});
