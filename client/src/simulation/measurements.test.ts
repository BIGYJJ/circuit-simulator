import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import type { SuccessfulRunRecord } from "./contracts";
import { evaluateAssertionSet, evaluateMeasurement } from "./measurements";
import { computeAssertionSetHash, withAssertionEvaluation } from "./run-record";

function transientRunFixture(input: { time: number[]; volts: number[] }): SuccessfulRunRecord {
  const time = new Float64Array(input.time);
  const volts = new Float64Array(input.volts);
  return {
    schemaVersion: 1,
    appBuildId: "verify-test",
    runId: "run-tran",
    projectId: "proj-tran",
    projectRevision: 1,
    electricalRevision: 1,
    analysisId: "an-tran",
    analysis: { id: "an-tran", name: "tran", kind: "transient", stepS: 1, stopS: 2, enabledProbes: ["probe-v"] },
    analysisHash: "a".repeat(64),
    requestedAssertions: [],
    requestedAssertionSetHash: "b".repeat(64),
    netlistHash: "c".repeat(64),
    vectorPlan: [{ probeId: "probe-v", sourceVectorName: "v(1)", quantity: "voltage", projections: ["scalar"], axisName: "time" }],
    vectorPlanHash: "d".repeat(64),
    requestedEngine: {
      name: "ngspice",
      version: "ngspice-46",
      resultTransport: "binary-rawfile",
      moduleSha256: "e".repeat(64),
      wasmSha256: "f".repeat(64),
      engineBuildId: "engine",
    },
    modelManifest: [],
    inputBundle: { netlist: "FLUXLAB GENERATED NETLIST\n.end\n", models: [], sourceMap: { lineToComponent: {}, componentToLines: {}, endpointToNode: {}, nodeToEndpoints: {} } },
    startedAt: "2026-08-31T00:00:00.000Z",
    preflightDiagnostics: [],
    status: "success",
    finishedAt: "2026-08-31T00:00:01.000Z",
    snapshot: {
      schemaVersion: 1,
      appBuildId: "verify-test",
      runId: "run-tran",
      projectId: "proj-tran",
      projectRevision: 1,
      electricalRevision: 1,
      analysisId: "an-tran",
      analysis: { id: "an-tran", name: "tran", kind: "transient", stepS: 1, stopS: 2, enabledProbes: ["probe-v"] },
      analysisHash: "a".repeat(64),
      netlistHash: "c".repeat(64),
      vectorPlan: [{ probeId: "probe-v", sourceVectorName: "v(1)", quantity: "voltage", projections: ["scalar"], axisName: "time" }],
      vectorPlanHash: "d".repeat(64),
      engine: {
        name: "ngspice",
        version: "ngspice-46",
        resultTransport: "binary-rawfile",
        moduleSha256: "e".repeat(64),
        wasmSha256: "f".repeat(64),
        engineBuildId: "engine",
        verifiedAt: "2026-08-31T00:00:00.000Z",
      },
      modelManifest: [],
      startedAt: "2026-08-31T00:00:00.000Z",
      finishedAt: "2026-08-31T00:00:01.000Z",
      axes: [{ id: "axis-time", analysisId: "an-tran", label: "time", unit: "s", values: time }],
      vectors: [
        {
          id: "vec-v",
          probeId: "probe-v",
          analysisId: "an-tran",
          quantity: "voltage",
          projection: "scalar",
          sourceVectorName: "v(1)",
          label: "V",
          unit: "V",
          axisId: "axis-time",
          values: volts,
        },
      ],
      diagnostics: [],
      log: [],
    },
    assertionEvaluations: [],
  };
}

