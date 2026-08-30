import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import type { AssertionDefinition, CornerDefinition } from "../domain/project/project-v2";
import { PINNED_ENGINE } from "./simulation-controller";
import {
  buildDeliveryGateInput,
  evaluateDeliveryGate,
  planAnalysisRuns,
  validateAssertionDraft,
  validateCornerDraft,
  type DeliveryGateInput,
  type GateSlotEvidence,
} from "./verification";

function passingSlot(runId = "run-nominal"): GateSlotEvidence["newest"] {
  return {
    runId,
    localAttempt: 1,
    status: "success",
    fresh: true,
    assertionSetHash: "hash",
    assertionStatus: "passed",
    evidenceOk: true,
  };
}

function gateFixture(input: { nominal: GateSlotEvidence["newest"]; corners: Array<GateSlotEvidence["newest"]> }): DeliveryGateInput {
  return {
    projectId: "proj-divider-v2",
    electricalRevision: 1,
    appBuildId: "verify-dev",
    analysisId: "an-op",
    analysisHash: "analysis",
    assertionSetHash: "hash",
    hasEnabledAssertions: true,
    modelHash: "models",
    engineBuildId: PINNED_ENGINE.engineBuildId,
    ercBlocking: false,
    slots: [{ cornerId: null, newest: input.nominal }, { cornerId: "c-low", newest: input.corners[0] ?? null }],
  };
}

