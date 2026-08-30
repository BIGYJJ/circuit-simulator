import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import { compileNetlist, hashAnalysisDefinition } from "./compile-netlist";
import type { EngineMetadata, SimulationRunRequest } from "./contracts";
import { parseAdapterResult } from "./result-parser";

const ENGINE: EngineMetadata = {
  name: "ngspice",
  version: "ngspice-46",
  resultTransport: "binary-rawfile",
  moduleSha256: "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93",
  wasmSha256: "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c",
  engineBuildId: "ngspice-46-emscripten-singlethread-256m-20260527",
  verifiedAt: "2026-08-31T00:00:00.000Z",
};

async function dividerRun(): Promise<SimulationRunRequest> {
  const project = dividerProjectFixture();
  const compiled = await compileNetlist({ project, analysis: project.analyses[0]! });
  if (!compiled.ok) throw new Error("compile failed");
  return {
    appBuildId: "verify-test",
    runId: "run-divider",
    projectId: project.id,
    projectRevision: project.revision,
    electricalRevision: project.electricalRevision,
    analysisHash: await hashAnalysisDefinition(project.analyses[0]!),
    requestedAssertionSetHash: "0".repeat(64),
    analysis: project.analyses[0]!,
    compiled: compiled.value,
    models: [],
  };
}

function adapterFixture(real: Float64Array, extras: Partial<{ name: string; imaginary: Float64Array }> = {}) {
  return {
    exitCode: 0,
    vectors: [{ name: extras.name ?? "v(vout)", axisName: extras.name ?? "v(vout)", real, imaginary: extras.imaginary }],
    log: [],
    resultTransport: "binary-rawfile" as const,
    rawResultBytes: real.byteLength,
    rawfileFsBytes: real.byteLength,
    wasmHeapPeakBytes: 1024,
    virtualFsPeakBytes: 1024,
  };
}

