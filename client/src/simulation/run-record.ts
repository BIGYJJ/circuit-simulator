import { canonicalJson, hashCanonical, sha256Hex } from "../domain/project/canonical";
import type { AssertionDefinition, CircuitProjectV2, Diagnostic, DomainResult } from "../domain/project/project-v2";
import { compileNetlist, hashAnalysisDefinition } from "./compile-netlist";
import type {
  AssertionEvaluation,
  CompletedRunCandidate,
  EngineFingerprint,
  RunRecord,
  RunRecordBase,
  RunningRunRecord,
  SimulationSnapshot,
  SuccessfulRunRecord,
  TerminalRunRecord,
} from "./contracts";

function blocker(code: string, message: string): Diagnostic {
  return { severity: "error", code, message, blocksRun: true };
}

function fail<T>(code: string, message: string): DomainResult<T> {
  return { ok: false, diagnostics: [blocker(code, message)] };
}

export function selectEnabledAssertions(assertions: AssertionDefinition[], analysisId: string): AssertionDefinition[] {
  return assertions.filter(item => item.enabled && item.analysisId === analysisId).sort((left, right) => left.id.localeCompare(right.id));
}

export async function computeAssertionDefinitionHash(definition: AssertionDefinition): Promise<string> {
  return sha256Hex(canonicalJson(definition));
}

export async function computeAssertionSetHash(assertions: AssertionDefinition[], analysisId: string): Promise<string> {
  return sha256Hex(canonicalJson(selectEnabledAssertions(assertions, analysisId)));
}

export async function computeAssertionResultId(input: {
  runId: string;
  assertionSetHash: string;
  assertionId: string;
  assertionDefinitionHash: string;
}): Promise<string> {
  return `assertion-result:v1:${await sha256Hex(canonicalJson([input.runId, input.assertionSetHash, input.assertionId, input.assertionDefinitionHash]))}`;
}

export async function computeAssertionEvaluationId(runId: string, assertionSetHash: string): Promise<string> {
  return `assertion-evaluation:v1:${await sha256Hex(canonicalJson([runId, assertionSetHash]))}`;
}

export function runRecordBaseFields(record: RunRecord | RunRecordBase): RunRecordBase {
  return {
    schemaVersion: 1,
    appBuildId: record.appBuildId,
    runId: record.runId,
    projectId: record.projectId,
    projectRevision: record.projectRevision,
    electricalRevision: record.electricalRevision,
    analysisId: record.analysisId,
    analysis: record.analysis,
    analysisHash: record.analysisHash,
    requestedAssertions: record.requestedAssertions,
    requestedAssertionSetHash: record.requestedAssertionSetHash,
    netlistHash: record.netlistHash,
    vectorPlan: record.vectorPlan,
    vectorPlanHash: record.vectorPlanHash,
    requestedEngine: record.requestedEngine,
    modelManifest: record.modelManifest,
    inputBundle: record.inputBundle,
    ...(record.corner ? { corner: record.corner } : {}),
    startedAt: record.startedAt,
    preflightDiagnostics: record.preflightDiagnostics,
  };
}

export async function computeImmutableBaseHash(record: RunRecord | RunRecordBase): Promise<string> {
  return sha256Hex(canonicalJson(runRecordBaseFields(record)));
}

