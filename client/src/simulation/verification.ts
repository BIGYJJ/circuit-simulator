import { APP_BUILD_ID } from "../app/build-info";
import { canonicalJson, sha256Hex } from "../domain/project/canonical";
import type {
  AnalysisDefinition,
  AssertionDefinition,
  CircuitProjectV2,
  CornerDefinition,
  Diagnostic,
  DomainResult,
} from "../domain/project/project-v2";
import { parseCircuitProjectV2 } from "../domain/project/project-schema";
import { applyCorner, hashAnalysisDefinition } from "./compile-netlist";
import type { EngineFingerprint, RunRecord, SuccessfulRunRecord } from "./contracts";
import { evaluateAssertionSet } from "./measurements";
import { checkRunFreshness, computeAssertionSetHash } from "./run-record";
import type { SimulationController, SimulationRunInput } from "./simulation-controller";
import { appendAssertionEvaluation, listProjectRunEnvelopes, listRuns, loadRun } from "../storage/indexeddb";

export type PlannedRun = Readonly<SimulationRunInput>;

export interface SeriesRunResult {
  status: "completed" | "stopped";
  records: RunRecord[];
  diagnostics: Diagnostic[];
}

export interface GateSlotEvidence {
  cornerId: string | null;
  newest: {
    runId: string;
    localAttempt: number;
    status: RunRecord["status"];
    fresh: boolean;
    assertionSetHash?: string;
    assertionStatus?: "passed" | "failed" | "error";
    evidenceOk: boolean;
  } | null;
}

export interface DeliveryGateInput {
  projectId: string;
  electricalRevision: number;
  appBuildId: string;
  analysisId: string;
  analysisHash: string;
  assertionSetHash: string;
  hasEnabledAssertions: boolean;
  modelHash: string;
  engineBuildId: string;
  ercBlocking: boolean;
  slots: GateSlotEvidence[];
}

export interface DeliveryGateResult {
  status: "passed" | "failed" | "blocked";
  diagnostics: Diagnostic[];
  evidenceRunIds: string[];
}

export interface GateRunEvidence {
  localAttempt: number;
  record: RunRecord;
}

function blocker(code: string, message: string): Diagnostic {
  return { severity: "error", code, message, blocksRun: true };
}

function fail<T>(code: string, message: string): DomainResult<T> {
  return { ok: false, diagnostics: [blocker(code, message)] };
}

export function planAnalysisRuns(project: CircuitProjectV2, analysisId: string): DomainResult<PlannedRun[]> {
  const parsed = parseCircuitProjectV2(project);
  if (!parsed.ok) return parsed;
  if (!parsed.value.analyses.some(item => item.id === analysisId)) {
    return fail("PLAN_UNKNOWN_ANALYSIS", "analysis is not on the project");
  }
  const enabled = [...parsed.value.corners.filter(item => item.enabled)].sort((left, right) => left.id.localeCompare(right.id));
  for (const corner of enabled) {
    for (const override of corner.overrides) {
      if (!parsed.value.schematic.components.some(item => item.id === override.componentId)) {
        return fail("CORNER_BAD_TARGET", `corner ${corner.id} references a missing component`);
      }
    }
  }
  const plans: PlannedRun[] = [{ project, analysisId }];
  const total = enabled.length;
  enabled.forEach((definition, index) => {
    plans.push({ project, analysisId, corner: { definition, ordinal: index + 1, total } });
  });
  return { ok: true, value: plans, diagnostics: [] };
}

export async function runAnalysisSeries(
  controller: SimulationController,
  runs: PlannedRun[],
  shouldStop?: () => boolean
): Promise<SeriesRunResult> {
  const records: RunRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const planned of runs) {
    if (shouldStop?.()) return { status: "stopped", records, diagnostics };
    const result = await controller.run(planned);
    if (result.status === "not-started") {
      return { status: "stopped", records, diagnostics: result.diagnostics };
    }
    records.push(result);
    if (result.status !== "success") return { status: "stopped", records, diagnostics };
  }
  return { status: "completed", records, diagnostics };
}

