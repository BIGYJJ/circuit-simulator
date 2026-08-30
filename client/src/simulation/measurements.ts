import type {
  AssertionComparator,
  AssertionDefinition,
  Diagnostic,
  DomainResult,
  MeasurementExpression,
  QuantityValue,
} from "../domain/project/project-v2";
import type { AssertionEvaluation, AssertionResult, CompletedRunCandidate, ResultVector, SuccessfulRunRecord } from "./contracts";
import {
  computeAssertionDefinitionHash,
  computeAssertionEvaluationId,
  computeAssertionResultId,
  computeAssertionSetHash,
  selectEnabledAssertions,
} from "./run-record";

export { computeAssertionDefinitionHash, computeAssertionEvaluationId, computeAssertionResultId, computeAssertionSetHash, selectEnabledAssertions };

const DB3 = 3.01029995664;

function fail<T>(code: string, message: string): DomainResult<T> {
  return { ok: false, diagnostics: [{ severity: "error", code, message, blocksRun: true }] };
}

function errorDiag(code: string, message: string): Diagnostic {
  return { severity: "error", code, message, blocksRun: false };
}

function findVector(run: SuccessfulRunRecord, vectorId: string): ResultVector | undefined {
  return run.snapshot.vectors.find(item => item.id === vectorId);
}

function findAxis(run: SuccessfulRunRecord, vector: ResultVector) {
  return run.snapshot.axes.find(item => item.id === vector.axisId);
}

function interpolate(axis: Float64Array, values: Float64Array, at: number): DomainResult<number> {
  if (!axis.length || axis.length !== values.length) return fail("MEAS_BAD_VECTOR", "vector and axis lengths do not match");
  for (let index = 0; index < axis.length; index += 1) {
    if (axis[index] === at) {
      const value = values[index]!;
      if (!Number.isFinite(value)) return fail("MEAS_NON_FINITE", "measured sample is not finite");
      return { ok: true, value, diagnostics: [] };
    }
  }
  const first = axis[0]!;
  const last = axis[axis.length - 1]!;
  const lo = Math.min(first, last);
  const hi = Math.max(first, last);
  if (at < lo || at > hi) return fail("MEAS_OUT_OF_RANGE", "sample is outside the closed axis");
  for (let index = 1; index < axis.length; index += 1) {
    const left = axis[index - 1]!;
    const right = axis[index]!;
    const min = Math.min(left, right);
    const max = Math.max(left, right);
    if (at >= min && at <= max && left !== right) {
      const t = (at - left) / (right - left);
      const value = values[index - 1]! + t * (values[index]! - values[index - 1]!);
      if (!Number.isFinite(value)) return fail("MEAS_NON_FINITE", "interpolated sample is not finite");
      return { ok: true, value, diagnostics: [] };
    }
  }
  return fail("MEAS_OUT_OF_RANGE", "sample is outside the closed axis");
}

function finiteValues(values: Float64Array): number[] {
  return [...values].filter(value => Number.isFinite(value));
}

