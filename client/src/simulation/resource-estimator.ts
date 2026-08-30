import resultTransport from "../../../vendor/ngspice/RESULT_TRANSPORT.json";
import type { AnalysisDefinition, CircuitProjectV2, Diagnostic, DomainResult } from "../domain/project/project-v2";
import type { CompileResult, QualifiedResultTransport, ResourceEstimate, RunPolicy, RuntimeLimits } from "./contracts";

const MIB = 1024 * 1024;

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  maxWasmHeapBytes: 256 * MIB,
  maxVirtualFsBytes: 32 * MIB,
  maxLogBytes: 1 * MIB,
  maxResultPoints: 2_000_000,
  maxSingleVectorBytes: 16 * MIB,
  maxRawResultBytes: 64 * MIB,
  maxSnapshotTransferBytes: 64 * MIB,
  maxExpandedNetlistBytes: 16 * MIB,
};

export const DEFAULT_RUN_POLICY: RunPolicy = {
  timeoutMs: 30_000,
  keepLastRuns: 20,
};

function blocker(code: string, message: string): Diagnostic {
  return { severity: "error", code, message, blocksRun: true };
}

function fail<T>(code: string, message: string): DomainResult<T> {
  return { ok: false, diagnostics: [blocker(code, message)] };
}

function safeCount(value: number, code: string): DomainResult<number> {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value))) {
    return { ok: false, diagnostics: [blocker(code, "resource arithmetic overflow")] };
  }
  const rounded = Math.round(value);
  if (rounded !== value && !Number.isSafeInteger(value)) {
    return { ok: false, diagnostics: [blocker(code, "resource arithmetic overflow")] };
  }
  return { ok: true, value: Math.ceil(value), diagnostics: [] };
}

export function estimateAxisPoints(analysis: AnalysisDefinition): DomainResult<number> {
  if (analysis.kind === "dc-op") return { ok: true, value: 1, diagnostics: [] };
  if (analysis.kind === "dc-sweep") {
    const start = analysis.sweep.quantity === "voltage" ? analysis.sweep.startV : analysis.sweep.startA;
    const stop = analysis.sweep.quantity === "voltage" ? analysis.sweep.stopV : analysis.sweep.stopA;
    const step = analysis.sweep.quantity === "voltage" ? analysis.sweep.stepV : analysis.sweep.stepA;
    if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(step) || step === 0) {
      return fail("RESOURCE_RESULT_POINTS", "sweep bounds are not finite");
    }
    if (Math.sign(step) !== Math.sign(stop - start) && stop !== start) {
      return fail("RESOURCE_RESULT_POINTS", "sweep step does not move toward stop");
    }
    return safeCount(Math.ceil(Math.abs(stop - start) / Math.abs(step)) + 1, "RESOURCE_RESULT_POINTS");
  }
  if (analysis.kind === "transient") {
    const start = analysis.startS ?? 0;
    if (analysis.stopS <= start || analysis.stepS <= 0) return fail("RESOURCE_RESULT_POINTS", "transient bounds are invalid");
    return safeCount(Math.ceil((analysis.stopS - start) / analysis.stepS) + 1, "RESOURCE_RESULT_POINTS");
  }
  if (analysis.scale === "lin") {
    if (!Number.isSafeInteger(analysis.totalPoints) || analysis.totalPoints < 1) {
      return fail("RESOURCE_RESULT_POINTS", "linear AC point count is invalid");
    }
    return { ok: true, value: analysis.totalPoints, diagnostics: [] };
  }
  if (analysis.startHz <= 0 || analysis.stopHz <= analysis.startHz) {
    return fail("RESOURCE_RESULT_POINTS", "AC frequency bounds are invalid");
  }
  const intervals = analysis.scale === "dec" ? Math.log10(analysis.stopHz / analysis.startHz) : Math.log2(analysis.stopHz / analysis.startHz);
  return safeCount(Math.ceil(intervals * analysis.pointsPerInterval) + 1, "RESOURCE_RESULT_POINTS");
}

function uniqueRawNames(compiled: CompileResult) {
  const names = new Set<string>();
  for (const entry of compiled.vectorPlan) {
    names.add(entry.sourceVectorName);
    if (entry.axisName !== "index") names.add(entry.axisName);
  }
  return [...names].sort();
}

function isComplexRaw(analysis: AnalysisDefinition, name: string) {
  return analysis.kind === "ac" && name !== "frequency";
}

