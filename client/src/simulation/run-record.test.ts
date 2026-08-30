import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import { compileNetlist, hashAnalysisDefinition } from "./compile-netlist";
import type { EngineMetadata, RunRecordBase, RunningRunRecord, SimulationSnapshot } from "./contracts";
import { parseAdapterResult } from "./result-parser";
import {
  checkRunFreshness,
  computeAssertionSetHash,
  createCompletedRunCandidate,
  createRunningRunRecord,
  emptyCapturedEvaluation,
  finishRunCancelled,
  finishRunFailure,
  finishRunSuccess,
  recoverInterruptedRun,
  runRecordBaseFields,
} from "./run-record";

const ENGINE: EngineMetadata = {
  name: "ngspice",
  version: "ngspice-46",
  resultTransport: "binary-rawfile",
  moduleSha256: "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93",
  wasmSha256: "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c",
  engineBuildId: "ngspice-46-emscripten-singlethread-256m-20260527",
  verifiedAt: "2026-08-31T00:00:00.000Z",
};

async function runningFixture(): Promise<{ running: RunningRunRecord; snapshot: SimulationSnapshot; base: RunRecordBase }> {
  const project = dividerProjectFixture();
  const compiled = await compileNetlist({ project, analysis: project.analyses[0]! });
  if (!compiled.ok) throw new Error("compile failed");
  const startedAt = "2026-08-31T00:00:00.000Z";
  const finishedAt = "2026-08-31T00:00:01.000Z";
  const runRequest = {
    appBuildId: "verify-test",
    runId: "run-a",
    projectId: project.id,
    projectRevision: project.revision,
    electricalRevision: project.electricalRevision,
    analysisHash: await hashAnalysisDefinition(project.analyses[0]!),
    requestedAssertionSetHash: await computeAssertionSetHash([], project.analyses[0]!.id),
    analysis: project.analyses[0]!,
    compiled: compiled.value,
    models: [],
  };
  const parsed = await parseAdapterResult({
    run: runRequest,
    adapterResult: {
      exitCode: 0,
      vectors: compiled.value.requestedRawVectors.map(name => ({
        name,
        axisName: name,
        real: new Float64Array([6]),
      })),
      log: [],
      resultTransport: "binary-rawfile",
      rawResultBytes: 8,
      rawfileFsBytes: 8,
      wasmHeapPeakBytes: 1,
      virtualFsPeakBytes: 1,
    },
    engine: ENGINE,
    startedAt,
    finishedAt,
  });
  if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message ?? "parse failed");
  const base: RunRecordBase = {
    schemaVersion: 1,
    appBuildId: "verify-test",
    runId: "run-a",
    projectId: project.id,
    projectRevision: project.revision,
    electricalRevision: project.electricalRevision,
    analysisId: project.analyses[0]!.id,
    analysis: project.analyses[0]!,
    analysisHash: runRequest.analysisHash,
    requestedAssertions: [],
    requestedAssertionSetHash: runRequest.requestedAssertionSetHash,
    netlistHash: compiled.value.netlistHash,
    vectorPlan: compiled.value.vectorPlan,
    vectorPlanHash: compiled.value.vectorPlanHash,
    requestedEngine: ENGINE,
    modelManifest: compiled.value.modelManifest,
    inputBundle: { netlist: compiled.value.netlist, models: [], sourceMap: compiled.value.sourceMap },
    startedAt,
    preflightDiagnostics: [],
  };
  return { running: createRunningRunRecord(base, ENGINE), snapshot: parsed.value, base };
}

describe("run record transitions", () => {
  it("recovers an interrupted running record as failed", async () => {
    const { running } = await runningFixture();
    const recovered = recoverInterruptedRun(running, "2026-08-31T00:00:02.000Z");
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value.status).toBe("failed");
    if (recovered.value.status === "failed") expect(recovered.value.failure.code).toBe("RUN_INTERRUPTED");
  });

  it("rejects a second terminal transition", async () => {
    const { running } = await runningFixture();
    const first = finishRunCancelled(running, "2026-08-31T00:00:02.000Z", "user");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = finishRunFailure(first.value as never, "2026-08-31T00:00:03.000Z", {
      code: "X",
      message: "no",
      diagnostics: [],
      log: [],
      retryable: false,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.diagnostics[0]?.code).toBe("RUN_BAD_TRANSITION");
  });

  it("creates a success only from a matching completed candidate", async () => {
    const { running, snapshot } = await runningFixture();
    const candidate = createCompletedRunCandidate(running, snapshot, snapshot.finishedAt);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const evaluation = await emptyCapturedEvaluation({
      runId: running.runId,
      projectRevision: running.projectRevision,
      electricalRevision: running.electricalRevision,
      assertions: [],
      assertionSetHash: running.requestedAssertionSetHash,
      evaluatedAt: snapshot.finishedAt,
    });
    const success = finishRunSuccess(candidate.value, evaluation);
    expect(success.ok).toBe(true);
    if (!success.ok) return;
    expect(success.value.status).toBe("success");
    expect(success.value.assertionEvaluations).toHaveLength(1);
    expect(canonicalFields(success.value)).toEqual(canonicalFields(running));
  });

  it("treats layout-only project revision changes as fresh inside the same app build", async () => {
    const { running } = await runningFixture();
    const project = dividerProjectFixture();
    project.revision = 9;
    const fresh = await checkRunFreshness({
      run: running,
      project,
      appBuildId: "verify-test",
      engine: ENGINE,
    });
    expect(fresh.ok && fresh.value.fresh).toBe(true);
    const staleBuild = await checkRunFreshness({
      run: running,
      project,
      appBuildId: "verify-other",
      engine: ENGINE,
    });
    expect(staleBuild.ok && staleBuild.value.fresh).toBe(false);
  });
});

function canonicalFields(record: { runId: string; netlistHash: string; vectorPlanHash: string }) {
  return runRecordBaseFields(record as never);
}