export async function validateAssertionDraft(
  project: CircuitProjectV2,
  draft: AssertionDefinition
): Promise<DomainResult<AssertionDefinition>> {
  const next = structuredClone(project);
  const index = next.assertions.findIndex(item => item.id === draft.id);
  if (index >= 0) next.assertions[index] = draft;
  else next.assertions.push(draft);
  const parsed = parseCircuitProjectV2(next);
  if (!parsed.ok) return parsed;
  if (!parsed.value.analyses.some(item => item.id === draft.analysisId)) {
    return fail("ASSERT_UNKNOWN_ANALYSIS", "assertion analysis is missing");
  }
  return { ok: true, value: draft, diagnostics: [] };
}

export async function validateCornerDraft(
  project: CircuitProjectV2,
  draft: CornerDefinition
): Promise<DomainResult<CornerDefinition>> {
  const parsed = parseCircuitProjectV2({
    ...project,
    corners: [...project.corners.filter(item => item.id !== draft.id), draft],
  });
  if (!parsed.ok) return parsed;
  const applied = await applyCorner(project, draft, 1, Math.max(1, project.corners.filter(item => item.enabled || item.id === draft.id).length || 1));
  if (!applied.ok) return applied;
  return { ok: true, value: draft, diagnostics: [] };
}

export async function computeModelSetHash(project: CircuitProjectV2): Promise<string> {
  return sha256Hex(
    canonicalJson(
      [...project.models]
        .map(item => ({ id: item.id, sha256: item.sha256 }))
        .sort((left, right) => left.id.localeCompare(right.id))
    )
  );
}

function assertionStatusOf(run: SuccessfulRunRecord, assertionSetHash: string) {
  const evaluation = [...run.assertionEvaluations].reverse().find(item => item.assertionSetHash === assertionSetHash);
  if (!evaluation) return undefined;
  if (evaluation.results.some(item => item.status === "error")) return "error" as const;
  if (evaluation.results.some(item => item.status === "failed")) return "failed" as const;
  if (evaluation.results.length && evaluation.results.every(item => item.status === "passed")) return "passed" as const;
  return "error" as const;
}

export async function buildDeliveryGateInput(
  project: CircuitProjectV2,
  analysis: AnalysisDefinition,
  engine: EngineFingerprint,
  runs: GateRunEvidence[],
  erc: Diagnostic[],
  appBuildId = APP_BUILD_ID
): Promise<DomainResult<DeliveryGateInput>> {
  const parsed = parseCircuitProjectV2(project);
  if (!parsed.ok) return parsed;
  const assertionSetHash = await computeAssertionSetHash(project.assertions, analysis.id);
  const analysisHash = await hashAnalysisDefinition(analysis);
  const modelHash = await computeModelSetHash(project);
  const enabledCorners = [...project.corners.filter(item => item.enabled)].sort((left, right) => left.id.localeCompare(right.id));
  const slotIds: Array<string | null> = [null, ...enabledCorners.map(item => item.id)];
  const slots: GateSlotEvidence[] = [];
  for (const cornerId of slotIds) {
    const matching = runs.filter(item => {
      if (item.record.analysisId !== analysis.id || item.record.projectId !== project.id) return false;
      return (item.record.corner?.cornerId ?? null) === cornerId;
    });
    const newest = matching.reduce<GateRunEvidence | undefined>((current, item) => {
      if (!current || item.localAttempt > current.localAttempt) return item;
      return current;
    }, undefined);
    if (!newest) {
      slots.push({ cornerId, newest: null });
      continue;
    }
    if (newest.record.status !== "success") {
      slots.push({
        cornerId,
        newest: {
          runId: newest.record.runId,
          localAttempt: newest.localAttempt,
          status: newest.record.status,
          fresh: false,
          evidenceOk: false,
        },
      });
      continue;
    }
    const success = newest.record;
    const freshness = await checkRunFreshness({ run: success, project, appBuildId, engine });
    const fresh = freshness.ok && freshness.value.fresh;
    const status = assertionStatusOf(success, assertionSetHash);
    slots.push({
      cornerId,
      newest: {
        runId: success.runId,
        localAttempt: newest.localAttempt,
        status: success.status,
        fresh,
        assertionSetHash: status ? assertionSetHash : undefined,
        assertionStatus: status,
        evidenceOk: Boolean(fresh && status && status !== "error"),
      },
    });
  }
  return {
    ok: true,
    value: {
      projectId: project.id,
      electricalRevision: project.electricalRevision,
      appBuildId,
      analysisId: analysis.id,
      analysisHash,
      assertionSetHash,
      hasEnabledAssertions: project.assertions.some(item => item.enabled && item.analysisId === analysis.id),
      modelHash,
      engineBuildId: engine.engineBuildId,
      ercBlocking: erc.some(item => item.blocksRun),
      slots,
    },
    diagnostics: [],
  };
}

