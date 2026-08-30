import qualifiedVectors from "../../../vendor/ngspice/QUALIFIED_VECTORS.json";
import { canonicalJson, hashCanonical, sha256Hex } from "../domain/project/canonical";
import type {
  AnalysisDefinition,
  CircuitProjectV2,
  ComponentInstance,
  CornerDefinition,
  CornerOverride,
  Diagnostic,
  DomainResult,
  ModelDefinition,
  ResultProjection,
} from "../domain/project/project-v2";
import { REFDES_FAMILY_PREFIX } from "../domain/project/project-v2";
import { parseCircuitProjectV2 } from "../domain/project/project-schema";
import { createNullRecord, endpointKey, resolveComponentDefinition } from "../domain/schematic/component-library";
import { runErc } from "../domain/schematic/diagnostics";
import { buildSchematicGraph, type SchematicGraph } from "../domain/schematic/graph";
import type { CompileRequest, CompileResult, CompiledModelFile, CompiledVectorRequest, NetlistSourceMap } from "./contracts";
import { parseAndValidateSpiceSource } from "./spice-source-parser";
import { parseQualifiedVectorManifest, resolveQualifiedVector } from "./qualified-vectors.mjs";

const TITLE = "FLUXLAB GENERATED NETLIST";
const PROJECTION_ORDER: ResultProjection[] = ["scalar", "real", "imaginary", "magnitude", "phase", "db20"];
const REFDES_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const TOKEN_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const NET_LABEL_RE = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;

function fail<T>(diagnostics: Diagnostic[]): DomainResult<T> {
  return { ok: false, diagnostics };
}

function blocker(code: string, message: string, location?: Diagnostic["location"]): Diagnostic {
  return { severity: "error", code, message, blocksRun: true, location };
}

function spiceNumber(value: number) {
  if (Object.is(value, -0) || value === 0) return "0";
  return String(value);
}

export async function hashAnalysisDefinition(analysis: AnalysisDefinition): Promise<string> {
  if (new Set(analysis.enabledProbes).size !== analysis.enabledProbes.length) {
    throw new Error("duplicate enabledProbes");
  }
  return hashCanonical({ ...analysis, enabledProbes: [...analysis.enabledProbes].sort() });
}

function familyLetter(kind: ComponentInstance["kind"]) {
  if (kind === "ground") return "0";
  return REFDES_FAMILY_PREFIX[kind];
}

function modelSymbols(model: ModelDefinition): string[] {
  if (model.kind === "spice-model") return [model.modelName];
  return model.interfaces.map(item => item.name);
}

function applyOverride(component: ComponentInstance, override: CornerOverride): Diagnostic | null {
  if (override.kind === "component-model") {
    if (!("modelRef" in component)) return blocker("CORNER_BAD_TARGET", "component cannot take a model override", { componentId: component.id });
    component.modelRef = override.modelRef;
    return null;
  }
  if (override.path.startsWith("parameterOverrides.")) {
    if (component.kind !== "subcircuit") return blocker("CORNER_BAD_PATH", "parameterOverrides only apply to subcircuits", { componentId: component.id, field: override.path });
    const name = override.path.slice("parameterOverrides.".length);
    if (!Object.hasOwn(component.params.parameterOverrides, name) && !Number.isFinite(component.params.parameterOverrides[name])) {
      component.params.parameterOverrides[name] = override.value;
    } else {
      component.params.parameterOverrides[name] = override.value;
    }
    return null;
  }
  if (component.kind === "ground" || !("params" in component)) {
    return blocker("CORNER_BAD_PATH", "corner path is not valid for this component", { componentId: component.id, field: override.path });
  }
  const params = component.params as Record<string, unknown>;
  if (!Object.hasOwn(params, override.path) && override.path !== "dcV" && override.path !== "dcA") {
    if (!(override.path in params)) {
      return blocker("CORNER_BAD_PATH", "corner path is not valid for this component", { componentId: component.id, field: override.path });
    }
  }
  params[override.path] = override.value;
  return null;
}

