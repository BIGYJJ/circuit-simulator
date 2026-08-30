import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import { validateProbeDraft } from "../features/analysis/probe-draft";
import { compileNetlist, hashAnalysisDefinition } from "../simulation/compile-netlist";
import type { EngineMetadata, RunRecordBase, RunningRunRecord } from "../simulation/contracts";
import { parseAdapterResult } from "../simulation/result-parser";
import {
  computeAssertionSetHash,
  createCompletedRunCandidate,
  createRunningRunRecord,
  emptyCapturedEvaluation,
  finishRunFailure,
  finishRunSuccess,
} from "../simulation/run-record";
import {
  adoptProjectPreview,
  encodeImportedSpiceNode,
  FLUXPROJ_MAX_BYTES,
  parseCirProject,
  parseFluxProject,
  parseFluxRun,
  serializeCir,
  serializeFluxProject,
  serializeFluxRun,
  serializeVectorsCsv,
} from "./project-files";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/imports");

const ENGINE: EngineMetadata = {
  name: "ngspice",
  version: "ngspice-46",
  resultTransport: "binary-rawfile",
  moduleSha256: "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93",
  wasmSha256: "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c",
  engineBuildId: "ngspice-46-emscripten-singlethread-256m-20260527",
  verifiedAt: "2026-08-31T00:00:00.000Z",
};

function fluxProjectWithModel(source: string) {
  const project = dividerProjectFixture();
  return JSON.stringify({
    format: "fluxproj",
    formatVersion: 1,
    project: {
      ...project,
      models: [
        {
          id: "dmod",
          displayName: "D",
          source,
          sha256: "0".repeat(64),
          origin: "user-import",
          kind: "spice-model",
          modelName: "D",
          deviceFamily: "diode",
        },
      ],
    },
  });
}

async function failedRunFixture() {
  const project = dividerProjectFixture();
  const compiled = await compileNetlist({ project, analysis: project.analyses[0]! });
  if (!compiled.ok) throw new Error("compile failed");
  const base: RunRecordBase = {
    schemaVersion: 1,
    appBuildId: "verify-test",
    runId: "run-failed",
    projectId: project.id,
    projectRevision: project.revision,
    electricalRevision: project.electricalRevision,
    analysisId: project.analyses[0]!.id,
    analysis: project.analyses[0]!,
    analysisHash: await hashAnalysisDefinition(project.analyses[0]!),
    requestedAssertions: [],
    requestedAssertionSetHash: await computeAssertionSetHash([], project.analyses[0]!.id),
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
    startedAt: "2026-08-31T00:00:00.000Z",
    preflightDiagnostics: [],
  };
  const running: RunningRunRecord = createRunningRunRecord(base);
  const failed = finishRunFailure(running, "2026-08-31T00:00:01.000Z", {
    code: "ENGINE_EXIT",
    message: "failed",
    diagnostics: [],
    log: ["no"],
    retryable: false,
  });
  if (!failed.ok) throw new Error("failed run");
  return failed.value;
}

