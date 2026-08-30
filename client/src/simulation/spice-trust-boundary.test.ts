import { describe, expect, it } from "vitest";
import { migrateV1CircuitDocument } from "../domain/project/migrate-v1";
import { createLedTemplate } from "../domain/project/templates";
import { diodeSweepProjectFixture } from "../../../tests/fixtures/circuits/projects";
import { compileNetlist } from "./compile-netlist";
import { parseAndValidateSpiceSource } from "./spice-source-parser";

const CONTROL = ".control\nshell echo pwn\n.endc\n.model EVIL D(IS=1e-14)\n";

describe("spice trust boundary", () => {
  it("rejects .control before any virtual FS write", async () => {
    const bundled = await parseAndValidateSpiceSource(CONTROL, "bundled-model", "opaque-model");
    expect(bundled.ok).toBe(false);

    const stored = await parseAndValidateSpiceSource(CONTROL, "stored-model", "opaque-model");
    expect(stored.ok).toBe(false);

    const led = await createLedTemplate("led-trust", "2026-08-28T00:00:00.000Z");
    expect(led.ok).toBe(true);

    const migrated = await migrateV1CircuitDocument(
      {
        schemaVersion: 1,
        id: "legacy",
        title: "x",
        components: [],
        wires: [],
        models: [{ id: "evil", source: CONTROL }],
      },
      { projectId: "m", migratedAt: "2026-08-28T00:00:00.000Z" }
    );
    expect(migrated.kind === "rejected" || (migrated.kind === "candidate" && migrated.diagnostics.some(item => item.blocksRun))).toBe(true);

    const project = diodeSweepProjectFixture();
    project.models[0] = { ...project.models[0]!, source: CONTROL, sha256: "0".repeat(64) };
    const compiled = await compileNetlist({ project, analysis: project.analyses[0]! });
    expect(compiled.ok).toBe(false);
  });
});
