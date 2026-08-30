import { bundledManifestForValidation, bundledModelDefinition, CURRENT_BUNDLED_MODEL_KEYS } from "./bundled-models";
import type { CircuitProjectV2, ComponentInstance, Diagnostic, ModelDefinition, ProjectId } from "./project-v2";
import { parseCircuitProjectV2 } from "./project-schema";
import { circuitDocumentV1Schema, type CircuitDocumentV1 } from "../../legacy/v1-types";
import { validateProjectModels } from "../../simulation/spice-source-parser";

export type MigrationResult =
  | {
      kind: "candidate";
      project: CircuitProjectV2;
      diagnostics: Diagnostic[];
      sourceVersion: 1;
      discardedEvidence: true;
    }
  | { kind: "rejected"; diagnostics: Diagnostic[] };

function pinFor(kind: CircuitDocumentV1["components"][number]["kind"], port: "top" | "bottom") {
  if (kind === "ground" || kind === "probe") return "p";
  return port === "top" ? "p" : "n";
}

function rejected(code: string, message: string): MigrationResult {
  return {
    kind: "rejected",
    diagnostics: [{ severity: "error", code, message, blocksRun: true }],
  };
}

export async function migrateV1CircuitDocument(
  input: unknown,
  options: { projectId: ProjectId; migratedAt: string }
): Promise<MigrationResult> {
  const parsed = circuitDocumentV1Schema.safeParse(input);
  if (!parsed.success) {
    return rejected("MIGRATION_INVALID_V1", "v1 document is missing required fields or uses an unknown version");
  }
  const document = parsed.data;
  const diagnostics: Diagnostic[] = [];
  let needsSwitchRewire = false;
  const models: ModelDefinition[] = [];
  const components: ComponentInstance[] = [];
  const probes = [];
  const layoutComponents: CircuitProjectV2["layout"]["components"] = {};

  for (const component of document.components) {
    layoutComponents[component.id] = { x: component.x, y: component.y, rotation: 0 };
    if (component.kind === "probe") {
      probes.push({
        id: component.id,
        kind: "node-voltage" as const,
        node: { componentId: component.targetComponentId ?? component.id, pin: "p" },
        label: component.label,
      });
      continue;
    }
    if (component.kind === "voltageSource") {
      components.push({
        id: component.id,
        refdes: component.id,
        kind: "voltageSource",
        params: { dcV: component.value ?? 0 },
      });
      continue;
    }
    if (component.kind === "resistor") {
      components.push({
        id: component.id,
        refdes: component.id,
        kind: "resistor",
        params: { resistanceOhm: component.value ?? 1000 },
      });
      continue;
    }
    if (component.kind === "capacitor") {
      components.push({
        id: component.id,
        refdes: component.id,
        kind: "capacitor",
        params: { capacitanceF: component.value ?? 1e-6 },
      });
      continue;
    }
    if (component.kind === "ground") {
      components.push({ id: component.id, refdes: "GND", kind: "ground", params: {} });
      continue;
    }
    if (component.kind === "led" || component.kind === "diode") {
      const diode = await bundledModelDefinition(CURRENT_BUNDLED_MODEL_KEYS.led);
      if (!diode) return rejected("MIGRATION_MODEL_MISSING", "bundled LED model is unavailable");
      if (!models.some(item => item.id === diode.id)) models.push(diode);
      components.push({
        id: component.id,
        refdes: component.id.startsWith("D") || component.id.startsWith("d") ? component.id : `D${component.id}`,
        kind: "diode",
        params: { area: 1 },
        modelRef: diode.id,
      });
      continue;
    }
    if (component.kind === "switch") {
      const sw = await bundledModelDefinition(CURRENT_BUNDLED_MODEL_KEYS.migrationSwitch);
      if (!sw) return rejected("MIGRATION_MODEL_MISSING", "bundled switch model is unavailable");
      if (!models.some(item => item.id === sw.id)) models.push(sw);
      components.push({
        id: component.id,
        refdes: component.id,
        kind: "switch",
        params: {},
        modelRef: sw.id,
      });
      needsSwitchRewire = true;
    }
  }

  const wires = document.wires.map(wire => {
    const fromKind = document.components.find(item => item.id === wire.from.componentId)?.kind ?? "resistor";
    const toKind = document.components.find(item => item.id === wire.to.componentId)?.kind ?? "resistor";
    return {
      id: wire.id,
      from: { componentId: wire.from.componentId, pin: pinFor(fromKind, wire.from.port) },
      to: { componentId: wire.to.componentId, pin: pinFor(toKind, wire.to.port) },
    };
  });

  if (needsSwitchRewire) {
    diagnostics.push({
      severity: "error",
      code: "MIGRATION_SWITCH_REQUIRES_REWIRE",
      message: "v1 switch conduction pins were kept; control pins cp/cn must be wired before run",
      blocksRun: true,
    });
  }

  const project: CircuitProjectV2 = {
    schemaVersion: 2,
    id: options.projectId,
    title: document.name,
    createdAt: options.migratedAt,
    updatedAt: options.migratedAt,
    revision: 1,
    electricalRevision: 1,
    schematic: { components, wires },
    layout: { components: layoutComponents, wireRoutes: {} },
    models,
    analyses: [{ id: "an-op", name: "DC OP", kind: "dc-op", enabledProbes: probes.map(item => item.id) }],
    probes,
    assertions: [],
    corners: [],
    notes: [],
  };

  const schema = parseCircuitProjectV2(project);
  if (!schema.ok) return { kind: "rejected", diagnostics: schema.diagnostics };
  const validated = await validateProjectModels(schema.value, "migration", await bundledManifestForValidation());
  if (!validated.ok) return { kind: "rejected", diagnostics: validated.diagnostics };
  return {
    kind: "candidate",
    project: validated.value,
    diagnostics,
    sourceVersion: 1,
    discardedEvidence: true,
  };
}