async function successRunFixture() {
  const project = dividerProjectFixture();
  const compiled = await compileNetlist({ project, analysis: project.analyses[0]! });
  if (!compiled.ok) throw new Error("compile failed");
  const startedAt = "2026-08-31T00:00:00.000Z";
  const finishedAt = "2026-08-31T00:00:01.000Z";
  const runRequest = {
    appBuildId: "verify-test",
    runId: "run-ok",
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
      vectors: compiled.value.requestedRawVectors.map(name => ({ name, axisName: name, real: new Float64Array([6]) })),
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
  const base: RunRecordBase = {
    schemaVersion: 1,
    appBuildId: "verify-test",
    runId: "run-ok",
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
  };
  const running = createRunningRunRecord(base, ENGINE);
  const candidate = createCompletedRunCandidate(running, parsed.value, finishedAt);
  if (!candidate.ok) throw new Error("candidate");
  const evaluation = await emptyCapturedEvaluation({
    runId: running.runId,
    projectRevision: running.projectRevision,
    electricalRevision: running.electricalRevision,
    assertions: [],
    assertionSetHash: running.requestedAssertionSetHash,
    evaluatedAt: finishedAt,
  });
  const success = finishRunSuccess(candidate.value, evaluation);
  if (!success.ok) throw new Error("success run");
  return success.value;
}

describe("project file trust boundary", () => {
  it("rejects a model that hides shell in a continuation", async () => {
    const result = await parseFluxProject(fluxProjectWithModel(".model D D(IS=1e-12)\n+ .shell bad"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.location).toMatchObject({ line: 1, endLine: 2 });
  });

  it("cannot serialize a failed run as successful evidence", async () => {
    const failed = await failedRunFixture();
    const result = await serializeFluxRun(failed, "full");
    if (!result.ok) throw new Error(result.diagnostics.map(item => `${item.code}:${item.message}`).join(" | "));
    expect(JSON.parse(result.value).run.status).toBe("failed");
  });

  it("rejects running export/import and an unknown vector mode", async () => {
    const exported = await serializeFluxRun({ status: "running" } as never, "full");
    expect(exported.ok).toBe(false);
    if (!exported.ok) expect(exported.diagnostics[0]?.code).toBe("RUN_EXPORT_NOT_TERMINAL");
    const parsed = await parseFluxRun(JSON.stringify({ format: "fluxrun", formatVersion: 1, vectorMode: "partial", run: {} }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.diagnostics[0]?.code).toBe("FILE_UNKNOWN_VECTOR_MODE");
  });

  it("rejects oversized fluxproj before parse", async () => {
    const huge = `${"a".repeat(FLUXPROJ_MAX_BYTES + 1)}`;
    const result = await parseFluxProject(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("FILE_TOO_LARGE");
  });

  it("round-trips a divider project and CSV -Infinity exception", async () => {
    const serialized = await serializeFluxProject(dividerProjectFixture());
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const parsed = await parseFluxProject(serialized.value);
    expect(parsed.ok && parsed.value.project.title).toBe("9V divider");
    const run = await successRunFixture();
    const db20 = {
      ...run,
      snapshot: {
        ...run.snapshot,
        vectors: run.snapshot.vectors.map(vector => ({
          ...vector,
          projection: "db20" as const,
          unit: "dB" as const,
          values: new Float64Array([Number.NEGATIVE_INFINITY]),
        })),
      },
    };
    const csv = serializeVectorsCsv(db20, [db20.snapshot.vectors[0]!.id]);
    expect(csv.ok && csv.value.includes("-Infinity")).toBe(true);
    expect(csv.ok && csv.value.includes("\n")).toBe(true);
  });

  it("encodes numeric and GND nodes and maps CIR fixtures", async () => {
    const numeric = await encodeImportedSpiceNode("1");
    const gnd = await encodeImportedSpiceNode("GND");
    const zero = await encodeImportedSpiceNode("0");
    expect(numeric.ok && numeric.value?.startsWith("SPICE_")).toBe(true);
    expect(gnd.ok && gnd.value?.startsWith("SPICE_")).toBe(true);
    expect(zero.ok && zero.value).toBeNull();

    const none = await parseCirProject(readFileSync(join(fixtures, "cir-no-analysis.cir"), "utf8"), {
      projectId: "cir-none",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    expect(none.ok && none.value.project.analyses).toEqual([]);
    const many = await parseCirProject(readFileSync(join(fixtures, "cir-multiple-analyses.cir"), "utf8"), {
      projectId: "cir-many",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    expect(many.ok && many.value.project.analyses).toHaveLength(2);
    const sub = await parseCirProject(readFileSync(join(fixtures, "cir-self-contained-subckt.cir"), "utf8"), {
      projectId: "cir-x",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    expect(sub.ok && sub.value.project.schematic.components.some(item => item.kind === "subcircuit")).toBe(true);
    expect(sub.ok && sub.value.project.schematic.components.some(item => item.id === "R1")).toBe(false);

    const eq = await parseCirProject(readFileSync(join(fixtures, "cir-equivalence.cir"), "utf8"), {
      projectId: "cir-eq",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    expect(eq.ok).toBe(true);
    if (eq.ok) {
      const probe = {
        id: "pr-vout",
        kind: "node-voltage" as const,
        node: { componentId: "R2", pin: "p" as const },
        label: "Vout",
      };
      const drafted = await validateProbeDraft(eq.value.project, eq.value.project.analyses[0]!, probe);
      expect(drafted.ok).toBe(true);
    }

    const pulse = await parseCirProject("T\nV1 1 0 PULSE(1 2 0 1n 1n 1 2)\nR1 1 0 1k\n.tran 0.01 1\n.end\n", {
      projectId: "cir-pulse",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    expect(pulse.ok).toBe(true);
    if (pulse.ok) {
      const source = pulse.value.project.schematic.components.find(item => item.kind === "voltageSource");
      expect(source && source.kind === "voltageSource" && source.params.dcV).toBeUndefined();
      expect(source && source.kind === "voltageSource" && source.params.transient?.kind).toBe("pulse");
    }
  });

  it("serializes CIR without compiler includes and adopts a new id", async () => {
    const cir = await serializeCir(dividerProjectFixture(), "an-op");
    expect(cir.ok && cir.value.includes(".include")).toBe(false);
    expect(cir.ok && cir.value.startsWith("FLUXLAB CIRCUIT")).toBe(true);
    const parsed = await parseCirProject(cir.ok ? cir.value : "", { projectId: "round", createdAt: "2026-08-31T00:00:00.000Z" });
    expect(parsed.ok).toBe(true);
    const adopted = parsed.ok
      ? await adoptProjectPreview(parsed.value, dividerProjectFixture(), "2026-08-31T00:00:02.000Z", "create")
      : parsed;
    expect(adopted.ok && adopted.value.revision).toBe(1);
    const omitted = await serializeFluxRun(await failedRunFixture(), "omitted");
    expect(omitted.ok).toBe(true);
    if (omitted.ok) {
      const preview = await parseFluxRun(omitted.value);
      expect(preview.ok && preview.value.kind).toBe("reference-only");
    }
  });
});