export async function applyCorner(
  project: CircuitProjectV2,
  definition: CornerDefinition,
  ordinal: number,
  total: number
): Promise<DomainResult<{ project: CircuitProjectV2; appliedCorner: import("../domain/project/project-v2").AppliedCorner }>> {
  if (!Number.isSafeInteger(ordinal) || !Number.isSafeInteger(total) || ordinal < 1 || total < 1 || ordinal > total) {
    return fail([blocker("CORNER_BAD_ORDINAL", "corner ordinal/total must be positive safe integers")]);
  }
  const next = structuredClone(project);
  const seen = new Set<string>();
  const applied: unknown[] = [];
  for (const override of definition.overrides) {
    const key = override.kind === "component-model" ? `${override.componentId}::model` : `${override.componentId}::${override.path}`;
    if (seen.has(key)) return fail([blocker("CORNER_DUPLICATE_TARGET", "corner override target is duplicated", { componentId: override.componentId })]);
    seen.add(key);
    const component = next.schematic.components.find(item => item.id === override.componentId);
    if (!component) return fail([blocker("CORNER_BAD_TARGET", "corner target component is missing", { componentId: override.componentId })]);
    if (!Number.isFinite(override.kind === "component-parameter" ? override.value : 1)) {
      return fail([blocker("CORNER_NON_FINITE", "corner value must be finite", { componentId: override.componentId })]);
    }
    const error = applyOverride(component, override);
    if (error) return fail([error]);
    applied.push(override);
  }
  const parsed = parseCircuitProjectV2(next);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: {
      project: parsed.value,
      appliedCorner: {
        cornerId: definition.id,
        name: definition.name,
        definitionHash: await hashCanonical(definition),
        appliedOverridesHash: await hashCanonical(applied),
        ordinal,
        total,
      },
    },
    diagnostics: [],
  };
}

function emitSourceExtras(component: ComponentInstance): string[] {
  const parts: string[] = [];
  if (component.kind === "voltageSource") {
    if (component.params.dcV !== undefined) parts.push(`DC ${spiceNumber(component.params.dcV)}`);
    if (component.params.ac) {
      parts.push(`AC ${spiceNumber(component.params.ac.magnitudeV)} ${spiceNumber(component.params.ac.phaseDeg)}`);
    }
    if (component.params.transient) parts.push(emitVoltageTransient(component.params.transient));
  }
  if (component.kind === "currentSource") {
    if (component.params.dcA !== undefined) parts.push(`DC ${spiceNumber(component.params.dcA)}`);
    if (component.params.ac) {
      parts.push(`AC ${spiceNumber(component.params.ac.magnitudeA)} ${spiceNumber(component.params.ac.phaseDeg)}`);
    }
    if (component.params.transient) parts.push(emitCurrentTransient(component.params.transient));
  }
  return parts;
}

function emitVoltageTransient(transient: NonNullable<Extract<ComponentInstance, { kind: "voltageSource" }>["params"]["transient"]>): string {
  if (transient.kind === "pulse") {
    return `PULSE(${spiceNumber(transient.initialV)} ${spiceNumber(transient.pulsedV)} ${spiceNumber(transient.delayS)} ${spiceNumber(transient.riseS)} ${spiceNumber(transient.fallS)} ${spiceNumber(transient.widthS)} ${spiceNumber(transient.periodS)})`;
  }
  if (transient.kind === "sin") {
    return `SIN(${spiceNumber(transient.offsetV)} ${spiceNumber(transient.amplitudeV)} ${spiceNumber(transient.frequencyHz)} ${spiceNumber(transient.delayS)} ${spiceNumber(transient.dampingPerS)} ${spiceNumber(transient.phaseDeg)})`;
  }
  return `PWL(${transient.points.map(point => `${spiceNumber(point.timeS)} ${spiceNumber(point.valueV)}`).join(" ")})`;
}

function emitCurrentTransient(transient: NonNullable<Extract<ComponentInstance, { kind: "currentSource" }>["params"]["transient"]>): string {
  if (transient.kind === "pulse") {
    return `PULSE(${spiceNumber(transient.initialA)} ${spiceNumber(transient.pulsedA)} ${spiceNumber(transient.delayS)} ${spiceNumber(transient.riseS)} ${spiceNumber(transient.fallS)} ${spiceNumber(transient.widthS)} ${spiceNumber(transient.periodS)})`;
  }
  if (transient.kind === "sin") {
    return `SIN(${spiceNumber(transient.offsetA)} ${spiceNumber(transient.amplitudeA)} ${spiceNumber(transient.frequencyHz)} ${spiceNumber(transient.delayS)} ${spiceNumber(transient.dampingPerS)} ${spiceNumber(transient.phaseDeg)})`;
  }
  return `PWL(${transient.points.map(point => `${spiceNumber(point.timeS)} ${spiceNumber(point.valueA)}`).join(" ")})`;
}

