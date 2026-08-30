import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../../tests/fixtures/circuits/projects";
import { canonicalJson, hashCanonical } from "./canonical";
import { parseCircuitProjectV2 } from "./project-schema";

describe("CircuitProjectV2 trust boundary", () => {
  it("accepts a divider fixture and canonicalizes key order", () => {
    expect(parseCircuitProjectV2(dividerProjectFixture()).ok).toBe(true);
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it("rejects non-finite SI values and an invalid PULSE period", () => {
    const project = dividerProjectFixture();
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
    if (!result.ok) expect(result.diagnostics.map(item => item.code)).toEqual(["SCHEMA_NON_FINITE", "SCHEMA_BAD_PULSE"]);
  });

  it("hashes objects by sorted keys and treats array order as significant", async () => {
    const left = await hashCanonical({ z: 1, a: [2, 3] });
    const right = await hashCanonical({ a: [2, 3], z: 1 });
    const shuffledArray = await hashCanonical({ a: [3, 2], z: 1 });
    expect(left).toBe(right);
    expect(left).not.toBe(shuffledArray);
  });

  it("rejects hostile tokens and reserved keys before they reach the graph", () => {
    const cases: Array<{ mutate: (project: ReturnType<typeof dividerProjectFixture>) => void; code: string }> = [
      {
        mutate: project => {
          project.schematic.components[1] = {
            id: "comp-r1",
            refdes: "R1\n",
            kind: "resistor",
            params: { resistanceOhm: 1000 },
          };
        },
        code: "SCHEMA_BAD_REFDES",
      },
      {
        mutate: project => {
          project.schematic.components[1] = {
            id: "comp-r1",
            refdes: "C1",
            kind: "resistor",
            params: { resistanceOhm: 1000 },
          };
        },
        code: "SCHEMA_BAD_REFDES_FAMILY",
      },
      {
        mutate: project => {
          project.schematic.components.push({
            id: "comp-r1-dup",
            refdes: "r1",
            kind: "resistor",
            params: { resistanceOhm: 470 },
          });
        },
        code: "SCHEMA_DUPLICATE_REFDES",
      },
      {
        mutate: project => {
          project.schematic.wires[1] = {
            ...project.schematic.wires[1]!,
            netLabel: ".VOUT",
          };
        },
        code: "SCHEMA_BAD_NET_LABEL",
      },
      {
        mutate: project => {
          (project as { id: string }).id = "__proto__";
        },
        code: "SCHEMA_RESERVED_KEY",
      },
      {
        mutate: project => {
          (project as { id: string }).id = "prototype";
        },
        code: "SCHEMA_RESERVED_KEY",
      },
      {
        mutate: project => {
          (project as { id: string }).id = "constructor";
        },
        code: "SCHEMA_RESERVED_KEY",
      },
    ];

    for (const { mutate, code } of cases) {
      const project = dividerProjectFixture();
      mutate(project);
      const result = parseCircuitProjectV2(project);
      expect(result.ok, code).toBe(false);
      if (!result.ok) expect(result.diagnostics.map(item => item.code)).toContain(code);
    }
  });
});
