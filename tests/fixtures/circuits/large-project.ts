import type { CircuitProjectV2, ComponentInstance } from "../../../client/src/domain/project/project-v2";

const COUNT = 500;

export function createLargeEditProject(projectId = "proj-large-edit"): CircuitProjectV2 {
  const components: ComponentInstance[] = [
    { id: "V1", refdes: "V1", kind: "voltageSource", params: { dcV: 9 } },
    { id: "GND", refdes: "GND", kind: "ground", params: {} },
  ];
  const layout: CircuitProjectV2["layout"]["components"] = {
    V1: { x: 40, y: 40, rotation: 0 },
    GND: { x: 40, y: 400, rotation: 0 },
  };
  for (let index = 1; index <= COUNT - 2; index += 1) {
    const id = `R${String(index).padStart(3, "0")}`;
    components.push({ id, refdes: id, kind: "resistor", params: { resistanceOhm: 1000 } });
    layout[id] = { x: 80 + (index % 24) * 28, y: 40 + Math.floor(index / 24) * 28, rotation: 0 };
  }
  return {
    schemaVersion: 2,
    id: projectId,
    title: "500-component edit fixture",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    revision: 1,
    electricalRevision: 1,
    schematic: { components, wires: [] },
    layout: { components: layout, wireRoutes: {}, viewport: { x: 0, y: 0, zoom: 1 } },
    models: [],
    analyses: [{ id: "an-op", name: "DC OP", kind: "dc-op", enabledProbes: [] }],
    probes: [],
    assertions: [],
    corners: [],
    notes: [],
  };
}