function nodeOf(graph: SchematicGraph, componentId: string, pin: string) {
  return graph.endpointToNode[endpointKey({ componentId, pin })];
}

function emitComponent(component: ComponentInstance, graph: SchematicGraph, models: ModelDefinition[]): string | Diagnostic {
  if (component.kind === "ground") return "";
  const resolved = resolveComponentDefinition(component, models);
  if (!resolved.ok) return resolved.diagnostics[0]!;
  const nodes = resolved.value.pins.map(pin => nodeOf(graph, component.id, pin)).filter((item): item is string => Boolean(item));
  const ref = component.refdes;
  switch (component.kind) {
    case "resistor":
      return `${ref} ${nodes[0]} ${nodes[1]} ${spiceNumber(component.params.resistanceOhm)}`;
    case "capacitor":
      return `${ref} ${nodes[0]} ${nodes[1]} ${spiceNumber(component.params.capacitanceF)}`;
    case "inductor":
      return `${ref} ${nodes[0]} ${nodes[1]} ${spiceNumber(component.params.inductanceH)}`;
    case "voltageSource":
    case "currentSource":
      return [`${ref} ${nodes[0]} ${nodes[1]}`, ...emitSourceExtras(component)].join(" ");
    case "switch":
    case "diode":
    case "bjt":
    case "mosfet": {
      const model = models.find(item => item.id === component.modelRef);
      if (!model || model.kind !== "spice-model") return blocker("ERC_MISSING_MODEL", "device model is missing", { componentId: component.id });
      if (component.kind === "diode") return `${ref} ${nodes.join(" ")} ${model.modelName} AREA=${spiceNumber(component.params.area)}`;
      if (component.kind === "bjt") return `${ref} ${nodes.join(" ")} ${model.modelName} AREA=${spiceNumber(component.params.area)}`;
      if (component.kind === "mosfet") {
        return `${ref} ${nodes.join(" ")} ${model.modelName} L=${spiceNumber(component.params.lengthM)} W=${spiceNumber(component.params.widthM)} M=${spiceNumber(component.params.multiplicity)}`;
      }
      return `${ref} ${nodes.join(" ")} ${model.modelName}`;
    }
    case "subcircuit": {
      const model = models.find(item => item.id === component.modelRef);
      if (!model || model.kind !== "spice-subckt") return blocker("ERC_MISSING_MODEL", "subcircuit model is missing", { componentId: component.id });
      const iface = model.interfaces.find(item => item.name.toUpperCase() === component.subcircuitName.toUpperCase());
      if (!iface) return blocker("ERC_INCOMPATIBLE_MODEL", "subcircuit interface missing", { componentId: component.id });
      const params = iface.parameterNames
        .filter(name => Object.hasOwn(component.params.parameterOverrides, name))
        .map(name => `${name}=${spiceNumber(component.params.parameterOverrides[name]!)}`);
      return [`${ref} ${nodes.join(" ")} ${iface.name}`, ...params].join(" ");
    }
  }
}

