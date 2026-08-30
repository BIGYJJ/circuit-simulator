import { canonicalJson, sha256Hex } from "../domain/project/canonical";
import type {
  AnalysisDefinition,
  Diagnostic,
  DomainResult,
  ResultProjection,
  ResultQuantity,
  ResultUnit,
} from "../domain/project/project-v2";
import type {
  AdapterResult,
  EngineMetadata,
  ResultAxis,
  ResultVector,
  RuntimeLimits,
  SimulationRunRequest,
  SimulationSnapshot,
} from "./contracts";
import { DEFAULT_RUNTIME_LIMITS } from "./resource-estimator";

function fail<T>(code: string, message: string): DomainResult<T> {
  return { ok: false, diagnostics: [{ severity: "error", code, message, blocksRun: true }] };
}

export async function computeVectorId(
  analysisId: string,
  probeId: string,
  quantity: ResultQuantity,
  projection: ResultProjection
): Promise<string> {
  return `vector:v1:${await sha256Hex(canonicalJson([analysisId, probeId, quantity, projection]))}`;
}

export async function computeAxisId(analysisId: string, unit: ResultAxis["unit"], kind: AnalysisDefinition["kind"]): Promise<string> {
  return `axis:v1:${await sha256Hex(canonicalJson([analysisId, unit, kind]))}`;
}

export function axisUnitFor(analysis: AnalysisDefinition): ResultAxis["unit"] {
  if (analysis.kind === "dc-op") return "index";
  if (analysis.kind === "transient") return "s";
  if (analysis.kind === "ac") return "Hz";
  return analysis.sweep.quantity === "voltage" ? "V" : "A";
}

export function resultUnitFor(quantity: ResultQuantity, projection: ResultProjection): ResultUnit {
  if (projection === "db20") return "dB";
  if (projection === "phase") return "deg";
  if (quantity === "voltage") return "V";
  if (quantity === "current") return "A";
  if (quantity === "power") return "W";
  return "dimensionless";
}

export function projectRawValues(
  real: Float64Array,
  imaginary: Float64Array | undefined,
  projection: ResultProjection
): DomainResult<Float64Array> {
  if (projection === "imaginary" || projection === "magnitude" || projection === "phase" || projection === "db20") {
    if (!imaginary || imaginary.length !== real.length) return fail("RESULT_COMPLEX", "complex projection is missing an imaginary pair");
  }
  const out = new Float64Array(real.length);
  for (let index = 0; index < real.length; index += 1) {
    const re = real[index]!;
    const im = imaginary?.[index] ?? 0;
    if (projection === "scalar" || projection === "real") out[index] = re;
    else if (projection === "imaginary") out[index] = im;
    else {
      const magnitude = Math.hypot(re, im);
      if (projection === "magnitude") out[index] = magnitude;
      else if (projection === "phase") out[index] = (Math.atan2(im, re) * 180) / Math.PI;
      else out[index] = magnitude === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(magnitude);
    }
  }
  return { ok: true, value: out, diagnostics: [] };
}

function valuesLegal(values: Float64Array, projection: ResultProjection): boolean {
  for (const value of values) {
    if (projection === "db20") {
      if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return false;
    } else if (!Number.isFinite(value)) {
      return false;
    }
  }
  return true;
}

function axisDirection(values: Float64Array): "up" | "down" | "invalid" {
  if (values.length === 0) return "invalid";
  if (values.length === 1) return Number.isFinite(values[0]) ? "up" : "invalid";
  let up = true;
  let down = true;
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!;
    const current = values[index]!;
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === current) return "invalid";
    if (current <= previous) up = false;
    if (current >= previous) down = false;
  }
  if (up) return "up";
  if (down) return "down";
  return "invalid";
}

function reverseInPlace(values: Float64Array) {
  values.reverse();
}

