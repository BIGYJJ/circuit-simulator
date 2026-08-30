import { canonicalJson, sha256Hex } from "../domain/project/canonical";
import { migrateV1CircuitDocument } from "../domain/project/migrate-v1";
import type {
  AnalysisDefinition,
  CircuitProjectV2,
  ComponentInstance,
  Diagnostic,
  DomainResult,
  ModelDefinition,
  VoltageTransientWaveform,
} from "../domain/project/project-v2";
import { parseCircuitProjectV2 } from "../domain/project/project-schema";
import { buildSchematicGraph } from "../domain/schematic/graph";
import { endpointKey, resolveComponentDefinition } from "../domain/schematic/component-library";
import type { SuccessfulRunRecord, TerminalRunRecord } from "../simulation/contracts";
import { parseRunRecord } from "../simulation/run-record-schema";
import {
  parseAndValidateSpiceSource,
  type ParsedIndependentSource,
  type ParsedSpiceElement,
  type ParsedSpiceSource,
  type ParsedSpiceStatement,
  validateProjectModels,
} from "../simulation/spice-source-parser";
import { bundledManifestForValidation } from "../domain/project/bundled-models";

export const FLUXPROJ_MAX_BYTES = 15 * 1024 * 1024;
export const FLUXRUN_MAX_BYTES = 134_217_728;
const NET_LABEL_RE = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;

export type FluxRunVectorMode = "full" | "omitted";

export interface ProjectImportPreview {
  kind: "project";
  format: "fluxproj" | "cir" | "v1";
  project: CircuitProjectV2;
  title: string;
  counts: { components: number; wires: number; models: number; analyses: number; probes: number };
  models: Array<{ id: string; sha256: string }>;
  analyses: Array<{ id: string; kind: string }>;
  warnings: Diagnostic[];
  discardedEvidence: boolean;
  blockers: Diagnostic[];
  nodeMap: Array<{ raw: string; label: string }>;
}

export type RunImportPreview =
  | { kind: "full"; record: TerminalRunRecord }
  | { kind: "reference-only"; runId: string; projectId: string; status: string };

function fail<T>(code: string, message: string, location?: Diagnostic["location"]): DomainResult<T> {
  return { ok: false, diagnostics: [{ severity: "error", code, message, blocksRun: true, location }] };
}

function utf8Bytes(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

function previewOf(project: CircuitProjectV2, format: ProjectImportPreview["format"], warnings: Diagnostic[] = [], nodeMap: ProjectImportPreview["nodeMap"] = []): ProjectImportPreview {
  const blockers = warnings.filter(item => item.blocksRun);
  return {
    kind: "project",
    format,
    project,
    title: project.title,
    counts: {
      components: project.schematic.components.length,
      wires: project.schematic.wires.length,
      models: project.models.length,
      analyses: project.analyses.length,
      probes: project.probes.length,
    },
    models: project.models.map(item => ({ id: item.id, sha256: item.sha256 })),
    analyses: project.analyses.map(item => ({ id: item.id, kind: item.kind })),
    warnings,
    discardedEvidence: format === "v1",
    blockers,
    nodeMap,
  };
}

export async function encodeImportedSpiceNode(rawNode: string): Promise<DomainResult<string | null>> {
  if (rawNode === "0") return { ok: true, value: null, diagnostics: [] };
  const upper = rawNode.toUpperCase();
  if (NET_LABEL_RE.test(upper) && upper !== "GND" && !upper.startsWith("SPICE_")) {
    return { ok: true, value: upper, diagnostics: [] };
  }
  return { ok: true, value: `SPICE_${await sha256Hex(upper)}`, diagnostics: [] };
}

export async function serializeFluxProject(project: CircuitProjectV2): Promise<DomainResult<string>> {
  const parsed = parseCircuitProjectV2(project);
  if (!parsed.ok) return parsed;
  const models = await validateProjectModels(parsed.value, "stored-model", await bundledManifestForValidation());
  if (!models.ok) return models;
  const text = `${canonicalJson({ format: "fluxproj", formatVersion: 1, project: models.value })}\n`;
  if (utf8Bytes(text) > FLUXPROJ_MAX_BYTES) return fail("FILE_TOO_LARGE", "fluxproj exceeds 15 MiB");
  return { ok: true, value: text, diagnostics: [] };
}

export async function parseFluxProject(text: string): Promise<DomainResult<ProjectImportPreview>> {
  if (utf8Bytes(text) > FLUXPROJ_MAX_BYTES) return fail("FILE_TOO_LARGE", "fluxproj exceeds 15 MiB");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("FILE_MALFORMED", "fluxproj is not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("FILE_MALFORMED", "fluxproj is not an object");
  const envelope = parsed as { format?: unknown; formatVersion?: unknown; project?: unknown };
  if (envelope.format !== "fluxproj" || envelope.formatVersion !== 1) return fail("FILE_UNKNOWN_FORMAT", "fluxproj format is not version 1");
  const project = parseCircuitProjectV2(envelope.project);
  if (!project.ok) return project;
  const models = await validateProjectModels(project.value, "project-model", await bundledManifestForValidation());
  if (!models.ok) return models;
  return { ok: true, value: previewOf(models.value, "fluxproj"), diagnostics: models.diagnostics };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function encodeF64(values: Float64Array) {
  return { encoding: "f64-le-base64" as const, length: values.length, data: bytesToBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)) };
}

function decodeF64(input: unknown): DomainResult<Float64Array> {
  if (!input || typeof input !== "object") return fail("FILE_BAD_VECTOR", "vector encoding is missing");
  const row = input as { encoding?: unknown; length?: unknown; data?: unknown };
  if (row.encoding !== "f64-le-base64" || typeof row.length !== "number" || !Number.isSafeInteger(row.length) || row.length < 0) {
    return fail("FILE_BAD_VECTOR", "vector encoding fields are invalid");
  }
  if (typeof row.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.data)) return fail("FILE_BAD_VECTOR", "vector base64 is malformed");
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(atob(row.data), char => char.charCodeAt(0));
  } catch {
    return fail("FILE_BAD_VECTOR", "vector base64 cannot be decoded");
  }
  if (decoded.byteLength !== row.length * 8) return fail("FILE_BAD_VECTOR", "decoded vector byte length is not length*8");
  return { ok: true, value: new Float64Array(decoded.buffer, decoded.byteOffset, row.length), diagnostics: [] };
}