function emitAnalysis(analysis: AnalysisDefinition, project: CircuitProjectV2): string | Diagnostic {
  if (analysis.kind === "dc-op") return ".op";
  if (analysis.kind === "transient") {
    const extras = [spiceNumber(analysis.stepS), spiceNumber(analysis.stopS)];
    if (analysis.startS !== undefined) extras.push(spiceNumber(analysis.startS));
    if (analysis.maxStepS !== undefined) extras.push(spiceNumber(analysis.maxStepS));
    return `.tran ${extras.join(" ")}`;
  }
  if (analysis.kind === "ac") {
    const points = analysis.scale === "lin" ? analysis.totalPoints : analysis.pointsPerInterval;
    return `.ac ${analysis.scale} ${spiceNumber(points)} ${spiceNumber(analysis.startHz)} ${spiceNumber(analysis.stopHz)}`;
  }
  const source = project.schematic.components.find(item => item.id === analysis.sweep.sourceComponentId);
  if (!source) return blocker("COMPILE_BAD_SWEEP", "sweep source is missing", { analysisId: analysis.id, componentId: analysis.sweep.sourceComponentId });
  if (analysis.sweep.quantity === "voltage" && source.kind !== "voltageSource") {
    return blocker("COMPILE_BAD_SWEEP", "voltage sweep requires a voltage source", { analysisId: analysis.id });
  }
  if (analysis.sweep.quantity === "current" && source.kind !== "currentSource") {
    return blocker("COMPILE_BAD_SWEEP", "current sweep requires a current source", { analysisId: analysis.id });
  }
  const start = analysis.sweep.quantity === "voltage" ? analysis.sweep.startV : analysis.sweep.startA;
  const stop = analysis.sweep.quantity === "voltage" ? analysis.sweep.stopV : analysis.sweep.stopA;
  const step = analysis.sweep.quantity === "voltage" ? analysis.sweep.stepV : analysis.sweep.stepA;
  return `.dc ${source.refdes} ${spiceNumber(start)} ${spiceNumber(stop)} ${spiceNumber(step)}`;
}

function axisFor(analysis: AnalysisDefinition, project: CircuitProjectV2) {
  if (analysis.kind === "dc-op") return { name: "index", raw: false };
  if (analysis.kind === "transient") return { name: "time", raw: true };
  if (analysis.kind === "ac") return { name: "frequency", raw: true };
  const source = project.schematic.components.find(item => item.id === analysis.sweep.sourceComponentId);
  return { name: source ? source.refdes.toLowerCase() : "sweep", raw: true };
}

function projectionsFor(analysis: AnalysisDefinition, quantity: CompiledVectorRequest["quantity"]): ResultProjection[] {
  if (analysis.kind === "ac" && (quantity === "voltage" || quantity === "current")) {
    return ["real", "imaginary", "magnitude", "phase", "db20"];
  }
  return ["scalar"];
}

function voltageName(node: string): string;
function voltageName(positive: string, negative: string): string;
function voltageName(left: string, right?: string) {
  return right ? `v(${left},${right})` : `v(${left})`;
}