export async function buildRunningRecordForProject(input: {
  project: CircuitProjectV2;
  analysisId: string;
  runId: string;
  appBuildId: string;
  engine: EngineFingerprint;
  startedAt: string;
}): Promise<DomainResult<RunningRunRecord>> {
  const analysis = input.project.analyses.find(item => item.id === input.analysisId);
  if (!analysis) return fail("RUN_ANALYSIS_MISMATCH", "analysis is not on the project");
  const compiled = await compileNetlist({ project: input.project, analysis });
  if (!compiled.ok) return compiled;
  const requestedAssertions = selectEnabledAssertions(input.project.assertions, analysis.id);
  const requestedAssertionSetHash = await computeAssertionSetHash(input.project.assertions, analysis.id);
  const models = input.project.models
    .filter(model => compiled.value.modelManifest.some(item => item.modelId === model.id))
    .map(model => {
      const manifest = compiled.value.modelManifest.find(item => item.modelId === model.id)!;
      return { ...manifest, source: model.source };
    });
  const base: RunRecordBase = {
    schemaVersion: 1,
    appBuildId: input.appBuildId,
    runId: input.runId,
    projectId: input.project.id,
    projectRevision: input.project.revision,
    electricalRevision: input.project.electricalRevision,
    analysisId: analysis.id,
    analysis,
    analysisHash: await hashAnalysisDefinition(analysis),
    requestedAssertions,
    requestedAssertionSetHash,
    netlistHash: compiled.value.netlistHash,
    vectorPlan: compiled.value.vectorPlan,
    vectorPlanHash: compiled.value.vectorPlanHash,
    requestedEngine: input.engine,
    modelManifest: compiled.value.modelManifest,
    inputBundle: {
      netlist: compiled.value.netlist,
      models,
      sourceMap: compiled.value.sourceMap,
    },
    ...(compiled.value.appliedCorner ? { corner: compiled.value.appliedCorner } : {}),
    startedAt: input.startedAt,
    preflightDiagnostics: compiled.value.diagnostics
      .filter(item => !item.blocksRun)
      .map(diagnostic => ({ phase: "compile" as const, diagnostic })),
  };
  return { ok: true, value: createRunningRunRecord(base), diagnostics: [] };
}

export function createRunningRunRecord(base: RunRecordBase, verifiedEngine?: EngineFingerprint & { verifiedAt?: string }): RunningRunRecord {
  const engine =
    verifiedEngine && typeof verifiedEngine.verifiedAt === "string"
      ? { ...verifiedEngine, verifiedAt: verifiedEngine.verifiedAt }
      : undefined;
  return {
    ...base,
    status: "running",
    ...(engine ? { verifiedEngine: engine } : {}),
  };
}

export function createCompletedRunCandidate(running: RunningRunRecord, snapshot: SimulationSnapshot, finishedAt: string): DomainResult<CompletedRunCandidate> {
  if (running.status !== "running") return fail("RUN_BAD_TRANSITION", "only a running record can become a completed candidate");
  if (
    snapshot.runId !== running.runId ||
    snapshot.projectId !== running.projectId ||
    snapshot.appBuildId !== running.appBuildId ||
    snapshot.analysisHash !== running.analysisHash ||
    snapshot.netlistHash !== running.netlistHash ||
    snapshot.vectorPlanHash !== running.vectorPlanHash
  ) {
    return fail("RUN_SNAPSHOT_MISMATCH", "snapshot provenance does not match the running record");
  }
  return {
    ok: true,
    value: {
      running,
      finishedAt,
      snapshot,
      requestedAssertions: running.requestedAssertions,
      requestedAssertionSetHash: running.requestedAssertionSetHash,
    },
    diagnostics: [],
  };
}

function sameRunning(current: RunRecord, expected: RunningRunRecord): boolean {
  return current.status === "running" && current.runId === expected.runId && current.startedAt === expected.startedAt;
}

export function finishRunSuccess(candidate: CompletedRunCandidate, initialEvaluation: AssertionEvaluation): DomainResult<SuccessfulRunRecord> {
  if (candidate.running.status !== "running") return fail("RUN_BAD_TRANSITION", "completed candidate is not running");
  if (initialEvaluation.runId !== candidate.running.runId) return fail("RUN_EVALUATION_MISMATCH", "initial evaluation does not belong to the run");
  if (initialEvaluation.assertionSetHash !== candidate.requestedAssertionSetHash) {
    return fail("RUN_EVALUATION_MISMATCH", "initial evaluation set hash does not match the capture");
  }
  return {
    ok: true,
    value: {
      ...runRecordBaseFields(candidate.running),
      status: "success",
      finishedAt: candidate.finishedAt,
      snapshot: candidate.snapshot,
      assertionEvaluations: [initialEvaluation],
    },
    diagnostics: [],
  };
}