function reviveRun(raw: unknown): DomainResult<unknown> {
  if (!raw || typeof raw !== "object") return fail("FILE_MALFORMED", "run payload is not an object");
  const record = structuredClone(raw) as Record<string, unknown>;
  const snapshot = record.snapshot as { axes?: unknown[]; vectors?: unknown[] } | undefined;
  if (snapshot) {
    if (Array.isArray(snapshot.axes)) {
      for (const axis of snapshot.axes) {
        if (axis && typeof axis === "object" && "values" in axis) {
          const decoded = decodeF64((axis as { values: unknown }).values);
          if (!decoded.ok) return decoded;
          (axis as { values: Float64Array }).values = decoded.value;
        }
      }
    }
    if (Array.isArray(snapshot.vectors)) {
      for (const vector of snapshot.vectors) {
        if (vector && typeof vector === "object" && "values" in vector) {
          const decoded = decodeF64((vector as { values: unknown }).values);
          if (!decoded.ok) return decoded;
          (vector as { values: Float64Array }).values = decoded.value;
        }
      }
    }
  }
  return { ok: true, value: record, diagnostics: [] };
}

function encodeRun(run: TerminalRunRecord) {
  const copy = structuredClone(run) as TerminalRunRecord;
  if (copy.status === "success") {
    copy.snapshot = {
      ...copy.snapshot,
      axes: copy.snapshot.axes.map(axis => ({ ...axis, values: encodeF64(axis.values) as unknown as Float64Array })),
      vectors: copy.snapshot.vectors.map(vector => ({ ...vector, values: encodeF64(vector.values) as unknown as Float64Array })),
    };
  }
  return copy;
}

export async function serializeFluxRun(run: TerminalRunRecord | { status: "running" }, vectorMode: FluxRunVectorMode): Promise<DomainResult<string>> {
  if (vectorMode !== "full" && vectorMode !== "omitted") return fail("FILE_UNKNOWN_VECTOR_MODE", "vectorMode must be full or omitted");
  if (!run || typeof run !== "object" || run.status === "running") return fail("RUN_EXPORT_NOT_TERMINAL", "running records cannot be exported");
  if (vectorMode === "omitted") {
    const text = `${canonicalJson({
      format: "fluxrun",
      formatVersion: 1,
      vectorMode: "omitted",
      kind: "reference-only",
      runId: run.runId,
      projectId: run.projectId,
      status: run.status,
    })}\n`;
    if (utf8Bytes(text) > FLUXRUN_MAX_BYTES) return fail("FILE_TOO_LARGE", "fluxrun exceeds 128 MiB");
    return { ok: true, value: text, diagnostics: [] };
  }
  const parsed = await parseRunRecord(run);
  if (!parsed.ok) return parsed;
  const text = `${JSON.stringify({ format: "fluxrun", formatVersion: 1, vectorMode: "full", run: encodeRun(parsed.value as TerminalRunRecord) })}\n`;
  if (utf8Bytes(text) > FLUXRUN_MAX_BYTES) return fail("FILE_TOO_LARGE", "fluxrun exceeds 128 MiB");
  return { ok: true, value: text, diagnostics: [] };
}