async function buildVectorPlan(
  project: CircuitProjectV2,
  analysis: AnalysisDefinition,
  graph: SchematicGraph
): Promise<DomainResult<CompiledVectorRequest[]>> {
  const manifest = parseQualifiedVectorManifest(qualifiedVectors);
  const plan: CompiledVectorRequest[] = [];
  for (const probeId of analysis.enabledProbes) {
    const probe = project.probes.find(item => item.id === probeId);
    if (!probe) return fail([blocker("ERC_EMPTY_ANALYSIS_PROBES", "enabled probe is missing", { analysisId: analysis.id, probeId })]);
    const axis = axisFor(analysis, project);
    if (probe.kind === "node-voltage") {
      const node = nodeOf(graph, probe.node.componentId, probe.node.pin);
      if (!node) return fail([blocker("PROBE_UNRESOLVED", "node probe is not on the graph", { probeId })]);
      plan.push({
        probeId,
        sourceVectorName: voltageName(node),
        quantity: "voltage",
        projections: projectionsFor(analysis, "voltage"),
        axisName: axis.name,
      });
      continue;
    }
    if (probe.kind === "differential-voltage") {
      const positive = nodeOf(graph, probe.positive.componentId, probe.positive.pin);
      const negative = nodeOf(graph, probe.negative.componentId, probe.negative.pin);
      if (!positive || !negative) return fail([blocker("PROBE_UNRESOLVED", "differential probe is not on the graph", { probeId })]);
      plan.push({
        probeId,
        sourceVectorName: voltageName(positive, negative),
        quantity: "voltage",
        projections: projectionsFor(analysis, "voltage"),
        axisName: axis.name,
      });
      continue;
    }
    const component = project.schematic.components.find(item => item.id === probe.componentId);
    if (!component) return fail([blocker("PROBE_UNRESOLVED", "probe component is missing", { probeId, componentId: probe.componentId })]);
    const family = familyLetter(component.kind);
    if (probe.kind === "device-power") {
      if (analysis.kind === "ac" || family === "X" || family === "Q" || family === "M") {
        return fail([blocker("PROBE_UNSUPPORTED_DEVICE_POWER", "device power is not qualified for this probe", { probeId })]);
      }
      const raw = resolveQualifiedVector(manifest, {
        quantity: "device-power",
        family,
        analysis: analysis.kind,
        refdes: component.refdes,
      });
      if (!raw) return fail([blocker("PROBE_UNSUPPORTED_DEVICE_POWER", "device power is not in the qualified matrix", { probeId })]);
      plan.push({
        probeId,
        sourceVectorName: raw,
        quantity: "power",
        projections: ["scalar"],
        axisName: axis.name,
      });
      continue;
    }
    if (family === "X" || family === "Q" || family === "M") {
      return fail([blocker("PROBE_UNSUPPORTED_BRANCH_CURRENT", "branch current is not qualified for this device", { probeId })]);
    }
    const raw = resolveQualifiedVector(manifest, {
      quantity: "branch-current",
      family,
      analysis: analysis.kind,
      refdes: component.refdes,
    });
    if (!raw) return fail([blocker("PROBE_UNSUPPORTED_BRANCH_CURRENT", "branch current is not in the qualified matrix", { probeId })]);
    plan.push({
      probeId,
      sourceVectorName: raw,
      quantity: "current",
      projections: projectionsFor(analysis, "current"),
      axisName: axis.name,
    });
  }
  plan.sort((left, right) => left.probeId.localeCompare(right.probeId) || left.sourceVectorName.localeCompare(right.sourceVectorName));
  for (const entry of plan) {
    entry.projections = [...entry.projections].sort((left, right) => PROJECTION_ORDER.indexOf(left) - PROJECTION_ORDER.indexOf(right));
  }
  return { ok: true, value: plan, diagnostics: [] };
}

export function requestedRawVectorsFromPlan(plan: CompiledVectorRequest[]) {
  const names = new Set<string>();
  for (const entry of plan) {
    names.add(entry.sourceVectorName);
    if (entry.axisName !== "index") names.add(entry.axisName);
  }
  return [...names].sort();
}

function recheckAscii(project: CircuitProjectV2): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const refdes = new Set<string>();
  for (const component of project.schematic.components) {
    if (component.kind !== "ground" && !REFDES_RE.test(component.refdes)) {
      diagnostics.push(blocker("COMPILE_BAD_REFDES", "refdes failed the compiler ASCII gate", { componentId: component.id, field: "refdes" }));
    }
    if (component.kind !== "ground") {
      const expected = familyLetter(component.kind);
      if (component.refdes[0]?.toUpperCase() !== expected) {
        diagnostics.push(blocker("COMPILE_BAD_REFDES", "refdes family prefix is wrong", { componentId: component.id, field: "refdes" }));
      }
    }
    const key = component.refdes.toUpperCase();
    if (refdes.has(key)) diagnostics.push(blocker("COMPILE_BAD_REFDES", "case-insensitive refdes collision", { componentId: component.id }));
    refdes.add(key);
  }
  for (const wire of project.schematic.wires) {
    if (wire.netLabel && !NET_LABEL_RE.test(wire.netLabel)) {
      diagnostics.push(blocker("COMPILE_BAD_NET_LABEL", "net label failed the compiler ASCII gate", { wireId: wire.id, field: "netLabel" }));
    }
  }
  for (const model of project.models) {
    for (const symbol of modelSymbols(model)) {
      if (!TOKEN_RE.test(symbol)) diagnostics.push(blocker("COMPILE_BAD_SYMBOL", "model symbol failed the ASCII gate", { modelId: model.id }));
    }
  }
  return diagnostics;
}

