import type { CircuitProjectV2 } from "../../../client/src/domain/project/project-v2";

export function dividerProjectFixture(): CircuitProjectV2 {
  return {
    schemaVersion: 2,
    id: "proj-divider-v2",
    title: "9V divider",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components: [
        { id: "V1", refdes: "V1", kind: "voltageSource", params: { dcV: 9 } },
        { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 1000 } },
        { id: "R2", refdes: "R2", kind: "resistor", params: { resistanceOhm: 2000 } },
        { id: "GND", refdes: "GND", kind: "ground", params: {} },
      ],
      wires: [
        {
          id: "wire-v1-r1",
          from: { componentId: "V1", pin: "p" },
          to: { componentId: "R1", pin: "p" },
        },
        {
          id: "wire-r1-r2",
          from: { componentId: "R1", pin: "n" },
          to: { componentId: "R2", pin: "p" },
          netLabel: "VOUT",
        },
        {
          id: "wire-r2-gnd",
          from: { componentId: "R2", pin: "n" },
          to: { componentId: "GND", pin: "p" },
        },
        {
          id: "wire-v1-gnd",
          from: { componentId: "V1", pin: "n" },
          to: { componentId: "GND", pin: "p" },
        },
      ],
    },
    layout: {
      components: {
        V1: { x: 80, y: 40, rotation: 0 },
        R1: { x: 80, y: 140, rotation: 0 },
        R2: { x: 80, y: 240, rotation: 0 },
        GND: { x: 80, y: 320, rotation: 0 },
      },
      wireRoutes: {
        "wire-v1-r1": [
          { x: 80, y: 60 },
          { x: 80, y: 120 },
        ],
        "wire-r1-r2": [
          { x: 80, y: 160 },
          { x: 80, y: 220 },
        ],
        "wire-r2-gnd": [
          { x: 80, y: 260 },
          { x: 80, y: 300 },
        ],
        "wire-v1-gnd": [
          { x: 40, y: 40 },
          { x: 40, y: 320 },
        ],
      },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    models: [],
    analyses: [{ id: "an-op", name: "DC OP", kind: "dc-op", enabledProbes: ["probe-vout"] }],
    probes: [
      {
        id: "probe-vout",
        kind: "node-voltage",
        node: { componentId: "R1", pin: "n" },
        label: "Vout",
      },
    ],
    assertions: [
      {
        id: "assert-vout",
        name: "Vout is 6 V",
        enabled: true,
        analysisId: "an-op",
        expression: { function: "valueAt", vectorId: "vec-placeholder", at: { value: 0, unit: "index" } },
        comparator: {
          kind: "near",
          expected: { value: 6, unit: "V" },
          absoluteTolerance: { value: 0.01, unit: "V" },
        },
      },
    ],
    corners: [],
    notes: [],
  };
}
