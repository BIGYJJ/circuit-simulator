import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import { compileNetlist, hashAnalysisDefinition } from "./compile-netlist";
import type { EngineMetadata, SuccessfulRunRecord } from "./contracts";
import { parseAdapterResult } from "./result-parser";
import {
  computeAssertionSetHash,
  createCompletedRunCandidate,
  createRunningRunRecord,
  emptyCapturedEvaluation,
  finishRunSuccess,
} from "./run-record";
import { parseRunRecord } from "./run-record-schema";

const ENGINE: EngineMetadata = {
  name: "ngspice",
  version: "ngspice-46",
  resultTransport: "binary-rawfile",
  moduleSha256: "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93",
  wasmSha256: "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c",
  engineBuildId: "ngspice-46-emscripten-singlethread-256m-20260527",
  verifiedAt: "2026-08-31T00:00:00.000Z",
};

async function successfulRunFixture(): Promise<SuccessfulRunRecord> {
  const project = dividerProjectFixture();
  const compiled = await compileNetlist({ project, analysis: project.analyses[0]! });
  if (!compiled.ok) throw new Error("compile failed");
  const startedAt = "2026-08-31T00:00:00.000Z";
  const finishedAt = "2026-08-31T00:00:01.000Z";
  const setHash = await computeAssertionSetHash([], project.analyses[0]!.id);
  const runRequest = {
    appBuildId: "verify-test",
    runId: "run-schema",
    projectId: project.id,
    projectRevision: project.revision,
    electricalRevision: project.electricalRevision,
    analysisHash: await hashAnalysisDefinition(project.analyses[0]!),
    requestedAssertionSetHash: setHash,
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
  if (!parsed.ok) throw new Error("parse failed");
  const running = createRunningRunRecord(
    {
      schemaVersion: 1,
      appBuildId: "verify-test",
      runId: "run-schema",
      projectId: project.id,
      projectRevision: project.revision,
      electricalRevision: project.electricalRevision,
      analysisId: project.analyses[0]!.id,
      analysis: project.analyses[0]!,
      analysisHash: runRequest.analysisHash,
      requestedAssertions: [],
      requestedAssertionSetHash: setHash,
      netlistHash: compiled.value.netlistHash,
      vectorPlan: compiled.value.vectorPlan,
      vectorPlanHash: compiled.value.vectorPlanHash,
      requestedEngine: {
        name: ENGINE.name,
        version: ENGINE.version,
        resultTransport: ENGINE.resultTransport,
        moduleSha256: ENGINE.moduleSha256,
        wasmSha256: ENGINE.wasmSha256,
        engineBuildId: ENGINE.engineBuildId,
      },
      modelManifest: compiled.value.modelManifest,
      inputBundle: { netlist: compiled.value.netlist, models: [], sourceMap: compiled.value.sourceMap },
      startedAt,
      preflightDiagnostics: [],
    },
    ENGINE
  );
  const candidate = createCompletedRunCandidate(running, parsed.value, finishedAt);
  if (!candidate.ok) throw new Error("candidate failed");
  const evaluation = await emptyCapturedEvaluation({
    runId: running.runId,
    projectRevision: running.projectRevision,
    electricalRevision: running.electricalRevision,
    assertions: [],
    assertionSetHash: setHash,
    evaluatedAt: finishedAt,
  });
  const success = finishRunSuccess(candidate.value, evaluation);
  if (!success.ok) throw new Error("success failed");
  return success.value;
}

describe("parseRunRecord", () => {
  it("rejects a success wrapper whose snapshot belongs to another run", async () => {
    const value = await successfulRunFixture();
    value.snapshot.runId = "different-run";
    const result = await parseRunRecord(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("RUN_SNAPSHOT_MISMATCH");
  });

  it("accepts a coherent divider success record", async () => {
    const value = await successfulRunFixture();
    const result = await parseRunRecord(value, { project: dividerProjectFixture() });
    expect(result.ok).toBe(true);
  });

  it("rejects a cancelled record that still carries a snapshot key", async () => {
    const value = await successfulRunFixture();
    const cancelled = { ...value, status: "cancelled", reason: "user", snapshot: value.snapshot };
    delete (cancelled as { assertionEvaluations?: unknown }).assertionEvaluations;
    const result = await parseRunRecord(cancelled);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("RUN_SNAPSHOT_MISMATCH");
  });
});