export async function compileNetlist(request: CompileRequest): Promise<DomainResult<CompileResult>> {
  let project = request.project;
  let appliedCorner: CompileResult["appliedCorner"];
  if (request.corner) {
    const cornered = await applyCorner(project, request.corner.definition, request.corner.ordinal, request.corner.total);
    if (!cornered.ok) return cornered;
    project = cornered.value.project;
    appliedCorner = cornered.value.appliedCorner;
  }
  const parsed = parseCircuitProjectV2(project);
  if (!parsed.ok) return parsed;
  project = parsed.value;
  const ascii = recheckAscii(project);
  if (ascii.length) return fail(ascii);
  const graph = buildSchematicGraph(project);
  if (!graph.ok) return graph;
  const erc = runErc(project, graph.value);
  if (erc.some(item => item.blocksRun)) return fail(erc);
  const referencedIds = new Set(
    project.schematic.components.filter((item): item is ComponentInstance & { modelRef: string } => "modelRef" in item).map(item => item.modelRef)
  );
  const referenced = project.models.filter(item => referencedIds.has(item.id));
  const symbolHash = new Map<string, string>();
  const filesByHash = new Map<string, CompiledModelFile>();
  for (const model of referenced) {
    const parsedModel = await parseAndValidateSpiceSource(model.source, "stored-model", "opaque-model");
    if (!parsedModel.ok) return parsedModel;
    if (parsedModel.value.sha256 !== model.sha256) {
      return fail([blocker("MODEL_HASH_MISMATCH", "referenced model hash drifted", { modelId: model.id })]);
    }
    for (const symbol of modelSymbols(model)) {
      const key = symbol.toUpperCase();
      const previous = symbolHash.get(key);
      if (previous && previous !== model.sha256) {
        return fail([blocker("MODEL_SYMBOL_CONFLICT", "the same model symbol has two hashes", { modelId: model.id })]);
      }
      symbolHash.set(key, model.sha256);
    }
    if (!filesByHash.has(model.sha256)) {
      filesByHash.set(model.sha256, {
        modelId: model.id,
        sha256: model.sha256,
        generatedName: `model-${model.sha256}.lib`,
      });
    }
  }
  const modelManifest = referenced
    .map(model => ({
      modelId: model.id,
      sha256: model.sha256,
      generatedName: filesByHash.get(model.sha256)!.generatedName,
    }))
    .sort((left, right) => left.modelId.localeCompare(right.modelId));

  const analysisLine = emitAnalysis(request.analysis, project);
  if (typeof analysisLine !== "string") return fail([analysisLine]);
  const plan = await buildVectorPlan(project, request.analysis, graph.value);
  if (!plan.ok) return plan;

  const components = [...project.schematic.components]
    .filter(item => item.kind !== "ground")
    .sort((left, right) => left.refdes.toUpperCase().localeCompare(right.refdes.toUpperCase()) || left.id.localeCompare(right.id));

  const lines = [TITLE];
  const uniqueIncludes = [...new Set(modelManifest.map(item => item.generatedName))].sort();
  for (const name of uniqueIncludes) lines.push(`.include "${name}"`);
  const lineToComponent = createNullRecord<string>();
  const componentToLines = createNullRecord<number[]>();
  for (const component of components) {
    const emitted = emitComponent(component, graph.value, project.models);
    if (typeof emitted !== "string") return fail([emitted]);
    if (!emitted) continue;
    lines.push(emitted);
    const line = lines.length;
    lineToComponent[line] = component.id;
    const bucket = Object.hasOwn(componentToLines, component.id) ? componentToLines[component.id]! : [];
    bucket.push(line);
    componentToLines[component.id] = bucket;
  }
  const rawVectors = requestedRawVectorsFromPlan(plan.value);
  if (rawVectors.length) lines.push(`.save ${rawVectors.join(" ")}`);
  lines.push(analysisLine);
  lines.push(".end");
  const netlist = `${lines.join("\n")}\n`;
  const sourceMap: NetlistSourceMap = {
    lineToComponent,
    componentToLines,
    endpointToNode: graph.value.endpointToNode,
    nodeToEndpoints: graph.value.nodeToEndpoints,
  };
  const result: CompileResult = {
    netlist,
    netlistHash: await sha256Hex(netlist),
    diagnostics: erc.filter(item => !item.blocksRun),
    sourceMap,
    modelManifest,
    vectorPlan: plan.value,
    vectorPlanHash: await sha256Hex(canonicalJson(plan.value)),
    requestedRawVectors: rawVectors,
    appliedCorner,
  };
  return { ok: true, value: result, diagnostics: result.diagnostics };
}