export function finishRunFailure(
  running: RunningRunRecord,
  finishedAt: string,
  failure: { code: string; message: string; diagnostics: Diagnostic[]; log: string[]; retryable: boolean }
): DomainResult<TerminalRunRecord> {
  if (running.status !== "running") return fail("RUN_BAD_TRANSITION", "only a running record can fail");
  return {
    ok: true,
    value: {
      ...runRecordBaseFields(running),
      status: "failed",
      finishedAt,
      ...(running.verifiedEngine ? { verifiedEngine: running.verifiedEngine } : {}),
      failure,
    },
    diagnostics: [],
  };
}

export function finishRunCancelled(running: RunningRunRecord, finishedAt: string, reason: "user" | "project-changed"): DomainResult<TerminalRunRecord> {
  if (running.status !== "running") return fail("RUN_BAD_TRANSITION", "only a running record can be cancelled");
  return {
    ok: true,
    value: {
      ...runRecordBaseFields(running),
      status: "cancelled",
      finishedAt,
      reason,
    },
    diagnostics: [],
  };
}

export function finishRunTimeout(running: RunningRunRecord, finishedAt: string, limitMs: number): DomainResult<TerminalRunRecord> {
  if (running.status !== "running") return fail("RUN_BAD_TRANSITION", "only a running record can time out");
  return {
    ok: true,
    value: {
      ...runRecordBaseFields(running),
      status: "timeout",
      finishedAt,
      limitMs,
    },
    diagnostics: [],
  };
}

export function recoverInterruptedRun(running: RunningRunRecord, finishedAt: string): DomainResult<TerminalRunRecord> {
  return finishRunFailure(running, finishedAt, {
    code: "RUN_INTERRUPTED",
    message: "the run was interrupted before a terminal record was written",
    diagnostics: [blocker("RUN_INTERRUPTED", "the run was interrupted")],
    log: [],
    retryable: true,
  });
}

export function rejectRepeatTerminal(current: RunRecord, running: RunningRunRecord): DomainResult<never> {
  if (!sameRunning(current, running)) return fail("RUN_BAD_TRANSITION", "terminal transition does not match the running record");
  return fail("RUN_DUPLICATE_TERMINAL", "the run is already terminal");
}

export async function checkRunFreshness(input: {
  run: RunRecord;
  project: CircuitProjectV2;
  appBuildId: string;
  engine: EngineFingerprint;
}): Promise<DomainResult<{ fresh: boolean; reason?: string }>> {
  if (input.run.appBuildId !== input.appBuildId) {
    return { ok: true, value: { fresh: false, reason: "APP_BUILD" }, diagnostics: [] };
  }
  if (input.run.projectId !== input.project.id || input.run.electricalRevision !== input.project.electricalRevision) {
    return { ok: true, value: { fresh: false, reason: "ELECTRICAL_REVISION" }, diagnostics: [] };
  }
  const analysis = input.project.analyses.find(item => item.id === input.run.analysisId);
  if (!analysis) return { ok: true, value: { fresh: false, reason: "ANALYSIS" }, diagnostics: [] };
  const analysisHash = await hashAnalysisDefinition(analysis);
  const corner = input.run.corner
    ? input.project.corners.find(item => item.id === input.run.corner?.cornerId)
    : undefined;
  const compiled = await compileNetlist({
    project: input.project,
    analysis,
    ...(input.run.corner && corner
      ? { corner: { definition: corner, ordinal: input.run.corner.ordinal, total: input.run.corner.total } }
      : {}),
  });
  if (!compiled.ok) return { ok: true, value: { fresh: false, reason: "COMPILE" }, diagnostics: compiled.diagnostics };
  const models = [...input.run.modelManifest].map(item => `${item.modelId}:${item.sha256}`).sort();
  const currentModels = [...compiled.value.modelManifest].map(item => `${item.modelId}:${item.sha256}`).sort();
  const engine = input.run.requestedEngine;
  const sameEngine =
    engine.name === input.engine.name &&
    engine.version === input.engine.version &&
    engine.resultTransport === input.engine.resultTransport &&
    engine.moduleSha256 === input.engine.moduleSha256 &&
    engine.wasmSha256 === input.engine.wasmSha256 &&
    engine.engineBuildId === input.engine.engineBuildId;
  const sameCorner =
    (input.run.corner?.definitionHash ?? "") === (compiled.value.appliedCorner?.definitionHash ?? "") &&
    (input.run.corner?.appliedOverridesHash ?? "") === (compiled.value.appliedCorner?.appliedOverridesHash ?? "");
  const fresh =
    analysisHash === input.run.analysisHash &&
    compiled.value.netlistHash === input.run.netlistHash &&
    compiled.value.vectorPlanHash === input.run.vectorPlanHash &&
    canonicalJson(compiled.value.vectorPlan) === canonicalJson(input.run.vectorPlan) &&
    canonicalJson(models) === canonicalJson(currentModels) &&
    sameEngine &&
    sameCorner;
  return { ok: true, value: { fresh, reason: fresh ? undefined : "COMPILER_OUTPUT" }, diagnostics: [] };
}

