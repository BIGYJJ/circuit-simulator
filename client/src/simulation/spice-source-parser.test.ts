import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAndValidateSpiceSource, validateProjectModels } from "./spice-source-parser";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/netlists");

describe("SPICE source trust boundary", () => {
  it("cannot hide a forbidden directive in a continuation", async () => {
    const result = await parseAndValidateSpiceSource(
      ".model DLED D(IS=1e-12)\r\n+ .shell touch owned",
      "project-model",
      "opaque-model"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "SPICE_FORBIDDEN_DIRECTIVE",
        location: { line: 1, endLine: 2 },
      });
    }
  });

  it("preserves declared subcircuit pin and parameter order", async () => {
    const result = await parseAndValidateSpiceSource(
      ".subckt FILTER IN OUT PARAMS: R=1k C=1u\nR1 IN OUT {R}\n.ends FILTER",
      "bundled-model",
      "opaque-model"
    );
    expect(result.ok && result.value.subcircuits[0]).toMatchObject({
      name: "FILTER",
      orderedPins: ["IN", "OUT"],
      parameterNames: ["R", "C"],
    });
  });

  it("accepts the allowed circuit and model fixtures", async () => {
    const circuit = await parseAndValidateSpiceSource(
      readFileSync(join(FIXTURES, "allowed-circuit.cir"), "utf8"),
      "user-cir",
      "editable-circuit"
    );
    const model = await parseAndValidateSpiceSource(
      readFileSync(join(FIXTURES, "allowed-model.lib"), "utf8"),
      "bundled-model",
      "opaque-model"
    );
    expect(circuit.ok).toBe(true);
    expect(model.ok).toBe(true);
  });

  it("rejects fixture files that hide or declare forbidden control", async () => {
    const bypass = await parseAndValidateSpiceSource(
      readFileSync(join(FIXTURES, "continued-directive-bypass.cir"), "utf8"),
      "project-model",
      "opaque-model"
    );
    const control = await parseAndValidateSpiceSource(
      readFileSync(join(FIXTURES, "forbidden-control.cir"), "utf8"),
      "user-cir",
      "editable-circuit"
    );
    expect(bypass.ok).toBe(false);
    expect(control.ok).toBe(false);
  });

  it("rejects garbage suffixes, commas, and case-only duplicate models", async () => {
    const garbage = await parseAndValidateSpiceSource("R1 1 0 10kgarbage\n", "user-cir", "editable-circuit");
    const comma = await parseAndValidateSpiceSource("R1 1 0 1,0k\n", "user-cir", "editable-circuit");
    const dup = await parseAndValidateSpiceSource(
      ".model DLED D(IS=1e-14)\n.model dled D(IS=2e-14)\n",
      "project-model",
      "opaque-model"
    );
    expect(garbage.ok).toBe(false);
    expect(comma.ok).toBe(false);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.diagnostics.some(item => item.code === "SPICE_DUPLICATE_SYMBOL")).toBe(true);
  });
});