export async function parseFluxRun(text: string): Promise<DomainResult<RunImportPreview>> {
  if (utf8Bytes(text) > FLUXRUN_MAX_BYTES) return fail("FILE_TOO_LARGE", "fluxrun exceeds 128 MiB");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("FILE_MALFORMED", "fluxrun is not JSON");
  }
  if (!parsed || typeof parsed !== "object") return fail("FILE_MALFORMED", "fluxrun is not an object");
  const envelope = parsed as { format?: unknown; formatVersion?: unknown; vectorMode?: unknown; kind?: unknown; run?: unknown; runId?: unknown; projectId?: unknown; status?: unknown };
  if (envelope.format !== "fluxrun" || envelope.formatVersion !== 1) return fail("FILE_UNKNOWN_FORMAT", "fluxrun format is not version 1");
  if (envelope.vectorMode !== "full" && envelope.vectorMode !== "omitted") return fail("FILE_UNKNOWN_VECTOR_MODE", "vectorMode must be full or omitted");
  if (envelope.vectorMode === "omitted") {
    if (envelope.kind !== "reference-only" || typeof envelope.runId !== "string" || typeof envelope.projectId !== "string") {
      return fail("FILE_MALFORMED", "omitted fluxrun is not a reference-only envelope");
    }
    return {
      ok: true,
      value: { kind: "reference-only", runId: envelope.runId, projectId: envelope.projectId, status: String(envelope.status ?? "unknown") },
      diagnostics: [],
    };
  }
  const revived = reviveRun(envelope.run);
  if (!revived.ok) return revived;
  const record = revived.value as { status?: unknown };
  if (record.status === "running") return fail("RUN_IMPORT_NOT_TERMINAL", "running records cannot be imported");
  const parsedRun = await parseRunRecord(revived.value);
  if (!parsedRun.ok) return parsedRun;
  if (parsedRun.value.status === "running") return fail("RUN_IMPORT_NOT_TERMINAL", "running records cannot be imported");
  return { ok: true, value: { kind: "full", record: parsedRun.value }, diagnostics: [] };
}

function finite(value: { kind: string; valueSI?: number } | undefined, fallback: number) {
  return value && value.kind === "finite-number" && value.valueSI !== undefined ? value.valueSI : fallback;
}

function sourceParams(device: "V" | "I", source: ParsedIndependentSource) {
  const hasWave = Boolean(source.transient);
  const explicitDc = source.dc !== undefined;
  if (device === "V") {
    const params: Extract<ComponentInstance, { kind: "voltageSource" }>["params"] = {};
    if (explicitDc || !hasWave) params.dcV = source.dc ?? 0;
    if (source.ac) params.ac = { magnitudeV: source.ac.magnitude, phaseDeg: source.ac.phaseDeg };
    if (source.transient?.kind === "pulse") {
      params.transient = {
        kind: "pulse",
        initialV: source.transient.initial,
        pulsedV: source.transient.pulsed,
        delayS: source.transient.delayS,
        riseS: source.transient.riseS,
        fallS: source.transient.fallS,
        widthS: source.transient.widthS,
        periodS: source.transient.periodS,
      };
    }
    if (source.transient?.kind === "sin") {
      params.transient = {
        kind: "sin",
        offsetV: source.transient.offset,
        amplitudeV: source.transient.amplitude,
        frequencyHz: source.transient.frequencyHz,
        delayS: source.transient.delayS,
        dampingPerS: source.transient.dampingPerS,
        phaseDeg: source.transient.phaseDeg,
      };
    }
    if (source.transient?.kind === "pwl") {
      params.transient = { kind: "pwl", points: source.transient.points.map(point => ({ timeS: point.timeS, valueV: point.value })) };
    }
    return params;
  }
  const params: Extract<ComponentInstance, { kind: "currentSource" }>["params"] = {};
  if (explicitDc || !hasWave) params.dcA = source.dc ?? 0;
  if (source.ac) params.ac = { magnitudeA: source.ac.magnitude, phaseDeg: source.ac.phaseDeg };
  if (source.transient?.kind === "pulse") {
    params.transient = {
      kind: "pulse",
      initialA: source.transient.initial,
      pulsedA: source.transient.pulsed,
      delayS: source.transient.delayS,
      riseS: source.transient.riseS,
      fallS: source.transient.fallS,
      widthS: source.transient.widthS,
      periodS: source.transient.periodS,
    };
  }
  return params;
}

interface MappedEndpoint {
  componentId: string;
  pin: string;
  raw: string;
  line: number;
}

export async function parseCirProject(
  text: string,
  metadata: { projectId: string; createdAt: string }
): Promise<DomainResult<ProjectImportPreview>> {
  if (utf8Bytes(text) > FLUXPROJ_MAX_BYTES) return fail("FILE_TOO_LARGE", "cir exceeds 15 MiB");
  const parsed = await parseAndValidateSpiceSource(text, "user-cir", "editable-circuit");
  if (!parsed.ok) return parsed;
  const mapped = await mapCirAst(parsed.value, metadata);
  if (!mapped.ok) return mapped;
  return { ok: true, value: mapped.value, diagnostics: [...parsed.diagnostics, ...mapped.diagnostics] };
}

