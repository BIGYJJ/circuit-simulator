export function dividerProjectFixture(): any {
  return {
    schemaVersion: 2,
    id: "project:divider-v2",
    title: "9 V 分压器",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components: [
        { id: "V1", refdes: "V1", kind: "voltageSource", params: { dcV: 9 } },
        { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 1000 } },
        { id: "R2", refdes: "R2", kind: "resistor", params: { resistanceOhm: 2000 } },
        { id: "GND", refdes: "GND", kind: "ground", params: {} },
      ],
      wires: [],
    },
    layout: {
      components: {
        V1: { x: 0, y: 0, rotation: 0 },
        R1: { x: 100, y: 0, rotation: 0 },
        R2: { x: 200, y: 0, rotation: 0 },
        GND: { x: 300, y: 0, rotation: 0 },
      },
      wireRoutes: {},
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    models: [],
    analyses: [{ id: "analysis:op", name: "Operating point", kind: "dc-op", enabledProbes: [] }],
    probes: [],
    assertions: [],
    corners: [],
    notes: [],
  };
}
