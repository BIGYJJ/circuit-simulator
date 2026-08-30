import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import type { AnalysisDefinition } from "../domain/project/project-v2";
import type { CompileResult } from "./contracts";
import { DEFAULT_RUNTIME_LIMITS, checkRunResourceLimits, estimateAxisPoints, estimateRunResources } from "./resource-estimator";

function compiled(partial: Partial<CompileResult> = {}): CompileResult {
  return {
    netlist: "FLUXLAB GENERATED NETLIST\n.end\n",
    netlistHash: "0".repeat(64),
    diagnostics: [],
    sourceMap: { lineToComponent: {}, componentToLines: {}, endpointToNode: {}, nodeToEndpoints: {} },
    modelManifest: [],
    vectorPlan: [
      { probeId: "pr-a", sourceVectorName: "v(N0001)", quantity: "voltage", projections: ["scalar"], axisName: "time" },
    ],
    vectorPlanHash: "0".repeat(64),
    requestedRawVectors: ["time", "v(N0001)"],
    ...partial,
  };
}

function transient(stepS: number, stopS: number): AnalysisDefinition {
  return { id: "an-tran", name: "t", kind: "transient", stepS, stopS, enabledProbes: ["pr-a"] };
}

function oversizedTransientFixture() {
  return {
    project: dividerProjectFixture(),
    analysis: transient(1, 1_000_001),
    compiled: compiled(),
    resultTransport: "binary-rawfile" as const,
  };
}