describe("run-bound measurements", () => {
  it("interpolates valueAt but never clamps outside the axis", () => {
    const run = transientRunFixture({ time: [0, 1, 2], volts: [0, 2, 4] });
    expect(
      evaluateMeasurement(run, {
        function: "valueAt",
        vectorId: run.snapshot.vectors[0]!.id,
        at: { value: 0.5, unit: "s" },
      })
    ).toMatchObject({ ok: true, value: { value: 1, unit: "V" } });
    const outside = evaluateMeasurement(run, {
      function: "valueAt",
      vectorId: run.snapshot.vectors[0]!.id,
      at: { value: -1, unit: "s" },
    });
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.diagnostics[0]?.code).toBe("MEAS_OUT_OF_RANGE");
  });

  it("computes min max mean and interpolates a rising crossing", () => {
    const run = transientRunFixture({ time: [0, 1, 2], volts: [0, 2, 4] });
    const vectorId = run.snapshot.vectors[0]!.id;
    expect(evaluateMeasurement(run, { function: "min", vectorId })).toMatchObject({ ok: true, value: { value: 0, unit: "V" } });
    expect(evaluateMeasurement(run, { function: "max", vectorId })).toMatchObject({ ok: true, value: { value: 4, unit: "V" } });
    expect(evaluateMeasurement(run, { function: "mean", vectorId })).toMatchObject({ ok: true, value: { value: 2, unit: "V" } });
    expect(
      evaluateMeasurement(run, {
        function: "crossingTime",
        vectorId,
        threshold: { value: 1, unit: "V" },
        edge: "rising",
      })
    ).toMatchObject({ ok: true, value: { value: 0.5, unit: "s" } });
  });

  it("finds a linear -3 dB bandwidth crossing", () => {
    const run = transientRunFixture({ time: [10, 100, 1000], volts: [0, -3.01029995664, -20] });
    run.analysis = { id: "an-ac", name: "ac", kind: "ac", scale: "lin", totalPoints: 3, startHz: 10, stopHz: 1000, enabledProbes: ["probe-v"] };
    run.snapshot.analysis = run.analysis;
    run.snapshot.axes[0] = { id: "axis-f", analysisId: "an-ac", label: "frequency", unit: "Hz", values: new Float64Array([10, 100, 1000]) };
    run.snapshot.vectors[0] = {
      ...run.snapshot.vectors[0]!,
      analysisId: "an-ac",
      projection: "db20",
      unit: "dB",
      axisId: "axis-f",
      values: new Float64Array([0, -3.01029995664, -20]),
    };
    const measured = evaluateMeasurement(run, { function: "bandwidth3dB", vectorId: run.snapshot.vectors[0]!.id });
    expect(measured.ok).toBe(true);
    if (measured.ok) expect(measured.value.value).toBeCloseTo(100, 8);
  });
});

describe("assertion evaluation", () => {
  it("marks a normal miss as failed and a unit error as error", async () => {
    const run = transientRunFixture({ time: [0, 1], volts: [6, 6] });
    const passed = await evaluateAssertionSet({
      run,
      assertions: [
        {
          id: "a1",
          name: "near 6",
          enabled: true,
          analysisId: "an-tran",
          expression: { function: "valueAt", vectorId: "vec-v", at: { value: 0, unit: "s" } },
          comparator: { kind: "near", expected: { value: 6, unit: "V" }, absoluteTolerance: { value: 0.01, unit: "V" } },
        },
      ],
      projectRevision: 1,
      electricalRevision: 1,
      evaluatedAt: "2026-08-31T00:00:02.000Z",
    });
    expect(passed.ok && passed.value.results[0]?.status).toBe("passed");
    const failed = await evaluateAssertionSet({
      run,
      assertions: [
        {
          id: "a2",
          name: "gt 9",
          enabled: true,
          analysisId: "an-tran",
          expression: { function: "valueAt", vectorId: "vec-v", at: { value: 0, unit: "s" } },
          comparator: { kind: "gt", expected: { value: 9, unit: "V" } },
        },
      ],
      projectRevision: 1,
      electricalRevision: 1,
      evaluatedAt: "2026-08-31T00:00:02.000Z",
    });
    expect(failed.ok && failed.value.results[0]?.status).toBe("failed");
    const errored = await evaluateAssertionSet({
      run,
      assertions: [
        {
          id: "a3",
          name: "bad unit",
          enabled: true,
          analysisId: "an-tran",
          expression: { function: "valueAt", vectorId: "vec-v", at: { value: 0, unit: "s" } },
          comparator: { kind: "gt", expected: { value: 1, unit: "A" } },
        },
      ],
      projectRevision: 1,
      electricalRevision: 1,
      evaluatedAt: "2026-08-31T00:00:02.000Z",
    });
    expect(errored.ok && errored.value.results[0]?.status).toBe("error");
  });

  it("rejects a mismatched electrical revision and keeps the snapshot after append", async () => {
    const run = transientRunFixture({ time: [0, 1], volts: [6, 6] });
    const evaluation = await evaluateAssertionSet({
      run,
      assertions: [
        {
          id: "a1",
          name: "near 6",
          enabled: true,
          analysisId: "an-tran",
          expression: { function: "valueAt", vectorId: "vec-v", at: { value: 0, unit: "s" } },
          comparator: { kind: "near", expected: { value: 6, unit: "V" }, absoluteTolerance: { value: 0.01, unit: "V" } },
        },
      ],
      projectRevision: 1,
      electricalRevision: 1,
      evaluatedAt: "2026-08-31T00:00:02.000Z",
    });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const appended = await withAssertionEvaluation(run, evaluation.value);
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.snapshot.vectors[0]?.id).toBe(run.snapshot.vectors[0]?.id);
    const mismatch = await evaluateAssertionSet({
      run,
      assertions: evaluation.value.definitions,
      projectRevision: 2,
      electricalRevision: 9,
      evaluatedAt: "2026-08-31T00:00:03.000Z",
    });
    expect(mismatch.ok).toBe(false);
    const other = dividerProjectFixture().assertions[0]!;
    other.analysisId = "other";
    const hashSame = await computeAssertionSetHash([other], "an-tran");
    const emptyHash = await computeAssertionSetHash([], "an-tran");
    expect(hashSame).toBe(emptyHash);
  });
});
