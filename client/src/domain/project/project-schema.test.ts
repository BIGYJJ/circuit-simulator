import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../../tests/fixtures/circuits/projects";
import { canonicalJson, hashCanonical } from "./canonical";
import { parseCircuitProjectV2 } from "./project-schema";

describe("CircuitProjectV2 trust boundary", () => {
  it("accepts a divider fixture and canonicalizes key order", async () => {
    expect(parseCircuitProjectV2(dividerProjectFixture()).ok).toBe(true);
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    await expect(hashCanonical({ b: [2, 1], a: 1 })).resolves.toBe(await hashCanonical({ a: 1, b: [2, 1] }));
    await expect(hashCanonical([1, 2])).resolves.not.toBe(await hashCanonical([2, 1]));
  });

  it("rejects non-finite SI values and an invalid PULSE period", () => {
    const project: any = dividerProjectFixture();
    project.schematic.components[0] = {
      id: "V1",
      refdes: "V1",
      kind: "voltageSource",
      params: {
        dcV: Number.NaN,
        transient: { kind: "pulse", initialV: 0, pulsedV: 5, delayS: 0, riseS: 1, fallS: 1, widthS: 2, periodS: 3 },
      },
    };
    const result = parseCircuitProjectV2(project);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((item) => item.code)).toEqual(["SCHEMA_NON_FINITE", "SCHEMA_BAD_PULSE"]);
  });

  it("rejects hostile IDs, refdes and untrusted object keys before graph access", () => {
    const project: any = dividerProjectFixture();
    project.schematic.components[0].refdes = "R\n1";
    project.layout.components.constructor = { x: 0, y: 0, rotation: 0 };
    const result = parseCircuitProjectV2(project);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some((item) => item.code === "SCHEMA_BAD_REFDES")).toBe(true);
  });
});
