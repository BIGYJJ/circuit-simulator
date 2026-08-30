import { bundledManifestForValidation, bundledModelDefinition, CURRENT_BUNDLED_MODEL_KEYS } from "./bundled-models";
import type { CircuitProjectV2, ComponentInstance, DomainResult, SchematicLayout } from "./project-v2";
import { parseCircuitProjectV2 } from "./project-schema";
import { validateProjectModels } from "../../simulation/spice-source-parser";

function layoutFor(components: ComponentInstance[], positions: Record<string, { x: number; y: number }>): SchematicLayout {
  return {
    components: Object.fromEntries(
      components.map(component => [component.id, { ...positions[component.id]!, rotation: 0 as const }])
    ),
    wireRoutes: {},
  };
}

async function finalize(project: CircuitProjectV2): Promise<DomainResult<CircuitProjectV2>> {
  const parsed = parseCircuitProjectV2(project);
  if (!parsed.ok) return parsed;
  return validateProjectModels(parsed.value, "bundled-model", await bundledManifestForValidation());
}

export async function createDividerTemplate(projectId: string, createdAt: string): Promise<DomainResult<CircuitProjectV2>> {
  const components: ComponentInstance[] = [
    { id: "V1", refdes: "V1", kind: "voltageSource", params: { dcV: 9 } },
    { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 1000 } },
    { id: "R2", refdes: "R2", kind: "resistor", params: { resistanceOhm: 2000 } },
    { id: "GND", refdes: "GND", kind: "ground", params: {} },
  ];
  return finalize({
    schemaVersion: 2,
    id: projectId,
    title: "9V 分压器实验",
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components,
      wires: [
        { id: "w1", from: { componentId: "V1", pin: "p" }, to: { componentId: "R1", pin: "p" } },
        { id: "w2", from: { componentId: "R1", pin: "n" }, to: { componentId: "R2", pin: "p" }, netLabel: "VOUT" },
        { id: "w3", from: { componentId: "R2", pin: "n" }, to: { componentId: "GND", pin: "p" } },
        { id: "w4", from: { componentId: "GND", pin: "p" }, to: { componentId: "V1", pin: "n" } },
      ],
    },
    layout: layoutFor(components, {
      V1: { x: 220, y: 285 },
      R1: { x: 490, y: 215 },
      R2: { x: 490, y: 390 },
      GND: { x: 490, y: 545 },
    }),
    models: [],
    analyses: [{ id: "an-op", name: "DC OP", kind: "dc-op", enabledProbes: ["pr-vout"] }],
    probes: [{ id: "pr-vout", kind: "node-voltage", node: { componentId: "R1", pin: "n" }, label: "Vout" }],
    assertions: [],
    corners: [],
    notes: [],
  });
}

export async function createRcTemplate(projectId: string, createdAt: string): Promise<DomainResult<CircuitProjectV2>> {
  const components: ComponentInstance[] = [
    {
      id: "V1",
      refdes: "V1",
      kind: "voltageSource",
      params: {
        dcV: 0,
        transient: { kind: "pulse", initialV: 0, pulsedV: 5, delayS: 0, riseS: 1e-9, fallS: 1e-9, widthS: 10, periodS: 20 },
      },
    },
    { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 10000 } },
    { id: "C1", refdes: "C1", kind: "capacitor", params: { capacitanceF: 100e-6 } },
    { id: "GND", refdes: "GND", kind: "ground", params: {} },
  ];
  return finalize({
    schemaVersion: 2,
    id: projectId,
    title: "RC transient",
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components,
      wires: [
        { id: "w1", from: { componentId: "V1", pin: "p" }, to: { componentId: "R1", pin: "p" } },
        { id: "w2", from: { componentId: "R1", pin: "n" }, to: { componentId: "C1", pin: "p" } },
        { id: "w3", from: { componentId: "C1", pin: "n" }, to: { componentId: "GND", pin: "p" } },
        { id: "w4", from: { componentId: "GND", pin: "p" }, to: { componentId: "V1", pin: "n" } },
      ],
    },
    layout: layoutFor(components, {
      V1: { x: 230, y: 328 },
      R1: { x: 560, y: 280 },
      C1: { x: 560, y: 435 },
      GND: { x: 560, y: 565 },
    }),
    models: [],
    analyses: [{ id: "an-tran", name: "Transient", kind: "transient", stepS: 0.01, stopS: 5, enabledProbes: ["pr-vcap"] }],
    probes: [{ id: "pr-vcap", kind: "node-voltage", node: { componentId: "C1", pin: "p" }, label: "Vcap" }],
    assertions: [],
    corners: [],
    notes: [],
  });
}

export async function createLedTemplate(projectId: string, createdAt: string): Promise<DomainResult<CircuitProjectV2>> {
  const diode = await bundledModelDefinition(CURRENT_BUNDLED_MODEL_KEYS.led);
  if (!diode) return { ok: false, diagnostics: [{ severity: "error", code: "BUNDLED_MODEL_MISSING", message: "LED model missing", blocksRun: true }] };
  const components: ComponentInstance[] = [
    { id: "V1", refdes: "V1", kind: "voltageSource", params: { dcV: 5 } },
    { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 680 } },
    { id: "D1", refdes: "D1", kind: "diode", params: { area: 1 }, modelRef: diode.id },
    { id: "GND", refdes: "GND", kind: "ground", params: {} },
  ];
  return finalize({
    schemaVersion: 2,
    id: projectId,
    title: "LED series",
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components,
      wires: [
        { id: "w1", from: { componentId: "V1", pin: "p" }, to: { componentId: "R1", pin: "p" } },
        { id: "w2", from: { componentId: "R1", pin: "n" }, to: { componentId: "D1", pin: "p" } },
        { id: "w3", from: { componentId: "D1", pin: "n" }, to: { componentId: "GND", pin: "p" } },
        { id: "w4", from: { componentId: "GND", pin: "p" }, to: { componentId: "V1", pin: "n" } },
      ],
    },
    layout: layoutFor(components, {
      V1: { x: 230, y: 310 },
      R1: { x: 540, y: 230 },
      D1: { x: 540, y: 410 },
      GND: { x: 540, y: 555 },
    }),
    models: [diode],
    analyses: [{ id: "an-op", name: "DC OP", kind: "dc-op", enabledProbes: ["pr-led"] }],
    probes: [{ id: "pr-led", kind: "branch-current", componentId: "D1", label: "I(D1)" }],
    assertions: [],
    corners: [],
    notes: [],
  });
}