describe("resource estimator", () => {
  it("blocks a transient request above two million total axis/vector points", () => {
    const result = estimateRunResources(oversizedTransientFixture());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe("RESOURCE_RESULT_POINTS");
  });

  it("accepts the exact stored-point limit and rejects one point above", () => {
    const atLimit = estimateRunResources({
      project: dividerProjectFixture(),
      analysis: transient(1, 999_999),
      compiled: compiled(),
      resultTransport: "binary-rawfile",
    });
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) expect(atLimit.value.resultPoints).toBe(DEFAULT_RUNTIME_LIMITS.maxResultPoints);

    const above = estimateRunResources({
      project: dividerProjectFixture(),
      analysis: transient(1, 1_000_000),
      compiled: compiled(),
      resultTransport: "binary-rawfile",
    });
    expect(above.ok).toBe(false);
    if (!above.ok) expect(above.diagnostics[0].code).toBe("RESOURCE_RESULT_POINTS");
  });

  it("counts an inclusive DC sweep conservatively despite 0.3/0.1 floating error", () => {
    const analysis: AnalysisDefinition = {
      id: "an-dc",
      name: "dc",
      kind: "dc-sweep",
      sweep: { sourceComponentId: "V1", quantity: "voltage", startV: 0, stopV: 0.3, stepV: 0.1 },
      enabledProbes: ["pr-a"],
    };
    const points = estimateAxisPoints(analysis);
    expect(points.ok && points.value).toBe(4);
  });

  it("counts AC fan-out projections in snapshot bytes but unique raw sources only once", () => {
    const analysis: AnalysisDefinition = {
      id: "an-ac",
      name: "ac",
      kind: "ac",
      scale: "lin",
      totalPoints: 20,
      startHz: 1,
      stopHz: 2,
      enabledProbes: ["pr-a", "pr-b"],
    };
    const plan = compiled({
      vectorPlan: [
        {
          probeId: "pr-a",
          sourceVectorName: "v(N0001)",
          quantity: "voltage",
          projections: ["real", "imaginary", "magnitude", "phase", "db20"],
          axisName: "frequency",
        },
        {
          probeId: "pr-b",
          sourceVectorName: "v(N0001)",
          quantity: "voltage",
          projections: ["real", "imaginary", "magnitude", "phase", "db20"],
          axisName: "frequency",
        },
      ],
    });
    const result = estimateRunResources({
      project: dividerProjectFixture(),
      analysis,
      compiled: plan,
      resultTransport: "binary-rawfile",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rawResultBytes).toBe((8 + 16) * 20);
    expect(result.value.resultPoints).toBe(11 * 20);
    expect(result.value.snapshotTransferBytes).toBe(11 * 20 * 8);
    expect(result.value.rawResultBytes).toBeLessThan(result.value.snapshotTransferBytes);

    const atLimit = checkRunResourceLimits({
      ...result.value,
      snapshotTransferBytes: DEFAULT_RUNTIME_LIMITS.maxSnapshotTransferBytes,
    });
    expect(atLimit).toEqual([]);
    const over = checkRunResourceLimits({
      ...result.value,
      snapshotTransferBytes: DEFAULT_RUNTIME_LIMITS.maxSnapshotTransferBytes + 1,
    });
    expect(over.map(item => item.code)).toContain("RESOURCE_SNAPSHOT_TRANSFER");
  });

  it("rejects netlist and virtual FS one byte over the limits", () => {
    const netlist = "x".repeat(DEFAULT_RUNTIME_LIMITS.maxExpandedNetlistBytes + 1);
    const overNetlist = estimateRunResources({
      project: dividerProjectFixture(),
      analysis: { id: "an-op", name: "op", kind: "dc-op", enabledProbes: ["pr-a"] },
      compiled: compiled({
        netlist,
        vectorPlan: [{ probeId: "pr-a", sourceVectorName: "v(N0001)", quantity: "voltage", projections: ["scalar"], axisName: "index" }],
      }),
      resultTransport: "binary-rawfile",
    });
    expect(overNetlist.ok).toBe(false);
    if (!overNetlist.ok) expect(overNetlist.diagnostics[0].code).toBe("RESOURCE_NETLIST");

    const overFs = estimateRunResources({
      project: dividerProjectFixture(),
      analysis: { id: "an-op", name: "op", kind: "dc-op", enabledProbes: ["pr-a"] },
      compiled: compiled({
        netlist: "n",
        vectorPlan: [{ probeId: "pr-a", sourceVectorName: "v(N0001)", quantity: "voltage", projections: ["scalar"], axisName: "index" }],
      }),
      resultTransport: "binary-rawfile",
      modelSources: [{ generatedName: "model-aa.lib", sha256: "a".repeat(64), source: "y".repeat(DEFAULT_RUNTIME_LIMITS.maxVirtualFsBytes) }],
    });
    expect(overFs.ok).toBe(false);
    if (!overFs.ok) expect(overFs.diagnostics.some(item => item.code === "RESOURCE_VIRTUAL_FS" || item.code === "RESOURCE_NETLIST")).toBe(true);
  });

  it("reports zero rawfile bytes for vector-callback transport", () => {
    const result = estimateRunResources({
      project: dividerProjectFixture(),
      analysis: { id: "an-op", name: "op", kind: "dc-op", enabledProbes: ["pr-a"] },
      compiled: compiled({
        vectorPlan: [{ probeId: "pr-a", sourceVectorName: "v(N0001)", quantity: "voltage", projections: ["scalar"], axisName: "index" }],
      }),
      resultTransport: "vector-callback",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rawfileFsBytes).toBe(0);
  });

  it("blocks a single vector one byte over 16 MiB", () => {
    const points = DEFAULT_RUNTIME_LIMITS.maxSingleVectorBytes / 8 + 1;
    const result = estimateRunResources({
      project: dividerProjectFixture(),
      analysis: { id: "an-ac", name: "ac", kind: "ac", scale: "lin", totalPoints: points, startHz: 1, stopHz: 2, enabledProbes: ["pr-a"] },
      compiled: compiled({
        vectorPlan: [{ probeId: "pr-a", sourceVectorName: "v(N0001)", quantity: "voltage", projections: ["scalar"], axisName: "frequency" }],
      }),
      resultTransport: "vector-callback",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map(item => item.code)).toContain("RESOURCE_SINGLE_VECTOR");
  });
});