export async function parseAdapterResult(input: {
  run: SimulationRunRequest;
  adapterResult: AdapterResult;
  engine: EngineMetadata;
  startedAt: string;
  finishedAt: string;
  limits?: RuntimeLimits;
}): Promise<DomainResult<SimulationSnapshot>> {
  const limits = input.limits ?? DEFAULT_RUNTIME_LIMITS;
  if (input.adapterResult.exitCode !== 0) return fail("ADAPTER_EXIT", "ngspice exit was not zero");
  const planHash = await sha256Hex(canonicalJson(input.run.compiled.vectorPlan));
  if (planHash !== input.run.compiled.vectorPlanHash) return fail("RESULT_VECTOR_PLAN", "compiled vector plan hash drifted");
  const required = input.run.compiled.requestedRawVectors;
  const seen = new Set<string>();
  const byName = new Map<string, AdapterResult["vectors"][number]>();
  for (const vector of input.adapterResult.vectors) {
    if (seen.has(vector.name)) return fail("RESULT_DUPLICATE_RAW", "adapter returned a duplicate raw vector");
    seen.add(vector.name);
    byName.set(vector.name, vector);
  }
  if (seen.size !== required.length || required.some(name => !seen.has(name))) {
    return fail("RESULT_RAW_SET", "adapter raw vectors do not match the compiled requested set");
  }
  const analysis = input.run.analysis;
  const axisUnit = axisUnitFor(analysis);
  let axisValues: Float64Array;
  if (analysis.kind === "dc-op") {
    axisValues = new Float64Array([0]);
  } else {
    const rawAxis = byName.get(input.run.compiled.vectorPlan[0]?.axisName ?? "");
    if (!rawAxis) return fail("RESULT_AXIS", "compiled axis is missing from the adapter result");
    axisValues = rawAxis.real.slice();
  }
  if (!axisValues.length) return fail("RESULT_EMPTY", "axis is empty");
  const direction = axisDirection(axisValues);
  if (direction === "invalid") return fail("RESULT_AXIS", "axis is not strictly monotonic");
  if (direction === "down" && analysis.kind !== "dc-sweep") return fail("RESULT_AXIS", "only a DC sweep may be descending");
  const reversed = direction === "down";
  if (reversed) reverseInPlace(axisValues);
  const axisId = await computeAxisId(analysis.id, axisUnit, analysis.kind);
  const axis: ResultAxis = {
    id: axisId,
    analysisId: analysis.id,
    label: analysis.kind === "dc-op" ? "index" : (input.run.compiled.vectorPlan[0]?.axisName ?? axisUnit),
    unit: axisUnit,
    values: axisValues,
  };
  const vectors: ResultVector[] = [];
  for (const entry of input.run.compiled.vectorPlan) {
    const raw = byName.get(entry.sourceVectorName);
    if (!raw) return fail("RESULT_RAW_SET", "a planned source vector is missing");
    if (raw.real.length !== (analysis.kind === "dc-op" ? 1 : axisValues.length) && !reversed) {
      if (raw.real.length !== axisValues.length) return fail("RESULT_LENGTH", "raw vector length does not match the axis");
    }
    if (analysis.kind !== "dc-op" && raw.real.length !== axisValues.length) {
      return fail("RESULT_LENGTH", "raw vector length does not match the axis");
    }
    if (analysis.kind === "dc-op" && raw.real.length !== 1) return fail("RESULT_LENGTH", "DC operating point must have one stored point");
    for (const projection of entry.projections) {
      const projected = projectRawValues(raw.real, raw.imaginary, projection);
      if (!projected.ok) return projected;
      if (reversed) reverseInPlace(projected.value);
      if (projected.value.length !== axisValues.length) return fail("RESULT_LENGTH", "projected vector length does not match the axis");
      if (!valuesLegal(projected.value, projection)) return fail("RESULT_NON_FINITE", "result contains a non-finite sample");
      if (projected.value.byteLength > limits.maxSingleVectorBytes) {
        return fail("RESOURCE_SINGLE_VECTOR", "a stored vector exceeds the single-buffer limit");
      }
      vectors.push({
        id: await computeVectorId(analysis.id, entry.probeId, entry.quantity, projection),
        probeId: entry.probeId,
        analysisId: analysis.id,
        quantity: entry.quantity,
        projection,
        sourceVectorName: entry.sourceVectorName,
        label: entry.probeId,
        unit: resultUnitFor(entry.quantity, projection),
        axisId,
        values: projected.value,
      });
    }
  }
  const uniqueAxisBuffers = [axis.values.buffer];
  const snapshotTransferBytes = uniqueAxisBuffers.reduce((sum, buffer) => sum + buffer.byteLength, 0) + vectors.reduce((sum, item) => sum + item.values.byteLength, 0);
  const resultPoints = axis.values.length + vectors.reduce((sum, item) => sum + item.values.length, 0);
  if (resultPoints > limits.maxResultPoints) return fail("RESOURCE_RESULT_POINTS", "stored axis/vector points exceed the run limit");
  if (snapshotTransferBytes > limits.maxSnapshotTransferBytes) {
    return fail("RESOURCE_SNAPSHOT_TRANSFER", "snapshot transfer bytes exceed the run limit");
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      appBuildId: input.run.appBuildId,
      runId: input.run.runId,
      projectId: input.run.projectId,
      projectRevision: input.run.projectRevision,
      electricalRevision: input.run.electricalRevision,
      analysisId: analysis.id,
      analysis,
      analysisHash: input.run.analysisHash,
      netlistHash: input.run.compiled.netlistHash,
      vectorPlan: input.run.compiled.vectorPlan,
      vectorPlanHash: input.run.compiled.vectorPlanHash,
      engine: input.engine,
      modelManifest: input.run.compiled.modelManifest,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      axes: [axis],
      vectors,
      diagnostics: [],
      log: input.adapterResult.log,
    },
    diagnostics: [],
  };
}
