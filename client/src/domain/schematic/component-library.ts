import { canonicalJson } from "../project/canonical";
import type {
  ComponentInstance,
  ComponentKind,
  DomainResult,
  ModelDefinition,
  WireEndpoint,
} from "../project/project-v2";
import { REFDES_FAMILY_PREFIX } from "../project/project-v2";

export interface ComponentDefinition {
  kind: ComponentKind;
  pins: readonly string[];
  requiredPins: readonly string[];
  refdesPrefix: string;
}

const STATIC_DEFINITIONS: Record<Exclude<ComponentKind, "subcircuit">, ComponentDefinition> = {
  resistor: { kind: "resistor", pins: ["p", "n"], requiredPins: ["p", "n"], refdesPrefix: REFDES_FAMILY_PREFIX.resistor },
  capacitor: { kind: "capacitor", pins: ["p", "n"], requiredPins: ["p", "n"], refdesPrefix: REFDES_FAMILY_PREFIX.capacitor },
  inductor: { kind: "inductor", pins: ["p", "n"], requiredPins: ["p", "n"], refdesPrefix: REFDES_FAMILY_PREFIX.inductor },
  voltageSource: { kind: "voltageSource", pins: ["p", "n"], requiredPins: ["p", "n"], refdesPrefix: REFDES_FAMILY_PREFIX.voltageSource },
  currentSource: { kind: "currentSource", pins: ["p", "n"], requiredPins: ["p", "n"], refdesPrefix: REFDES_FAMILY_PREFIX.currentSource },
  diode: { kind: "diode", pins: ["p", "n"], requiredPins: ["p", "n"], refdesPrefix: REFDES_FAMILY_PREFIX.diode },
  switch: { kind: "switch", pins: ["p", "n", "cp", "cn"], requiredPins: ["p", "n", "cp", "cn"], refdesPrefix: REFDES_FAMILY_PREFIX.switch },
  bjt: { kind: "bjt", pins: ["c", "b", "e"], requiredPins: ["c", "b", "e"], refdesPrefix: REFDES_FAMILY_PREFIX.bjt },
  mosfet: { kind: "mosfet", pins: ["d", "g", "s", "b"], requiredPins: ["d", "g", "s", "b"], refdesPrefix: REFDES_FAMILY_PREFIX.mosfet },
  ground: { kind: "ground", pins: ["p"], requiredPins: ["p"], refdesPrefix: "GND" },
};

function fail(code: string, message: string, componentId?: string): DomainResult<ComponentDefinition> {
  return {
    ok: false,
    diagnostics: [{ severity: "error", code, message, blocksRun: true, location: componentId ? { componentId } : undefined }],
  };
}

export function getStaticComponentDefinition(kind: Exclude<ComponentKind, "subcircuit">): ComponentDefinition {
  return STATIC_DEFINITIONS[kind];
}

export function resolveComponentDefinition(
  component: ComponentInstance,
  models: ModelDefinition[]
): DomainResult<ComponentDefinition> {
  if (component.kind !== "subcircuit") {
    return { ok: true, value: getStaticComponentDefinition(component.kind), diagnostics: [] };
  }
  const model = models.find(item => item.id === component.modelRef);
  if (!model) return fail("ERC_MISSING_MODEL", "subcircuit modelRef is missing", component.id);
  if (model.kind !== "spice-subckt") return fail("ERC_INCOMPATIBLE_MODEL", "subcircuit requires a spice-subckt model", component.id);
  const matches = model.interfaces.filter(item => item.name.toUpperCase() === component.subcircuitName.toUpperCase());
  if (matches.length === 0) return fail("ERC_INCOMPATIBLE_MODEL", "subcircuitName does not match a parsed interface", component.id);
  if (matches.length > 1) return fail("ERC_INCOMPATIBLE_MODEL", "subcircuitName matches more than one interface", component.id);
  const iface = matches[0]!;
  if (
    iface.orderedPins.length !== component.orderedPins.length ||
    iface.orderedPins.some((pin, index) => pin !== component.orderedPins[index])
  ) {
    return fail("ERC_INCOMPATIBLE_MODEL", "orderedPins must equal the selected interface exactly", component.id);
  }
  return {
    ok: true,
    value: {
      kind: "subcircuit",
      pins: component.orderedPins,
      requiredPins: component.orderedPins,
      refdesPrefix: REFDES_FAMILY_PREFIX.subcircuit,
    },
    diagnostics: [],
  };
}

export function endpointKey(endpoint: WireEndpoint): string {
  return canonicalJson([endpoint.componentId, endpoint.pin]);
}

export function createNullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