describe("parseAdapterResult", () => {
  it("rejects a successful-looking adapter vector containing NaN", async () => {
    const run = await dividerRun();
    const name = run.compiled.requestedRawVectors[0]!;
    const result = await parseAdapterResult({
      run,
      adapterResult: adapterFixture(new Float64Array([Number.NaN]), { name }),
      engine: ENGINE,
      startedAt: "2026-08-31T00:00:00.000Z",
      finishedAt: "2026-08-31T00:00:01.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("RESULT_NON_FINITE");
  });

  it("fans one raw vector to two same-node probes and keeps alignment", async () => {
    const project = dividerProjectFixture();
    project.probes.push({
      id: "probe-vout-2",
      kind: "node-voltage",
      node: { componentId: "R1", pin: "n" },
      label: "Vout2",
    });
    project.analyses[0] = { ...project.analyses[0]!, enabledProbes: ["probe-vout", "probe-vout-2"] };
    const compiled = await compileNetlist({ project, analysis: project.analyses[0]! });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const run = await dividerRun();
    run.compiled = compiled.value;
    run.analysis = project.analyses[0]!;
    const name = compiled.value.requestedRawVectors[0]!;
    const parsed = await parseAdapterResult({
      run,
      adapterResult: adapterFixture(new Float64Array([6]), { name }),
      engine: ENGINE,
      startedAt: "2026-08-31T00:00:00.000Z",
      finishedAt: "2026-08-31T00:00:01.000Z",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.vectors).toHaveLength(2);
    expect(parsed.value.vectors[0]?.values[0]).toBe(6);
    expect(parsed.value.vectors[1]?.values[0]).toBe(6);
    expect(parsed.value.vectors[0]?.id).not.toBe(parsed.value.vectors[1]?.id);
  });

  it("preserves -Infinity for an exact-zero AC db20 projection", async () => {
    const { lowpassAcProjectFixture } = await import("../../../tests/fixtures/circuits/projects");
    const project = lowpassAcProjectFixture();
    const compiled = await compileNetlist({ project, analysis: project.analyses[0]! });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const freq = new Float64Array([10, 100, 1000]);
    const zeros = new Float64Array([0, 0, 0]);
    const run: SimulationRunRequest = {
      ...(await dividerRun()),
      analysis: project.analyses[0]!,
      compiled: compiled.value,
      projectId: project.id,
    };
    const vectors = compiled.value.requestedRawVectors.map(name =>
      name === "frequency"
        ? { name, axisName: "frequency", real: freq }
        : { name, axisName: name, real: zeros, imaginary: zeros }
    );
    const parsed = await parseAdapterResult({
      run,
      adapterResult: {
        exitCode: 0,
        vectors,
        log: [],
        resultTransport: "binary-rawfile",
        rawResultBytes: 8,
        rawfileFsBytes: 8,
        wasmHeapPeakBytes: 1,
        virtualFsPeakBytes: 1,
      },
      engine: ENGINE,
      startedAt: "2026-08-31T00:00:00.000Z",
      finishedAt: "2026-08-31T00:00:01.000Z",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const db = parsed.value.vectors.filter(item => item.projection === "db20");
    expect(db.length).toBeGreaterThan(0);
    expect(db.every(item => item.values.every(value => value === Number.NEGATIVE_INFINITY))).toBe(true);
  });

  it("reverses a descending DC sweep axis together with bound vectors", async () => {
    const { diodeSweepProjectFixture } = await import("../../../tests/fixtures/circuits/projects");
    const project = diodeSweepProjectFixture();
    const compiled = await compileNetlist({ project, analysis: project.analyses[0]! });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const axisName = compiled.value.vectorPlan[0]!.axisName;
    const sourceName = compiled.value.vectorPlan[0]!.sourceVectorName;
    const axis = new Float64Array([0.8, 0.7, 0.6]);
    const current = new Float64Array([3, 2, 1]);
    const run: SimulationRunRequest = {
      ...(await dividerRun()),
      analysis: project.analyses[0]!,
      compiled: compiled.value,
      projectId: project.id,
    };
    const parsed = await parseAdapterResult({
      run,
      adapterResult: {
        exitCode: 0,
        vectors: [
          { name: axisName, axisName, real: axis },
          { name: sourceName, axisName, real: current },
        ],
        log: [],
        resultTransport: "binary-rawfile",
        rawResultBytes: 24,
        rawfileFsBytes: 24,
        wasmHeapPeakBytes: 1,
        virtualFsPeakBytes: 1,
      },
      engine: ENGINE,
      startedAt: "2026-08-31T00:00:00.000Z",
      finishedAt: "2026-08-31T00:00:01.000Z",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect([...parsed.value.axes[0]!.values]).toEqual([0.6, 0.7, 0.8]);
    expect([...parsed.value.vectors[0]!.values]).toEqual([1, 2, 3]);
  });

  it("emits RESOURCE_SNAPSHOT_TRANSFER with no partial snapshot one byte over the limit", async () => {
    const run = await dividerRun();
    const name = run.compiled.requestedRawVectors[0]!;
    const parsed = await parseAdapterResult({
      run,
      adapterResult: adapterFixture(new Float64Array([6]), { name }),
      engine: ENGINE,
      startedAt: "2026-08-31T00:00:00.000Z",
      finishedAt: "2026-08-31T00:00:01.000Z",
      limits: {
        maxWasmHeapBytes: 256,
        maxVirtualFsBytes: 256,
        maxLogBytes: 256,
        maxResultPoints: 2_000_000,
        maxSingleVectorBytes: 16 * 1024 * 1024,
        maxRawResultBytes: 64 * 1024 * 1024,
        maxSnapshotTransferBytes: 15,
        maxExpandedNetlistBytes: 16 * 1024 * 1024,
      },
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.diagnostics[0]?.code).toBe("RESOURCE_SNAPSHOT_TRANSFER");
  });
});