export async function withAssertionEvaluation(
  run: SuccessfulRunRecord,
  evaluation: AssertionEvaluation
): Promise<DomainResult<SuccessfulRunRecord>> {
  if (evaluation.runId !== run.runId || evaluation.electricalRevision !== run.electricalRevision) {
    return fail("RUN_EVALUATION_MISMATCH", "evaluation does not belong to this run");
  }
  if (evaluation.projectRevision < run.projectRevision) {
    return fail("RUN_EVALUATION_REVISION", "evaluation project revision is older than the run");
  }
  if (run.assertionEvaluations.some(item => item.id === evaluation.id)) {
    const existing = run.assertionEvaluations.find(item => item.id === evaluation.id)!;
    if (canonicalJson(existing) !== canonicalJson(evaluation)) return fail("RUN_EVALUATION_CORRUPT", "duplicate evaluation id has a different payload");
    return { ok: true, value: run, diagnostics: [] };
  }
  return {
    ok: true,
    value: { ...run, assertionEvaluations: [...run.assertionEvaluations, evaluation] },
    diagnostics: [],
  };
}

export async function emptyCapturedEvaluation(input: {
  runId: string;
  projectRevision: number;
  electricalRevision: number;
  assertions: AssertionDefinition[];
  assertionSetHash: string;
  evaluatedAt: string;
}): Promise<AssertionEvaluation> {
  const results = [];
  for (const definition of input.assertions) {
    const assertionDefinitionHash = await computeAssertionDefinitionHash(definition);
    results.push({
      id: await computeAssertionResultId({
        runId: input.runId,
        assertionSetHash: input.assertionSetHash,
        assertionId: definition.id,
        assertionDefinitionHash,
      }),
      assertionId: definition.id,
      assertionDefinitionHash,
      assertionSetHash: input.assertionSetHash,
      runId: input.runId,
      projectRevision: input.projectRevision,
      electricalRevision: input.electricalRevision,
      status: "error" as const,
      diagnostics: [blocker("ASSERT_NOT_EVALUATED", "assertion evaluation is reserved for the measurement boundary")],
    });
  }
  return {
    id: await computeAssertionEvaluationId(input.runId, input.assertionSetHash),
    runId: input.runId,
    projectRevision: input.projectRevision,
    electricalRevision: input.electricalRevision,
    assertionSetHash: input.assertionSetHash,
    evaluatedAt: input.evaluatedAt,
    definitions: input.assertions,
    results,
  };
}

export function hashCanonicalJson(value: unknown): Promise<string> {
  return hashCanonical(value);
}