function estimateRawfileHeader(names: string[]) {
  const estimator = resultTransport.rawfileHeaderEstimator;
  if (!estimator || resultTransport.kind !== "binary-rawfile") return null;
  const nameBytes = names.reduce((sum, name) => sum + new TextEncoder().encode(name).byteLength, 0);
  return estimator.fixedBytes + estimator.perVariableBytes * names.length + estimator.perVariableNameUtf8Byte * nameBytes + estimator.safetyBytes;
}

export function checkRunResourceLimits(estimate: ResourceEstimate, limits: RuntimeLimits = DEFAULT_RUNTIME_LIMITS): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (estimate.resultPoints > limits.maxResultPoints) {
    diagnostics.push(blocker("RESOURCE_RESULT_POINTS", "stored axis/vector points exceed the run limit"));
  }
  if (estimate.maxSingleVectorBytes > limits.maxSingleVectorBytes) {
    diagnostics.push(blocker("RESOURCE_SINGLE_VECTOR", "a single vector exceeds the run limit"));
  }
  if (estimate.rawResultBytes > limits.maxRawResultBytes) {
    diagnostics.push(blocker("RESOURCE_RAW_RESULT", "adapter raw result bytes exceed the run limit"));
  }
  if (estimate.snapshotTransferBytes > limits.maxSnapshotTransferBytes) {
    diagnostics.push(blocker("RESOURCE_SNAPSHOT_TRANSFER", "snapshot transfer bytes exceed the run limit"));
  }
  if (estimate.expandedNetlistBytes > limits.maxExpandedNetlistBytes) {
    diagnostics.push(blocker("RESOURCE_NETLIST", "expanded netlist exceeds the run limit"));
  }
  if (estimate.virtualFsBytes > limits.maxVirtualFsBytes) {
    diagnostics.push(blocker("RESOURCE_VIRTUAL_FS", "virtual filesystem bytes exceed the run limit"));
  }
  return diagnostics;
}

export function estimateRunResources(input: {
  project: CircuitProjectV2;
  analysis: AnalysisDefinition;
  compiled: CompileResult;
  resultTransport: QualifiedResultTransport;
  modelSources?: Array<{ generatedName: string; sha256: string; source: string }>;
}): DomainResult<ResourceEstimate> {
  const axis = estimateAxisPoints(input.analysis);
  if (!axis.ok) return axis;
  const axisPoints = axis.value;
  const rawNames = uniqueRawNames(input.compiled);
  let rawResultBytes = 0;
  for (const name of rawNames) {
    rawResultBytes += (isComplexRaw(input.analysis, name) ? 16 : 8) * axisPoints;
  }
  const uniqueAxes = new Set(input.compiled.vectorPlan.map(item => item.axisName)).size || 1;
  const projectionCount = input.compiled.vectorPlan.reduce((sum, item) => sum + item.projections.length, 0);
  const resultPoints = uniqueAxes * axisPoints + projectionCount * axisPoints;
  const maxSingleVectorBytes = axisPoints * 8;
  const snapshotTransferBytes = resultPoints * 8;
  const expandedNetlistBytes = new TextEncoder().encode(input.compiled.netlist).byteLength;
  const uniqueModels = new Map<string, string>();
  for (const model of input.modelSources ?? []) {
    const key = `${model.generatedName}\0${model.sha256}`;
    if (!uniqueModels.has(key)) uniqueModels.set(key, model.source);
  }
  let modelUtf8Bytes = 0;
  for (const source of uniqueModels.values()) modelUtf8Bytes += new TextEncoder().encode(source).byteLength;
  let rawfileFsBytes = 0;
  if (input.resultTransport === "vector-callback") {
    rawfileFsBytes = 0;
  } else {
    const header = estimateRawfileHeader(rawNames);
    if (header === null) return fail("ENGINE_VECTOR_CONTRACT_MISMATCH", "rawfile header estimator is missing");
    rawfileFsBytes = header + rawResultBytes;
  }
  const estimate: ResourceEstimate = {
    axisPoints,
    resultPoints,
    maxSingleVectorBytes,
    rawResultBytes,
    snapshotTransferBytes,
    rawfileFsBytes,
    modelUtf8Bytes,
    expandedNetlistBytes,
    virtualFsBytes: expandedNetlistBytes + modelUtf8Bytes + rawfileFsBytes,
  };
  const limitDiagnostics = checkRunResourceLimits(estimate);
  if (limitDiagnostics.length) return { ok: false, diagnostics: limitDiagnostics };
  return { ok: true, value: estimate, diagnostics: [] };
}