export function evaluateDeliveryGate(input: DeliveryGateInput): DeliveryGateResult {
  const diagnostics: Diagnostic[] = [];
  const evidenceRunIds: string[] = [];
  if (input.ercBlocking) {
    return { status: "blocked", diagnostics: [blocker("GATE_ERC_BLOCKING", "blocking ERC remains")], evidenceRunIds };
  }
  if (!input.hasEnabledAssertions) {
    return { status: "blocked", diagnostics: [blocker("GATE_NO_ENABLED_ASSERTIONS", "the analysis has no enabled assertions")], evidenceRunIds };
  }
  let failed = false;
  for (const slot of input.slots) {
    if (!slot.newest) {
      diagnostics.push(
        blocker(slot.cornerId ? "GATE_MISSING_CORNER_RUN" : "GATE_MISSING_NOMINAL_RUN", "required evidence slot is empty")
      );
      continue;
    }
    evidenceRunIds.push(slot.newest.runId);
    if (slot.newest.status !== "success") {
      diagnostics.push(blocker("GATE_TERMINAL_NOT_SUCCESS", `newest attempt is ${slot.newest.status}`));
      continue;
    }
    if (!slot.newest.fresh) {
      diagnostics.push(blocker("GATE_STALE_RUN", "newest success is not fresh against the current project"));
      continue;
    }
    if (!slot.newest.assertionStatus) {
      diagnostics.push(blocker("GATE_ASSERTION_HASH_MISMATCH", "no evaluation matches the current assertion set"));
      continue;
    }
    if (slot.newest.assertionStatus === "error") {
      diagnostics.push(blocker("GATE_ASSERTION_ERROR", "assertion evaluation is an error"));
      continue;
    }
    if (slot.newest.assertionStatus === "failed") failed = true;
  }
  if (diagnostics.length) return { status: "blocked", diagnostics, evidenceRunIds };
  if (failed) return { status: "failed", diagnostics: [blocker("GATE_ASSERTION_FAILED", "an enabled assertion failed")], evidenceRunIds };
  return { status: "passed", diagnostics: [], evidenceRunIds };
}

export async function reevaluateAssertions(
  project: CircuitProjectV2,
  run: SuccessfulRunRecord,
  engine: EngineFingerprint,
  appBuildId = APP_BUILD_ID
): Promise<DomainResult<SuccessfulRunRecord>> {
  const freshness = await checkRunFreshness({ run, project, appBuildId, engine });
  if (!freshness.ok) return freshness;
  if (!freshness.value.fresh) return fail("GATE_STALE_RUN", freshness.value.reason ?? "run is not fresh");
  const evaluation = await evaluateAssertionSet({
    run,
    assertions: project.assertions,
    projectRevision: project.revision,
    electricalRevision: project.electricalRevision,
    evaluatedAt: new Date().toISOString(),
  });
  if (!evaluation.ok) return evaluation;
  const appended = await appendAssertionEvaluation(run.runId, evaluation.value);
  if (!appended.ok) return appended;
  return { ok: true, value: appended.value.record as SuccessfulRunRecord, diagnostics: [] };
}

export async function listGateRunEvidence(projectId: string): Promise<DomainResult<GateRunEvidence[]>> {
  const listed = await listRuns(projectId);
  if (!listed.ok) return listed;
  const evidence: GateRunEvidence[] = [];
  for (const summary of listed.value) {
    const loaded = await loadRun(summary.runId);
    if (!loaded.ok) return loaded;
    if (loaded.value) evidence.push({ localAttempt: loaded.value.localAttempt, record: loaded.value.record });
  }
  return { ok: true, value: evidence, diagnostics: [] };
}

export { listProjectRunEnvelopes };