describe("verification planning and gates", () => {
  it("blocks when nominal passes but an enabled corner is missing", () => {
    const result = evaluateDeliveryGate(gateFixture({ nominal: passingSlot(), corners: [] }));
    expect(result.status).toBe("blocked");
    expect(result.diagnostics[0]?.code).toBe("GATE_MISSING_CORNER_RUN");
  });

  it("blocks when no enabled assertions exist", () => {
    const input = gateFixture({ nominal: passingSlot(), corners: [passingSlot("run-corner")] });
    input.hasEnabledAssertions = false;
    const result = evaluateDeliveryGate(input);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics[0]?.code).toBe("GATE_NO_ENABLED_ASSERTIONS");
  });

  it("fails when evidence is complete but an assertion failed", () => {
    const corner = passingSlot("run-corner");
    corner!.assertionStatus = "failed";
    const result = evaluateDeliveryGate(gateFixture({ nominal: passingSlot(), corners: [corner] }));
    expect(result.status).toBe("failed");
    expect(result.diagnostics[0]?.code).toBe("GATE_ASSERTION_FAILED");
  });

  it("passes only when every slot is fresh and passed", () => {
    const result = evaluateDeliveryGate(gateFixture({ nominal: passingSlot(), corners: [passingSlot("run-corner")] }));
    expect(result.status).toBe("passed");
    expect(result.evidenceRunIds).toEqual(["run-nominal", "run-corner"]);
  });

  it("plans nominal first then enabled corners by id", () => {
    const project = dividerProjectFixture();
    project.corners = [
      { id: "c-high", name: "high", enabled: true, overrides: [{ kind: "component-parameter", componentId: "R2", path: "resistanceOhm", value: 2400 }] },
      { id: "c-low", name: "low", enabled: true, overrides: [{ kind: "component-parameter", componentId: "R2", path: "resistanceOhm", value: 1600 }] },
      { id: "c-off", name: "off", enabled: false, overrides: [{ kind: "component-parameter", componentId: "R2", path: "resistanceOhm", value: 1 }] },
    ];
    const planned = planAnalysisRuns(project, project.analyses[0]!.id);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value).toHaveLength(3);
    expect(planned.value[0]?.corner).toBeUndefined();
    expect(planned.value[1]?.corner?.definition.id).toBe("c-high");
    expect(planned.value[2]?.corner?.definition.id).toBe("c-low");
    expect(planned.value[1]?.project).toBe(project);
  });

  it("rejects a forged corner path without mutating the project", async () => {
    const project = dividerProjectFixture();
    const draft: CornerDefinition = {
      id: "c-forged",
      name: "forged",
      enabled: true,
      overrides: [{ kind: "component-parameter", componentId: "R2", path: "lengthM", value: 1 }],
    };
    const result = await validateCornerDraft(project, draft);
    expect(result.ok).toBe(false);
    expect(project.corners).toHaveLength(0);
  });

  it("rejects an assertion whose analysis is missing", async () => {
    const project = dividerProjectFixture();
    const draft = {
      ...project.assertions[0]!,
      id: "assert-forged",
      analysisId: "missing",
    } satisfies AssertionDefinition;
    const result = await validateAssertionDraft(project, draft);
    expect(result.ok).toBe(false);
  });

  it("selects the greatest localAttempt even when timestamps roll back", async () => {
    const project = dividerProjectFixture();
    const analysis = project.analyses[0]!;
    const older = {
      localAttempt: 2,
      record: {
        schemaVersion: 1 as const,
        appBuildId: "verify-dev",
        runId: "run-old",
        projectId: project.id,
        projectRevision: 1,
        electricalRevision: 1,
        analysisId: analysis.id,
        analysis,
        analysisHash: "x",
        requestedAssertions: [],
        requestedAssertionSetHash: "0".repeat(64),
        netlistHash: "x",
        vectorPlan: [],
        vectorPlanHash: "x",
        requestedEngine: PINNED_ENGINE,
        modelManifest: [],
        inputBundle: { netlist: "", models: [], sourceMap: { lineToComponent: {}, componentToLines: {}, endpointToNode: {}, nodeToEndpoints: {} } },
        startedAt: "2026-08-31T12:00:00.000Z",
        preflightDiagnostics: [],
        status: "success" as const,
        finishedAt: "2026-08-31T12:00:01.000Z",
        snapshot: {
          schemaVersion: 1 as const,
          appBuildId: "verify-dev",
          runId: "run-old",
          projectId: project.id,
          projectRevision: 1,
          electricalRevision: 1,
          analysisId: analysis.id,
          analysis,
          analysisHash: "x",
          netlistHash: "x",
          vectorPlan: [],
          vectorPlanHash: "x",
          engine: { ...PINNED_ENGINE, verifiedAt: "2026-08-31T00:00:00.000Z" },
          modelManifest: [],
          startedAt: "2026-08-31T12:00:00.000Z",
          finishedAt: "2026-08-31T12:00:01.000Z",
          axes: [],
          vectors: [],
          diagnostics: [],
          log: [],
        },
        assertionEvaluations: [],
      },
    };
    const newerFailed = {
      ...older,
      localAttempt: 3,
      record: {
        ...older.record,
        runId: "run-new-fail",
        startedAt: "2026-08-31T11:00:00.000Z",
        status: "failed" as const,
        finishedAt: "2026-08-31T11:00:01.000Z",
        failure: { code: "ADAPTER_EXIT", message: "failed", diagnostics: [], log: [], retryable: false },
      },
    };
    delete (newerFailed.record as { snapshot?: unknown }).snapshot;
    delete (newerFailed.record as { assertionEvaluations?: unknown }).assertionEvaluations;
    const built = await buildDeliveryGateInput(project, analysis, PINNED_ENGINE, [older, newerFailed], []);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.slots[0]?.newest?.runId).toBe("run-new-fail");
    expect(built.value.slots[0]?.newest?.status).toBe("failed");
    const evaluated = evaluateDeliveryGate({
      ...built.value,
      hasEnabledAssertions: true,
      slots: [
        { cornerId: null, newest: built.value.slots[0]!.newest },
      ],
    });
    expect(evaluated.status).toBe("blocked");
    expect(evaluated.diagnostics.some(item => item.code === "GATE_TERMINAL_NOT_SUCCESS")).toBe(true);
  });

  it("blocks a changed app build even when electrical revision is unchanged", () => {
    const slot = passingSlot();
    const input = gateFixture({ nominal: slot, corners: [passingSlot("run-corner")] });
    input.appBuildId = "other-build";
    slot!.fresh = false;
    const result = evaluateDeliveryGate(input);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics.some(item => item.code === "GATE_STALE_RUN")).toBe(true);
  });
});
