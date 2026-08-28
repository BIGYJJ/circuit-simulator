import { describe, expect, it } from "vitest";
import legacyDivider from "../../../../tests/fixtures/migrations/divider-v1.json";
import { migrateV1CircuitDocument } from "./migrate-v1";

describe("v1 migration", () => {
  it("preserves structural IDs/layout while discarding legacy evidence", async () => {
    const result = await migrateV1CircuitDocument(legacyDivider, { projectId: "migrated-a", migratedAt: "2026-08-28T00:00:00.000Z" });
    expect(result.kind).toBe("candidate");
    if (result.kind === "candidate") {
      expect(result.project.layout.components.R1.x).toBe(490);
      expect(result.project.schematic.components.some((item) => item.id === "R1")).toBe(true);
      expect("learning" in result.project).toBe(false);
      expect(result.discardedEvidence).toBe(true);
    }
  });
});
