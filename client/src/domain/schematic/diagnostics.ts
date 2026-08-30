import type { CircuitProjectV2, Diagnostic } from "../project/project-v2";
import { endpointKey, resolveComponentDefinition } from "./component-library";
import type { SchematicGraph } from "./graph";

const MODEL_FAMILY: Record<string, readonly string[]> = {
  switch: ["switch"],
  diode: ["diode"],
  bjt: ["npn", "pnp"],
  mosfet: ["nmos", "pmos"],
};

function push(diagnostics: Diagnostic[], code: string, message: string, location: Diagnostic["location"]) {
  diagnostics.push({
    severity: "error",
    code,
    message,
    blocksRun: true,
    location,
  });
}

export function runErc(project: CircuitProjectV2, graph: SchematicGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  const refdes = new Map<string, string>();

  for (const component of project.schematic.components) {
    if (ids.has(component.id)) push(diagnostics, "ERC_DUPLICATE_ID", "duplicate component id", { componentId: component.id, field: "id" });
    ids.add(component.id);
    const key = component.refdes.toUpperCase();
    if (refdes.has(key)) push(diagnostics, "ERC_DUPLICATE_REFDES", "duplicate refdes", { componentId: component.id, field: "refdes" });
    refdes.set(key, component.id);

    const resolved = resolveComponentDefinition(component, project.models);
    if (!resolved.ok) {
      diagnostics.push(...resolved.diagnostics);
      continue;
    }
    if ("modelRef" in component) {
      const model = project.models.find(item => item.id === component.modelRef);
      if (!model) {
        push(diagnostics, "ERC_MISSING_MODEL", "component modelRef is missing", { componentId: component.id, modelId: component.modelRef, field: "modelRef" });
      } else if (component.kind !== "subcircuit") {
        const allowed = MODEL_FAMILY[component.kind] ?? [];
        if (model.kind !== "spice-model" || !allowed.includes(model.deviceFamily)) {
          push(diagnostics, "ERC_INCOMPATIBLE_MODEL", "model family does not match the component", {
            componentId: component.id,
            modelId: model.id,
            field: "modelRef",
          });
        }
      }
    }

    for (const pin of resolved.value.requiredPins) {
      const key = endpointKey({ componentId: component.id, pin });
      const node = Object.hasOwn(graph.endpointToNode, key) ? graph.endpointToNode[key] : undefined;
      const peers = node && Object.hasOwn(graph.nodeToEndpoints, node) ? graph.nodeToEndpoints[node]! : [];
      const floating = component.kind !== "ground" && (!node || peers.length < 2);
      if (floating) {
        push(diagnostics, "ERC_FLOATING_REQUIRED_PIN", `required pin ${pin} is not connected`, {
          componentId: component.id,
          field: pin,
        });
      }
    }
  }

  for (const wire of project.schematic.wires) {
    for (const side of [wire.from, wire.to] as const) {
      const key = endpointKey(side);
      if (!Object.hasOwn(graph.endpointToNode, key)) {
        push(diagnostics, "ERC_UNKNOWN_ENDPOINT", "wire endpoint is not on the graph", {
          wireId: wire.id,
          componentId: side.componentId,
          field: side.pin,
        });
      }
    }
  }

  if (!graph.nodes.some(node => node.grounded || node.name === "0")) {
    push(diagnostics, "ERC_NO_GROUND", "schematic has no ground reference node", { field: "schematic" });
  }

  for (const component of project.schematic.components) {
    if (component.kind !== "voltageSource") continue;
    const positive = graph.endpointToNode[endpointKey({ componentId: component.id, pin: "p" })];
    const negative = graph.endpointToNode[endpointKey({ componentId: component.id, pin: "n" })];
    const dc = component.params.dcV;
    const driven = dc === undefined || dc !== 0 || Boolean(component.params.ac) || Boolean(component.params.transient);
    if (positive && negative && positive === negative && driven) {
      push(diagnostics, "ERC_VOLTAGE_SOURCE_SHORT", "nonzero ideal voltage source terminals share one node", {
        componentId: component.id,
        field: "pins",
      });
    }
  }

  const voltagePairs = new Map<string, Array<{ id: string; dcV: number }>>();
  for (const component of project.schematic.components) {
    if (component.kind !== "voltageSource") continue;
    const positive = graph.endpointToNode[endpointKey({ componentId: component.id, pin: "p" })];
    const negative = graph.endpointToNode[endpointKey({ componentId: component.id, pin: "n" })];
    if (!positive || !negative || positive === negative) continue;
    const pair = [positive, negative].sort().join("\0");
    const list = voltagePairs.get(pair) ?? [];
    list.push({ id: component.id, dcV: component.params.dcV ?? 0 });
    voltagePairs.set(pair, list);
  }
  for (const sources of voltagePairs.values()) {
    if (sources.length < 2) continue;
    const first = sources[0]!;
    if (sources.some(item => item.dcV !== first.dcV)) {
      push(diagnostics, "ERC_VOLTAGE_SOURCE_CONFLICT", "ideal voltage sources impose different voltages on the same nodes", {
        componentId: first.id,
        field: "dcV",
      });
    }
  }

  for (const analysis of project.analyses) {
    if (analysis.enabledProbes.length === 0) {
      push(diagnostics, "ERC_EMPTY_ANALYSIS_PROBES", "analysis has no enabled probes", { analysisId: analysis.id, field: "enabledProbes" });
    }
    for (const probeId of analysis.enabledProbes) {
      if (!project.probes.some(item => item.id === probeId)) {
        push(diagnostics, "ERC_EMPTY_ANALYSIS_PROBES", "analysis references a missing probe", {
          analysisId: analysis.id,
          probeId,
          field: "enabledProbes",
        });
      }
    }
  }

  return diagnostics;
}
