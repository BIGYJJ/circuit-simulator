import { describe, expect, it } from "vitest";
import legacyRc from "../../../../tests/fixtures/migrations/rc-v1.json";
import { migrateV1CircuitDocument } from "./migrate-v1";

describe("v1 migration preview", () => {
  it("keeps RC as a rewire candidate instead of fabricating a pulse circuit", async () => {
    const result = await migrateV1CircuitDocument(legacyRc, {
      projectId: "rc-migrated",
      migratedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    expect(result.diagnostics.some(item => item.code === "MIGRATION_SWITCH_REQUIRES_REWIRE" && item.blocksRun)).toBe(true);
    expect(result.project.schematic.components.some(item => item.kind === "switch")).toBe(true);
  });

  it("rejects unknown versions without throwing", async () => {
    const result = await migrateV1CircuitDocument({ version: 9, components: [] }, {
      projectId: "bad",
      migratedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(result.kind).toBe("rejected");
  });
});