export function evaluateMeasurement(run: SuccessfulRunRecord, expression: MeasurementExpression): DomainResult<QuantityValue> {
  const vector = findVector(run, expression.vectorId);
  if (!vector) return fail("MEAS_UNKNOWN_VECTOR", "vector is not on the selected run");
  const axis = findAxis(run, vector);
  if (!axis || axis.values.length === 0 || axis.values.length !== vector.values.length) {
    return fail("MEAS_BAD_AXIS", "vector axis is missing or misaligned");
  }
  if (expression.function === "valueAt") {
    if (expression.at.unit !== axis.unit) return fail("MEAS_UNIT", "valueAt unit does not match the axis");
    const interpolated = interpolate(axis.values, vector.values, expression.at.value);
    if (!interpolated.ok) return interpolated;
    return { ok: true, value: { value: interpolated.value, unit: vector.unit }, diagnostics: [] };
  }
  if (expression.function === "min" || expression.function === "max" || expression.function === "mean") {
    const samples = finiteValues(vector.values);
    if (!samples.length) return fail("MEAS_NON_FINITE", "vector has no finite samples");
    const value =
      expression.function === "min"
        ? Math.min(...samples)
        : expression.function === "max"
          ? Math.max(...samples)
          : samples.reduce((sum, item) => sum + item, 0) / samples.length;
    return { ok: true, value: { value, unit: vector.unit }, diagnostics: [] };
  }
  if (expression.function === "crossingTime") {
    if (axis.unit !== "s" || expression.threshold.unit !== vector.unit) return fail("MEAS_UNIT", "crossingTime requires a seconds axis and same-unit threshold");
    const threshold = expression.threshold.value;
    const rising = expression.edge === "rising";
    for (let index = 1; index < axis.values.length; index += 1) {
      const previous = vector.values[index - 1]!;
      const current = vector.values[index]!;
      if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
      if (previous === threshold && current === threshold) return fail("MEAS_FLAT_THRESHOLD", "crossing sits flat on the threshold");
      const startSide = rising ? previous < threshold : previous > threshold;
      const reached = rising ? current >= threshold : current <= threshold;
      if (startSide && reached) {
        if (current === previous) return fail("MEAS_FLAT_THRESHOLD", "crossing sits flat on the threshold");
        const t = (threshold - previous) / (current - previous);
        const time = axis.values[index - 1]! + t * (axis.values[index]! - axis.values[index - 1]!);
        return { ok: true, value: { value: time, unit: "s" }, diagnostics: [] };
      }
    }
    return fail("MEAS_NO_CROSSING", "the threshold was not crossed");
  }
  if (run.snapshot.analysis.kind !== "ac" || axis.unit !== "Hz" || vector.projection !== "db20") {
    return fail("MEAS_BANDWIDTH", "bandwidth3dB requires an AC db20 vector on a Hz axis");
  }
  if (axis.values.length < 2 || axis.values[0]! <= 0) return fail("MEAS_BANDWIDTH", "bandwidth3dB axis is empty or not positive Hz");
  if (vector.values.some(value => value === Number.NEGATIVE_INFINITY)) {
    return fail("MEAS_BANDWIDTH", "bandwidth3dB baseline or crossing includes -Infinity");
  }
  const baseline = vector.values[0]!;
  if (!Number.isFinite(baseline)) return fail("MEAS_NON_FINITE", "bandwidth baseline is not finite");
  if ([...vector.values].some(value => value - baseline > 0.1)) {
    return fail("MEAS_BANDWIDTH_RISE", "bandwidth3dB rejects an initial rise above 0.1 dB");
  }
  const target = baseline - DB3;
  const logScale = run.snapshot.analysis.kind === "ac" && run.snapshot.analysis.scale !== "lin";
  for (let index = 1; index < axis.values.length; index += 1) {
    const previous = vector.values[index - 1]!;
    const current = vector.values[index]!;
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    if (previous > target && current <= target) {
      const leftHz = axis.values[index - 1]!;
      const rightHz = axis.values[index]!;
      const t = (target - previous) / (current - previous);
      const hz = logScale
        ? 10 ** (Math.log10(leftHz) + t * (Math.log10(rightHz) - Math.log10(leftHz)))
        : leftHz + t * (rightHz - leftHz);
      return { ok: true, value: { value: hz, unit: "Hz" }, diagnostics: [] };
    }
  }
  return fail("MEAS_NO_CROSSING", "the -3 dB crossing was not found");
}

function compare(actual: QuantityValue, comparator: AssertionComparator): DomainResult<"passed" | "failed"> {
  if (comparator.kind === "between") {
    if (actual.unit !== comparator.minimum.unit || actual.unit !== comparator.maximum.unit) {
      return fail("ASSERT_UNIT", "between units are incompatible");
    }
    const passed = actual.value >= comparator.minimum.value && actual.value <= comparator.maximum.value;
    return { ok: true, value: passed ? "passed" : "failed", diagnostics: [] };
  }
  if (actual.unit !== comparator.expected.unit) return fail("ASSERT_UNIT", "comparator units are incompatible");
  if (comparator.kind === "lt") return { ok: true, value: actual.value < comparator.expected.value ? "passed" : "failed", diagnostics: [] };
  if (comparator.kind === "lte") return { ok: true, value: actual.value <= comparator.expected.value ? "passed" : "failed", diagnostics: [] };
  if (comparator.kind === "gt") return { ok: true, value: actual.value > comparator.expected.value ? "passed" : "failed", diagnostics: [] };
  if (comparator.kind === "gte") return { ok: true, value: actual.value >= comparator.expected.value ? "passed" : "failed", diagnostics: [] };
  if (comparator.kind !== "near") return fail("ASSERT_COMPARATOR", "unsupported comparator");
  const absTol = comparator.absoluteTolerance;
  const relTol = comparator.relativeTolerance;
  if ((absTol && absTol.unit !== actual.unit) || (relTol !== undefined && (relTol < 0 || relTol > 1))) {
    return fail("ASSERT_TOLERANCE", "near tolerances are invalid");
  }
  if (!absTol && (relTol === undefined || relTol <= 0)) return fail("ASSERT_TOLERANCE", "near requires a positive tolerance");
  if (comparator.expected.value === 0 && (!absTol || absTol.value <= 0)) return fail("ASSERT_TOLERANCE", "a zero expected value requires an absolute tolerance");
  const allowed = Math.max(absTol?.value ?? 0, (relTol ?? 0) * Math.abs(comparator.expected.value));
  const passed = Math.abs(actual.value - comparator.expected.value) <= allowed;
  return { ok: true, value: passed ? "passed" : "failed", diagnostics: [] };
}

