import { describe, expect, it } from "vitest";
import { parseAndValidateSpiceSource } from "./spice-source-parser";

describe("SPICE source trust boundary", () => {
  it("cannot hide a forbidden directive in a continuation", async () => {
    const result = await parseAndValidateSpiceSource(".model DLED D(IS=1e-12)\r\n+ .shell touch owned", "project-model", "opaque-model");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]).toMatchObject({ code: "SPICE_FORBIDDEN_DIRECTIVE", location: { line: 1, endLine: 2 } });
  });

  it("preserves declared subcircuit pin and parameter order", async () => {
    const result = await parseAndValidateSpiceSource(".subckt FILTER IN OUT PARAMS: R=1k C=1u\nR1 IN OUT {R}\n.ends FILTER", "bundled-model", "opaque-model");
    expect(result.ok && result.value.subcircuits[0]).toMatchObject({ name: "FILTER", orderedPins: ["IN", "OUT"], parameterNames: ["R", "C"] });
  });

  it("accepts only supported editable statements and rejects control blocks", async () => {
    await expect(parseAndValidateSpiceSource("divider\nV1 IN 0 9\nR1 IN OUT 1k\nR2 OUT 0 2k\n.op\n.end", "user-cir", "editable-circuit")).resolves.toMatchObject({ ok: true });
    await expect(parseAndValidateSpiceSource(".control\nrun\n.endc", "user-cir", "editable-circuit")).resolves.toMatchObject({ ok: false });
  });
});
