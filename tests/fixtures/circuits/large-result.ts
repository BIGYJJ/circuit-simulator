import { canonicalJson, hashCanonical, sha256Hex } from "../../../client/src/domain/project/canonical";
import type { CircuitProjectV2 } from "../../../client/src/domain/project/project-v2";
import type { SuccessfulRunRecord } from "../../../client/src/simulation/contracts";

export const NEAR_LIMIT_POINTS = 999_999;

const ENGINE = {
  name: "ngspice" as const,
  version: "ngspice-46",
  resultTransport: "binary-rawfile" as const,
  moduleSha256: "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93",
  wasmSha256: "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c",
  engineBuildId: "ngspice-46-emscripten-singlethread-256m-20260527",
};

export function createNearLimitHostProject(projectId = "proj-near-limit"): CircuitProjectV2 {
  return {
    schemaVersion: 2,
    id: projectId,
    title: "near-limit result host",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components: [
        { id: "V1", refdes: "V1", kind: "voltageSource", params: { dcV: 5 } },
        { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 1000 } },
        { id: "GND", refdes: "GND", kind: "ground", params: {} },
      ],
      wires: [],
    },
    layout: {
      components: {
        V1: { x: 80, y: 40, rotation: 0 },
        R1: { x: 80, y: 140, rotation: 0 },
        GND: { x: 80, y: 240, rotation: 0 },
      },
      wireRoutes: {},
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    models: [],
    analyses: [{ id: "an-tran", name: "tran", kind: "transient", stepS: 1e-6, stopS: 1, enabledProbes: ["probe-v"] }],
    probes: [{ id: "probe-v", kind: "node-voltage", node: { componentId: "R1", pin: "p" }, label: "V" }],
    assertions: [],
    corners: [],
    notes: [],
  };
}

export async function createNearLimitSuccessRecord(
  project: CircuitProjectV2,
  axis: Float64Array,
  values: Float64Array
): Promise<SuccessfulRunRecord> {
  const analysis = project.analyses[0]!;
  const vectorPlan = [
    { probeId: "probe-v", sourceVectorName: "v(1)", quantity: "voltage" as const, projections: ["scalar" as const], axisName: "time" },
  ];
  const netlist = "* FLUXLAB GENERATED NETLIST\nV1 1 0 5\nR1 1 0 1k\n.end\n";
  const [analysisHash, netlistHash, vectorPlanHash, assertionSetHash, axisId, vectorId] = await Promise.all([
    hashCanonical({ ...analysis, enabledProbes: [...analysis.enabledProbes].sort() }),
    sha256Hex(netlist),
    sha256Hex(canonicalJson(vectorPlan)),
    sha256Hex(canonicalJson([])),
    sha256Hex(canonicalJson([analysis.id, "s", "transient"])).then(hash => `axis:v1:${hash}`),
    sha256Hex(canonicalJson([analysis.id, "probe-v", "voltage", "scalar"])).then(hash => `vector:v1:${hash}`),
  ]);
  const evaluationId = `assertion-evaluation:v1:${await sha256Hex(canonicalJson(["run-near-limit", assertionSetHash]))}`;
  const finishedAt = "2026-08-31T00:00:01.000Z";
  return {
    schemaVersion: 1,
    appBuildId: "verify-test",
    runId: "run-near-limit",
    projectId: project.id,
    projectRevision: project.revision,
    electricalRevision: project.electricalRevision,
    analysisId: analysis.id,
    analysis,
    analysisHash,
    requestedAssertions: [],
    requestedAssertionSetHash: assertionSetHash,
    netlistHash,
    vectorPlan,
    vectorPlanHash,
    requestedEngine: ENGINE,
    modelManifest: [],
    inputBundle: {
      netlist,
      models: [],
      sourceMap: { lineToComponent: {}, componentToLines: {}, endpointToNode: {}, nodeToEndpoints: {} },
    },
    startedAt: "2026-08-31T00:00:00.000Z",
    preflightDiagnostics: [],
    status: "success",
    finishedAt,
    snapshot: {
      schemaVersion: 1,
      appBuildId: "verify-test",
      runId: "run-near-limit",
      projectId: project.id,
      projectRevision: project.revision,
      electricalRevision: project.electricalRevision,
      analysisId: analysis.id,
      analysis,
      analysisHash,
      netlistHash,
      vectorPlan,
      vectorPlanHash,
      engine: { ...ENGINE, verifiedAt: "2026-08-31T00:00:00.000Z" },
      modelManifest: [],
      startedAt: "2026-08-31T00:00:00.000Z",
      finishedAt,
      axes: [{ id: axisId, analysisId: analysis.id, label: "time", unit: "s", values: axis }],
      vectors: [
        {
          id: vectorId,
          probeId: "probe-v",
          analysisId: analysis.id,
          quantity: "voltage",
          projection: "scalar",
          sourceVectorName: "v(1)",
          label: "V",
          unit: "V",
          axisId,
          values,
        },
      ],
      diagnostics: [],
      log: [],
    },
    assertionEvaluations: [
      {
        id: evaluationId,
        runId: "run-near-limit",
        projectRevision: project.revision,
        electricalRevision: project.electricalRevision,
        assertionSetHash,
        evaluatedAt: finishedAt,
        definitions: [],
        results: [],
      },
    ],
  };
}

export function fillNearLimitSeries(points = NEAR_LIMIT_POINTS) {
  const axis = new Float64Array(points);
  const values = new Float64Array(points);
  for (let index = 0; index < points; index += 1) {
    axis[index] = index;
    values[index] = index;
  }
  return { axis, values };
}