async function evaluateDefinitions(input: {
  run: SuccessfulRunRecord;
  assertions: AssertionDefinition[];
  assertionSetHash: string;
  projectRevision: number;
  electricalRevision: number;
  evaluatedAt: string;
}): Promise<DomainResult<AssertionEvaluation>> {
  const results: AssertionResult[] = [];
  for (const definition of input.assertions) {
    const assertionDefinitionHash = await computeAssertionDefinitionHash(definition);
    const id = await computeAssertionResultId({
      runId: input.run.runId,
      assertionSetHash: input.assertionSetHash,
      assertionId: definition.id,
      assertionDefinitionHash,
    });
    const measured = evaluateMeasurement(input.run, definition.expression);
    if (!measured.ok) {
      results.push({
        id,
        assertionId: definition.id,
        assertionDefinitionHash,
        assertionSetHash: input.assertionSetHash,
        runId: input.run.runId,
        projectRevision: input.projectRevision,
        electricalRevision: input.electricalRevision,
        status: "error",
        diagnostics: measured.diagnostics,
      });
      continue;
    }
    const compared = compare(measured.value, definition.comparator);
    if (!compared.ok) {
      results.push({
        id,
        assertionId: definition.id,
        assertionDefinitionHash,
        assertionSetHash: input.assertionSetHash,
        runId: input.run.runId,
        projectRevision: input.projectRevision,
        electricalRevision: input.electricalRevision,
        status: "error",
        actual: measured.value,
        diagnostics: compared.diagnostics,
      });
      continue;
    }
    results.push({
      id,
      assertionId: definition.id,
      assertionDefinitionHash,
      assertionSetHash: input.assertionSetHash,
      runId: input.run.runId,
      projectRevision: input.projectRevision,
      electricalRevision: input.electricalRevision,
      status: compared.value,
      actual: measured.value,
      diagnostics: [],
    });
  }
  return {
    ok: true,
    value: {
      id: await computeAssertionEvaluationId(input.run.runId, input.assertionSetHash),
      runId: input.run.runId,
      projectRevision: input.projectRevision,
      electricalRevision: input.electricalRevision,
      assertionSetHash: input.assertionSetHash,
      evaluatedAt: input.evaluatedAt,
      definitions: input.assertions,
      results,
    },
    diagnostics: [],
  };
}

export async function evaluateCapturedAssertionSet(input: {
  candidate: CompletedRunCandidate;
  evaluatedAt: string;
}): Promise<DomainResult<AssertionEvaluation>> {
  const captured = selectEnabledAssertions(input.candidate.requestedAssertions, input.candidate.running.analysisId);
  const hash = await computeAssertionSetHash(input.candidate.requestedAssertions, input.candidate.running.analysisId);
  if (hash !== input.candidate.requestedAssertionSetHash || hash !== input.candidate.running.requestedAssertionSetHash) {
    return fail("RUN_ASSERTION_SET", "captured assertion set hash does not match the candidate");
  }
  if (captured.some(item => item.analysisId !== input.candidate.running.analysisId)) {
    return fail("RUN_ASSERTION_SET", "captured assertions do not belong to the run analysis");
  }
  const run: SuccessfulRunRecord = {
    ...input.candidate.running,
    status: "success",
    finishedAt: input.candidate.finishedAt,
    snapshot: input.candidate.snapshot,
    assertionEvaluations: [],
  };
  return evaluateDefinitions({
    run,
    assertions: captured,
    assertionSetHash: hash,
    projectRevision: input.candidate.running.projectRevision,
    electricalRevision: input.candidate.running.electricalRevision,
    evaluatedAt: input.evaluatedAt,
  });
}

export async function evaluateAssertionSet(input: {
  run: SuccessfulRunRecord;
  assertions: AssertionDefinition[];
  projectRevision: number;
  electricalRevision: number;
  evaluatedAt: string;
}): Promise<DomainResult<AssertionEvaluation>> {
  if (input.electricalRevision !== input.run.electricalRevision) {
    return fail("RUN_EVALUATION_REVISION", "reevaluation electrical revision does not match the run");
  }
  const captured = selectEnabledAssertions(input.assertions, input.run.analysisId);
  const hash = await computeAssertionSetHash(input.assertions, input.run.analysisId);
  return evaluateDefinitions({
    run: input.run,
    assertions: captured,
    assertionSetHash: hash,
    projectRevision: input.projectRevision,
    electricalRevision: input.electricalRevision,
    evaluatedAt: input.evaluatedAt,
  });
}