async function mapCirAst(source: ParsedSpiceSource, metadata: { projectId: string; createdAt: string }): Promise<DomainResult<ProjectImportPreview>> {
  const warnings: Diagnostic[] = [];
  const models: ModelDefinition[] = [];
  for (const block of source.declarationBlocks) {
    if (block.kind === "subcircuit" && (block.externalModelNames.length || block.externalSubcircuitNames.length)) {
      return fail("CIR_SUBCKT_EXTERNAL_REFERENCE", "subcircuit references an external model or subcircuit", {
        line: block.startLine,
        endLine: block.endLine,
      });
    }
    const sha256 = await sha256Hex(block.normalizedSource);
    if (block.kind === "model") {
      models.push({
        id: block.name.toLowerCase(),
        displayName: block.name,
        source: block.normalizedSource,
        sha256,
        origin: "user-import",
        kind: "spice-model",
        modelName: block.name,
        deviceFamily: block.family,
      });
    } else {
      models.push({
        id: block.interface.name.toLowerCase(),
        displayName: block.interface.name,
        source: block.normalizedSource,
        sha256,
        origin: "user-import",
        kind: "spice-subckt",
        interfaces: [block.interface],
      });
    }
  }

  const components: ComponentInstance[] = [];
  const endpoints: MappedEndpoint[] = [];
  const top = source.statements.filter(item => item.scope.kind === "top-level" && item.kind === "element") as ParsedSpiceElement[];
  for (const element of top) {
    const built = elementToComponent(element, models);
    if (!built.ok) return built;
    components.push(built.value.component);
    endpoints.push(...built.value.endpoints);
  }

  const nodeMap = new Map<string, string>();
  const usedLabels = new Set<string>();
  for (const endpoint of endpoints) {
    const encoded = await encodeImportedSpiceNode(endpoint.raw);
    if (!encoded.ok) return encoded;
    const label = encoded.value === null ? "0" : encoded.value;
    const previous = nodeMap.get(endpoint.raw);
    if (previous && previous !== label) return fail("CIR_NODE_COLLISION", "raw node mapped to conflicting labels");
    if (!previous && label !== "0" && usedLabels.has(label) && ![...nodeMap.values()].includes(label)) {
      return fail("CIR_NODE_COLLISION", "canonical node label collided");
    }
    nodeMap.set(endpoint.raw, label);
    if (label !== "0") usedLabels.add(label);
  }

  const byLabel = new Map<string, MappedEndpoint[]>();
  for (const endpoint of endpoints) {
    const label = nodeMap.get(endpoint.raw)!;
    const list = byLabel.get(label) ?? [];
    list.push(endpoint);
    byLabel.set(label, list);
  }
  if ([...byLabel.keys()].includes("0") || endpoints.some(item => item.raw === "0")) {
    if (!components.some(item => item.kind === "ground")) {
      components.push({ id: "GND", refdes: "GND", kind: "ground", params: {} });
    }
  }
  const wires: CircuitProjectV2["schematic"]["wires"] = [];
  let wireIndex = 1;
  for (const [label, group] of [...byLabel.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const unique = [...group].sort((left, right) => `${left.componentId}:${left.pin}`.localeCompare(`${right.componentId}:${right.pin}`));
    if (label !== "0" && unique.length < 2) {
      return fail("CIR_SINGLETON_NODE_UNREPRESENTABLE", `node ${label} has only one endpoint`, {
        line: unique[0]?.line,
        endLine: unique[0]?.line,
      });
    }
    const chain = label === "0"
      ? [{ componentId: "GND", pin: "p", raw: "0", line: unique[0]?.line ?? 1 }, ...unique]
      : unique;
    for (let index = 1; index < chain.length; index += 1) {
      const from = chain[index - 1]!;
      const to = chain[index]!;
      wires.push({
        id: `w${wireIndex}`,
        from: { componentId: from.componentId, pin: from.pin },
        to: { componentId: to.componentId, pin: to.pin },
        ...(label !== "0" && index === 1 ? { netLabel: label } : {}),
      });
      wireIndex += 1;
    }
  }

  const analysisStatements = source.statements.filter(item => item.scope.kind === "top-level" && item.kind === "analysis") as Array<
    ParsedSpiceStatement & { kind: "analysis" }
  >;
  const analyses: AnalysisDefinition[] = [];
  for (const [ordinal, statement] of analysisStatements.entries()) {
    const mapped = await mapAnalysis(statement, ordinal, components);
    if (!mapped.ok) return mapped;
    analyses.push(mapped.value);
  }
  if (analyses.length === 0) {
    warnings.push({ severity: "warning", code: "CIR_NO_ANALYSIS", message: "0 analyses; add one before Run", blocksRun: true });
  }
  warnings.push({ severity: "info", code: "CIR_NO_PROBES", message: "0 probes", blocksRun: false });

  const layout = {
    components: Object.fromEntries(components.map((component, index) => [component.id, { x: 160 + (index % 6) * 90, y: 180 + Math.floor(index / 6) * 90, rotation: 0 as const }])),
    wireRoutes: {},
  };
  const project: CircuitProjectV2 = {
    schemaVersion: 2,
    id: metadata.projectId,
    title: "Imported CIR",
    createdAt: metadata.createdAt,
    updatedAt: metadata.createdAt,
    revision: 1,
    electricalRevision: 1,
    schematic: { components, wires },
    layout,
    models,
    analyses,
    probes: [],
    assertions: [],
    corners: [],
    notes: [],
  };
  const schema = parseCircuitProjectV2(project);
  if (!schema.ok) return schema;
  const validated = await validateProjectModels(schema.value, "user-cir", await bundledManifestForValidation());
  if (!validated.ok) return validated;
  return {
    ok: true,
    value: previewOf(
      validated.value,
      "cir",
      warnings,
      [...nodeMap.entries()].map(([raw, label]) => ({ raw, label }))
    ),
    diagnostics: warnings,
  };
}

function elementToComponent(
  element: ParsedSpiceElement,
  models: ModelDefinition[]
): DomainResult<{ component: ComponentInstance; endpoints: MappedEndpoint[] }> {
  const line = element.startLine;
  if (element.device === "R" || element.device === "C" || element.device === "L") {
    if (element.value.kind !== "finite-number") return fail("CIR_BAD_VALUE", "passive value must be numeric", { line });
    const kind = element.device === "R" ? "resistor" : element.device === "C" ? "capacitor" : "inductor";
    const params =
      kind === "resistor"
        ? { resistanceOhm: element.value.valueSI }
        : kind === "capacitor"
          ? { capacitanceF: element.value.valueSI }
          : { inductanceH: element.value.valueSI };
    return {
      ok: true,
      value: {
        component: { id: element.name, refdes: element.name, kind, params } as ComponentInstance,
        endpoints: [
          { componentId: element.name, pin: "p", raw: element.positiveNode, line },
          { componentId: element.name, pin: "n", raw: element.negativeNode, line },
        ],
      },
      diagnostics: [],
    };
  }
  if (element.device === "V" || element.device === "I") {
    const kind = element.device === "V" ? "voltageSource" : "currentSource";
    return {
      ok: true,
      value: {
        component: { id: element.name, refdes: element.name, kind, params: sourceParams(element.device, element.source) } as ComponentInstance,
        endpoints: [
          { componentId: element.name, pin: "p", raw: element.positiveNode, line },
          { componentId: element.name, pin: "n", raw: element.negativeNode, line },
        ],
      },
      diagnostics: [],
    };
  }
  if (element.device === "D") {
    const model = models.find(item => item.kind === "spice-model" && item.modelName.toUpperCase() === element.modelName.toUpperCase());
    if (!model) return fail("CIR_UNKNOWN_MODEL", "diode model is missing", { line });
    return {
      ok: true,
      value: {
        component: {
          id: element.name,
          refdes: element.name,
          kind: "diode",
          params: { area: finite(element.area, 1) },
          modelRef: model.id,
        },
        endpoints: [
          { componentId: element.name, pin: "p", raw: element.anodeNode, line },
          { componentId: element.name, pin: "n", raw: element.cathodeNode, line },
        ],
      },
      diagnostics: [],
    };
  }
  if (element.device === "Q") {
    if (element.substrateNode) return fail("CIR_BJT_SUBSTRATE_UNSUPPORTED", "v1 BJT domain has only c/b/e", { line });
    const model = models.find(item => item.kind === "spice-model" && item.modelName.toUpperCase() === element.modelName.toUpperCase());
    if (!model) return fail("CIR_UNKNOWN_MODEL", "bjt model is missing", { line });
    return {
      ok: true,
      value: {
        component: {
          id: element.name,
          refdes: element.name,
          kind: "bjt",
          params: { area: finite(element.area, 1) },
          modelRef: model.id,
        },
        endpoints: [
          { componentId: element.name, pin: "c", raw: element.collectorNode, line },
          { componentId: element.name, pin: "b", raw: element.baseNode, line },
          { componentId: element.name, pin: "e", raw: element.emitterNode, line },
        ],
      },
      diagnostics: [],
    };
  }
  if (element.device === "M") {
    if (!element.length || element.length.kind !== "finite-number" || element.length.valueSI <= 0) {
      return fail("CIR_BAD_MOSFET", "MOSFET L must be explicit and positive", { line });
    }
    if (!element.width || element.width.kind !== "finite-number" || element.width.valueSI <= 0) {
      return fail("CIR_BAD_MOSFET", "MOSFET W must be explicit and positive", { line });
    }
    const model = models.find(item => item.kind === "spice-model" && item.modelName.toUpperCase() === element.modelName.toUpperCase());
    if (!model) return fail("CIR_UNKNOWN_MODEL", "mosfet model is missing", { line });
    return {
      ok: true,
      value: {
        component: {
          id: element.name,
          refdes: element.name,
          kind: "mosfet",
          params: { lengthM: element.length.valueSI, widthM: element.width.valueSI, multiplicity: finite(element.multiplicity, 1) },
          modelRef: model.id,
        },
        endpoints: [
          { componentId: element.name, pin: "d", raw: element.drainNode, line },
          { componentId: element.name, pin: "g", raw: element.gateNode, line },
          { componentId: element.name, pin: "s", raw: element.sourceNode, line },
          { componentId: element.name, pin: "b", raw: element.bulkNode, line },
        ],
      },
      diagnostics: [],
    };
  }
  if (element.device === "S") {
    const model = models.find(item => item.kind === "spice-model" && item.modelName.toUpperCase() === element.modelName.toUpperCase());
    if (!model) return fail("CIR_UNKNOWN_MODEL", "switch model is missing", { line });
    return {
      ok: true,
      value: {
        component: { id: element.name, refdes: element.name, kind: "switch", params: {}, modelRef: model.id },
        endpoints: [
          { componentId: element.name, pin: "p", raw: element.positiveNode, line },
          { componentId: element.name, pin: "n", raw: element.negativeNode, line },
          { componentId: element.name, pin: "cp", raw: element.controlPositiveNode, line },
          { componentId: element.name, pin: "cn", raw: element.controlNegativeNode, line },
        ],
      },
      diagnostics: [],
    };
  }
  if (element.device !== "X") return fail("CIR_UNSUPPORTED_ELEMENT", "element is not mapped");
  const model = models.find(item => item.kind === "spice-subckt" && item.interfaces.some(iface => iface.name.toUpperCase() === element.subcircuitName.toUpperCase()));
  if (!model || model.kind !== "spice-subckt") return fail("CIR_UNKNOWN_SUBCKT", "subcircuit instance has no matching block", { line: element.startLine });
  const iface = model.interfaces[0]!;
  const overrides = Object.fromEntries(
    element.orderedOverrides
      .filter((item): item is typeof item & { value: Extract<typeof item.value, { kind: "finite-number" }> } => item.value.kind === "finite-number")
      .map(item => [item.name, item.value.valueSI])
  );
  return {
    ok: true,
    value: {
      component: {
        id: element.name,
        refdes: element.name,
        kind: "subcircuit",
        params: { parameterOverrides: overrides },
        modelRef: model.id,
        subcircuitName: iface.name,
        orderedPins: iface.orderedPins,
      },
      endpoints: element.orderedNodes.map((raw, index) => ({
        componentId: element.name,
        pin: iface.orderedPins[index] ?? `p${index}`,
        raw,
        line: element.startLine,
      })),
    },
    diagnostics: [],
  };
}

async function mapAnalysis(
  statement: ParsedSpiceStatement & { kind: "analysis" },
  ordinal: number,
  components: ComponentInstance[]
): Promise<DomainResult<AnalysisDefinition>> {
  const analysis = statement.analysis;
  const hash = (await sha256Hex(canonicalJson(JSON.parse(JSON.stringify(analysis))))).slice(0, 16);
  const id = `an-${String(ordinal + 1).padStart(2, "0")}-${hash}`;
  if (analysis.kind === "op") {
    return { ok: true, value: { id, name: "DC OP", kind: "dc-op", enabledProbes: [] }, diagnostics: [] };
  }
  if (analysis.kind === "tran") {
    const value: AnalysisDefinition = {
      id,
      name: "Transient",
      kind: "transient",
      stepS: analysis.stepS,
      stopS: analysis.stopS,
      enabledProbes: [],
    };
    if (analysis.startS !== undefined) value.startS = analysis.startS;
    if (analysis.maxStepS !== undefined) value.maxStepS = analysis.maxStepS;
    return { ok: true, value, diagnostics: [] };
  }
  if (analysis.kind === "ac") {
    const value: AnalysisDefinition =
      analysis.scale === "lin"
        ? { id, name: "AC", kind: "ac", scale: "lin", totalPoints: analysis.points, startHz: analysis.startHz, stopHz: analysis.stopHz, enabledProbes: [] }
        : {
            id,
            name: "AC",
            kind: "ac",
            scale: analysis.scale,
            pointsPerInterval: analysis.points,
            startHz: analysis.startHz,
            stopHz: analysis.stopHz,
            enabledProbes: [],
          };
    return { ok: true, value, diagnostics: [] };
  }
  if (analysis.kind !== "dc") return fail("CIR_BAD_ANALYSIS", "unsupported analysis");
  const source = components.find(item => item.refdes.toUpperCase() === analysis.sourceName.toUpperCase());
  if (!source) return fail("CIR_UNKNOWN_SWEEP_SOURCE", "dc sweep source was not found", { line: statement.startLine });
  const quantity = source.kind === "currentSource" ? "current" : "voltage";
  return {
    ok: true,
    value: {
      id,
      name: "DC sweep",
      kind: "dc-sweep",
      sweep:
        quantity === "voltage"
          ? { sourceComponentId: source.id, quantity, startV: analysis.start, stopV: analysis.stop, stepV: analysis.step }
          : { sourceComponentId: source.id, quantity, startA: analysis.start, stopA: analysis.stop, stepA: analysis.step },
      enabledProbes: [],
    },
    diagnostics: [],
  };
}

function spiceNumber(value: number) {
  if (Object.is(value, -0) || value === 0) return "0";
  return String(value);
}

function commentLine(text: string) {
  return `* ${text.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\r|\n/g, " ")}`;
}

function emitTransient(kind: "V" | "I", transient: VoltageTransientWaveform | NonNullable<Extract<ComponentInstance, { kind: "currentSource" }>["params"]["transient"]>) {
  if (transient.kind === "pulse") {
    const values =
      "initialV" in transient
        ? [transient.initialV, transient.pulsedV, transient.delayS, transient.riseS, transient.fallS, transient.widthS, transient.periodS]
        : [transient.initialA, transient.pulsedA, transient.delayS, transient.riseS, transient.fallS, transient.widthS, transient.periodS];
    return `PULSE(${values.map(spiceNumber).join(" ")})`;
  }
  if (transient.kind === "sin") {
    const values =
      "offsetV" in transient
        ? [transient.offsetV, transient.amplitudeV, transient.frequencyHz, transient.delayS, transient.dampingPerS, transient.phaseDeg]
        : [transient.offsetA, transient.amplitudeA, transient.frequencyHz, transient.delayS, transient.dampingPerS, transient.phaseDeg];
    return `SIN(${values.map(spiceNumber).join(" ")})`;
  }
  const points = transient.points.map(point => ("valueV" in point ? `${spiceNumber(point.timeS)} ${spiceNumber(point.valueV)}` : `${spiceNumber(point.timeS)} ${spiceNumber(point.valueA)}`));
  return `PWL(${points.join(" ")})`;
}

export async function serializeCir(project: CircuitProjectV2, analysisId: string): Promise<DomainResult<string>> {
  const parsed = parseCircuitProjectV2(project);
  if (!parsed.ok) return parsed;
  const analysis = parsed.value.analyses.find(item => item.id === analysisId);
  if (!analysis) return fail("FILE_UNKNOWN_ANALYSIS", "analysis is not on the project");
  const graph = buildSchematicGraph(parsed.value);
  if (!graph.ok) return graph;
  const lines = ["FLUXLAB CIRCUIT", commentLine(parsed.value.title), commentLine(`project ${parsed.value.id}`)];
  const referenced = new Set<string>();
  for (const component of parsed.value.schematic.components) {
    if (component.kind === "ground") continue;
    const resolved = resolveComponentDefinition(component, parsed.value.models);
    if (!resolved.ok) return resolved;
    const nodes = resolved.value.pins.map(pin => graph.value.endpointToNode[endpointKey({ componentId: component.id, pin })] ?? "0");
    if (component.kind === "resistor") lines.push(`${component.refdes} ${nodes[0]} ${nodes[1]} ${spiceNumber(component.params.resistanceOhm)}`);
    else if (component.kind === "capacitor") lines.push(`${component.refdes} ${nodes[0]} ${nodes[1]} ${spiceNumber(component.params.capacitanceF)}`);
    else if (component.kind === "inductor") lines.push(`${component.refdes} ${nodes[0]} ${nodes[1]} ${spiceNumber(component.params.inductanceH)}`);
    else if (component.kind === "voltageSource" || component.kind === "currentSource") {
      const extras: string[] = [];
      if (component.kind === "voltageSource") {
        if (component.params.dcV !== undefined) extras.push(`DC ${spiceNumber(component.params.dcV)}`);
        if (component.params.ac) extras.push(`AC ${spiceNumber(component.params.ac.magnitudeV)} ${spiceNumber(component.params.ac.phaseDeg)}`);
        if (component.params.transient) extras.push(emitTransient("V", component.params.transient));
      } else {
        if (component.params.dcA !== undefined) extras.push(`DC ${spiceNumber(component.params.dcA)}`);
        if (component.params.ac) extras.push(`AC ${spiceNumber(component.params.ac.magnitudeA)} ${spiceNumber(component.params.ac.phaseDeg)}`);
        if (component.params.transient) extras.push(emitTransient("I", component.params.transient));
      }
      lines.push([component.refdes, nodes[0], nodes[1], ...extras].join(" "));
    } else if ("modelRef" in component) {
      referenced.add(component.modelRef);
      const model = parsed.value.models.find(item => item.id === component.modelRef);
      if (component.kind === "diode") lines.push(`${component.refdes} ${nodes.join(" ")} ${model && model.kind === "spice-model" ? model.modelName : component.modelRef} AREA=${spiceNumber(component.params.area)}`);
      else if (component.kind === "bjt") lines.push(`${component.refdes} ${nodes.join(" ")} ${model && model.kind === "spice-model" ? model.modelName : component.modelRef} AREA=${spiceNumber(component.params.area)}`);
      else if (component.kind === "mosfet") {
        lines.push(
          `${component.refdes} ${nodes.join(" ")} ${model && model.kind === "spice-model" ? model.modelName : component.modelRef} L=${spiceNumber(component.params.lengthM)} W=${spiceNumber(component.params.widthM)} M=${spiceNumber(component.params.multiplicity)}`
        );
      } else if (component.kind === "subcircuit") {
        const extras = Object.entries(component.params.parameterOverrides).map(([name, value]) => `${name}=${spiceNumber(value)}`);
        lines.push([component.refdes, ...nodes, component.subcircuitName, ...extras].join(" "));
      } else {
        lines.push(`${component.refdes} ${nodes.join(" ")} ${model && model.kind === "spice-model" ? model.modelName : component.modelRef}`);
      }
    }
  }
  for (const model of parsed.value.models) {
    if (referenced.has(model.id)) lines.push(model.source.trimEnd());
  }
  if (analysis.kind === "dc-op") lines.push(".op");
  else if (analysis.kind === "transient") lines.push(`.tran ${spiceNumber(analysis.stepS)} ${spiceNumber(analysis.stopS)}`);
  else if (analysis.kind === "ac") {
    const points = analysis.scale === "lin" ? analysis.totalPoints : analysis.pointsPerInterval;
    lines.push(`.ac ${analysis.scale} ${spiceNumber(points)} ${spiceNumber(analysis.startHz)} ${spiceNumber(analysis.stopHz)}`);
  } else {
    const source = parsed.value.schematic.components.find(item => item.id === analysis.sweep.sourceComponentId);
    if (!source) return fail("FILE_UNKNOWN_SWEEP", "sweep source missing");
    const start = analysis.sweep.quantity === "voltage" ? analysis.sweep.startV : analysis.sweep.startA;
    const stop = analysis.sweep.quantity === "voltage" ? analysis.sweep.stopV : analysis.sweep.stopA;
    const step = analysis.sweep.quantity === "voltage" ? analysis.sweep.stepV : analysis.sweep.stepA;
    lines.push(`.dc ${source.refdes} ${spiceNumber(start)} ${spiceNumber(stop)} ${spiceNumber(step)}`);
  }
  lines.push(".end");
  return { ok: true, value: `${lines.join("\n")}\n`, diagnostics: [] };
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function serializeVectorsCsv(run: SuccessfulRunRecord, vectorIds: string[]): DomainResult<string> {
  const vectors = vectorIds.map(id => run.snapshot.vectors.find(item => item.id === id));
  if (vectors.some(item => !item)) return fail("FILE_UNKNOWN_VECTOR", "csv vector is not on the run");
  const axis = run.snapshot.axes[0];
  if (!axis) return fail("FILE_NO_AXIS", "run has no axis");
  const header = ["axisId", "axisUnit", ...vectors.flatMap(vector => [ `${vector!.id}`, `${vector!.id}:unit` ])].map(csvEscape).join(",");
  const rows = [header];
  const length = axis.values.length;
  for (let index = 0; index < length; index += 1) {
    const cells = [axis.id, axis.unit];
    for (const vector of vectors) {
      const sample = vector!.values[index]!;
      const text = sample === Number.NEGATIVE_INFINITY && vector!.projection === "db20" ? "-Infinity" : String(sample);
      cells.push(text, vector!.unit);
    }
    rows.push(cells.map(csvEscape).join(","));
  }
  return { ok: true, value: `${rows.join("\n")}\n`, diagnostics: [] };
}

async function electricalHash(project: CircuitProjectV2) {
  return sha256Hex(
    canonicalJson({
      schematic: project.schematic,
      models: project.models,
      analyses: project.analyses,
      probes: project.probes,
      corners: project.corners,
    })
  );
}

export async function adoptProjectPreview(
  preview: ProjectImportPreview,
  current: CircuitProjectV2 | null,
  adoptedAt: string,
  mode: "create" | "overwrite" = "create"
): Promise<DomainResult<CircuitProjectV2>> {
  if (preview.blockers.some(item => item.blocksRun && item.code !== "CIR_NO_ANALYSIS")) {
    const hard = preview.blockers.filter(item => item.code !== "CIR_NO_ANALYSIS");
    if (hard.length) return { ok: false, diagnostics: hard };
  }
  if (mode === "create" || !current) {
    return {
      ok: true,
      value: {
        ...preview.project,
        id: crypto.randomUUID(),
        revision: 1,
        electricalRevision: 1,
        createdAt: adoptedAt,
        updatedAt: adoptedAt,
      },
      diagnostics: preview.warnings,
    };
  }
  const same = (await electricalHash(current)) === (await electricalHash(preview.project));
  return {
    ok: true,
    value: {
      ...preview.project,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: adoptedAt,
      revision: current.revision + 1,
      electricalRevision: same ? current.electricalRevision : current.electricalRevision + 1,
    },
    diagnostics: preview.warnings,
  };
}

export async function adoptRunPreview(preview: RunImportPreview, currentProject: CircuitProjectV2): Promise<DomainResult<TerminalRunRecord>> {
  if (preview.kind !== "full") return fail("RUN_IMPORT_REFERENCE_ONLY", "omitted envelopes cannot be adopted");
  if (preview.record.projectId !== currentProject.id) return fail("RUN_IMPORT_FOREIGN_PROJECT", "run belongs to another project");
  return { ok: true, value: preview.record, diagnostics: [] };
}

export async function parseV1Project(input: unknown, metadata: { projectId: string; migratedAt: string }): Promise<DomainResult<ProjectImportPreview>> {
  const migrated = await migrateV1CircuitDocument(input, metadata);
  if (migrated.kind === "rejected") return { ok: false, diagnostics: migrated.diagnostics };
  return { ok: true, value: previewOf(migrated.project, "v1", migrated.diagnostics), diagnostics: migrated.diagnostics };
}

export const LEGACY_PROJECT_KEYS = ["circuit-simulator:active-document", "circuit-simulator:rc-charge", "circuit-simulator:led-lab"] as const;
export const LEGACY_PROGRESS_KEY = "circuit-simulator:learning-progress";

export function inspectLegacyLocalStorage(storage: Storage) {
  return {
    projects: LEGACY_PROJECT_KEYS.map(key => ({ key, present: storage.getItem(key) !== null })),
    discardedProgress: storage.getItem(LEGACY_PROGRESS_KEY) !== null,
  };
}

export async function readImportText(file: File, kind: "fluxproj" | "fluxrun" | "cir"): Promise<DomainResult<string>> {
  const limit = kind === "fluxrun" ? FLUXRUN_MAX_BYTES : FLUXPROJ_MAX_BYTES;
  if (file.size > limit) return fail("FILE_TOO_LARGE", `${kind} file size exceeds the limit`);
  const text = await file.text();
  if (utf8Bytes(text) > limit) return fail("FILE_TOO_LARGE", `${kind} decoded size exceeds the limit`);
  return { ok: true, value: text, diagnostics: [] };
}
