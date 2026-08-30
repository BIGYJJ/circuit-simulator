import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import type { EngineMetadata, RunningRunRecord, SimulationSnapshot, SimulationWorkerEvent } from "./contracts";
import { SimulationController } from "./simulation-controller";

const ENGINE: EngineMetadata = {
  name: "ngspice",
  version: "ngspice-46",
  resultTransport: "binary-rawfile",
  moduleSha256: "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93",
  wasmSha256: "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c",
  engineBuildId: "ngspice-46-emscripten-singlethread-256m-20260527",
  verifiedAt: "2026-08-31T00:00:00.000Z",
};

class FakeWorker {
  listeners: Array<(event: { data: SimulationWorkerEvent }) => void> = [];
  lastInit: { appBuildId: string; workerGeneration: number; requestId: string } | null = null;
  terminated = false;
  addEventListener(_type: string, listener: (event: { data: SimulationWorkerEvent }) => void) {
    this.listeners.push(listener);
  }
  postMessage(message: { type: string; appBuildId: string; workerGeneration: number; requestId: string }) {
    if (message.type === "initialize") this.lastInit = message;
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: SimulationWorkerEvent) {
    for (const listener of this.listeners) listener({ data });
  }
  emitReady() {
    if (!this.lastInit) throw new Error("initialize was not posted");
    this.emit({
      type: "ready",
      appBuildId: this.lastInit.appBuildId,
      workerGeneration: this.lastInit.workerGeneration,
      requestId: this.lastInit.requestId,
      engine: ENGINE,
    });
  }
  emitCompleted(snapshot: SimulationSnapshot) {
    if (!this.lastInit) throw new Error("initialize was not posted");
    this.emit({
      type: "completed",
      appBuildId: this.lastInit.appBuildId,
      workerGeneration: this.lastInit.workerGeneration,
      requestId: this.lastInit.requestId,
      runId: snapshot.runId,
      snapshot,
    });
  }
  emitInitializationFailed() {
    if (!this.lastInit) throw new Error("initialize was not posted");
    this.emit({
      type: "initialization-failed",
      appBuildId: this.lastInit.appBuildId,
      workerGeneration: this.lastInit.workerGeneration,
      requestId: this.lastInit.requestId,
      error: { code: "ADAPTER_INIT", message: "init failed", diagnostics: [], log: [], retryable: false },
    });
  }
  emitRunFailed(runId: string, code = "RESOURCE_LIMIT") {
    if (!this.lastInit) throw new Error("initialize was not posted");
    this.emit({
      type: "run-failed",
      appBuildId: this.lastInit.appBuildId,
      workerGeneration: this.lastInit.workerGeneration,
      requestId: this.lastInit.requestId,
      runId,
      error: { code, message: "run failed", diagnostics: [], log: [], retryable: false },
    });
  }
}

function snapshotFor(run: RunningRunRecord): SimulationSnapshot {
  return {
    schemaVersion: 1,
    appBuildId: run.appBuildId,
    runId: run.runId,
    projectId: run.projectId,
    projectRevision: run.projectRevision,
    electricalRevision: run.electricalRevision,
    analysisId: run.analysisId,
    analysis: run.analysis,
    analysisHash: run.analysisHash,
    netlistHash: run.netlistHash,
    vectorPlan: run.vectorPlan,
    vectorPlanHash: run.vectorPlanHash,
    engine: ENGINE,
    modelManifest: run.modelManifest,
    startedAt: run.startedAt,
    finishedAt: "2026-08-31T00:00:01.000Z",
    axes: [{ id: "axis", analysisId: run.analysisId, label: "index", unit: "index", values: new Float64Array([0]) }],
    vectors: [],
    diagnostics: [],
    log: [],
  };
}

function createControllerHarness(options: { timeoutMs?: number; heldLocks?: string[] } = {}) {
  const workers: FakeWorker[] = [];
  const ids = ["A", "B"];
  const locks = new Set<string>(options.heldLocks ?? []);
  const persist = new Map<string, unknown>();
  const runningWrites: string[] = [];
  const controller = new SimulationController({
    appBuildId: "verify-test",
    engine: ENGINE,
    timeoutMs: options.timeoutMs,
    createRunId: () => ids.shift() ?? crypto.randomUUID(),
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
    locks: {
      request: (async (name: string, options: LockOptions | LockGrantedCallback, callback?: LockGrantedCallback) => {
        const grant = typeof options === "function" ? options : callback;
        const opts = typeof options === "function" ? undefined : options;
        if (!grant) return undefined;
        if (opts?.ifAvailable && locks.has(String(name))) return grant(null);
        locks.add(String(name));
        try {
          return await grant({ name: String(name) } as Lock);
        } finally {
          locks.delete(String(name));
        }
      }) as LockManager["request"],
    },
    persistRunning: async run => {
      runningWrites.push(run.runId);
      persist.set(run.runId, run);
      return {
        ok: true,
        value: {
          envelopeVersion: 1 as const,
          storageVersion: 1,
          localAttempt: persist.size,
          immutableBaseHash: "0".repeat(64),
          record: run,
          listKey: [run.projectId, persist.size, run.startedAt, run.analysisId, run.status, "nominal", run.runId] as const,
        },
        diagnostics: [],
      };
    },
    persistTerminal: async record => {
      persist.set(record.runId, record);
      return {
        ok: true,
        value: {
          envelopeVersion: 1 as const,
          storageVersion: 2,
          localAttempt: 1,
          immutableBaseHash: "0".repeat(64),
          record,
          listKey: [record.projectId, 1, record.startedAt, record.analysisId, record.status, "nominal", record.runId] as const,
        },
        diagnostics: [],
      };
    },
  });
  return { controller, workers, persist, locks, runningWrites };
}

async function waitForWorker(workers: FakeWorker[], index: number) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (workers[index]?.lastInit) return workers[index]!;
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`worker ${index} was not created`);
}

function runInput(projectId = dividerProjectFixture().id) {
  const project = dividerProjectFixture();
  project.id = projectId;
  return { project, analysisId: project.analyses[0]!.id };
}

describe("SimulationController", () => {
  it("ignores A.completed after A is cancelled and B starts", async () => {
    const harness = createControllerHarness();
    const pendingA = harness.controller.run(runInput("proj-a"));
    const workerA = await waitForWorker(harness.workers, 0);
    workerA.emitReady();
    await harness.controller.cancel("user");
    const pendingB = harness.controller.run(runInput("proj-b"));
    const workerB = await waitForWorker(harness.workers, 1);
    workerB.emitReady();
    workerA.emitCompleted(snapshotFor(harness.persist.get("A") as RunningRunRecord));
    workerB.emitCompleted(snapshotFor(harness.persist.get("B") as RunningRunRecord));
    await expect(pendingA).resolves.toMatchObject({ runId: "A", status: "cancelled" });
    await expect(pendingB).resolves.toMatchObject({ runId: "B", status: "success" });
  });

  it("returns not-started when a second run is requested while one is active", async () => {
    const harness = createControllerHarness();
    const pendingA = harness.controller.run(runInput());
    const second = await harness.controller.run(runInput());
    expect(second).toMatchObject({ status: "not-started" });
    if (second.status === "not-started") expect(second.diagnostics[0]?.code).toBe("RUN_ALREADY_ACTIVE");
    const workerA = await waitForWorker(harness.workers, 0);
    workerA.emitReady();
    workerA.emitCompleted(snapshotFor(harness.persist.get("A") as RunningRunRecord));
    await pendingA;
  });

  it("returns not-started for a preflight blocker with zero workers or records", async () => {
    const harness = createControllerHarness();
    const result = await harness.controller.run({ project: dividerProjectFixture(), analysisId: "missing" });
    expect(result).toMatchObject({ status: "not-started" });
    if (result.status === "not-started") expect(result.diagnostics[0]?.code).toBe("RUN_ANALYSIS_MISMATCH");
    expect(harness.workers).toHaveLength(0);
    expect(harness.runningWrites).toHaveLength(0);
  });

  it("returns not-started when the run lock is unavailable", async () => {
    const harness = createControllerHarness({ heldLocks: ["fluxlab-run:A"] });
    const result = await harness.controller.run(runInput());
    expect(result).toMatchObject({ status: "not-started" });
    if (result.status === "not-started") expect(result.diagnostics[0]?.code).toBe("RUN_LOCK_UNAVAILABLE");
    expect(harness.workers).toHaveLength(0);
    expect(harness.runningWrites).toHaveLength(0);
  });

  it("discards the generation after initialization failure and allows a later run", async () => {
    const harness = createControllerHarness();
    const pendingA = harness.controller.run(runInput("proj-a"));
    const workerA = await waitForWorker(harness.workers, 0);
    workerA.emitInitializationFailed();
    await expect(pendingA).resolves.toMatchObject({ runId: "A", status: "failed" });
    expect(workerA.terminated).toBe(true);
    const pendingB = harness.controller.run(runInput("proj-b"));
    const workerB = await waitForWorker(harness.workers, 1);
    workerB.emitReady();
    workerB.emitCompleted(snapshotFor(harness.persist.get("B") as RunningRunRecord));
    await expect(pendingB).resolves.toMatchObject({ runId: "B", status: "success" });
  });

  it("times out the active generation", async () => {
    const harness = createControllerHarness({ timeoutMs: 20 });
    const pending = harness.controller.run(runInput());
    await waitForWorker(harness.workers, 0);
    await expect(pending).resolves.toMatchObject({ runId: "A", status: "timeout" });
    expect(harness.workers[0]?.terminated).toBe(true);
  });

  it("returns null on a second cancel and is idle-dispose idempotent", async () => {
    const harness = createControllerHarness();
    const pending = harness.controller.run(runInput());
    await waitForWorker(harness.workers, 0);
    const first = await harness.controller.cancel("user");
    expect(first).toMatchObject({ runId: "A", status: "cancelled" });
    expect(await harness.controller.cancel("user")).toBeNull();
    await pending;
    await harness.controller.dispose();
    await harness.controller.dispose();
  });

  it("starts a new generation after a resource failure", async () => {
    const harness = createControllerHarness();
    const pendingA = harness.controller.run(runInput("proj-a"));
    const workerA = await waitForWorker(harness.workers, 0);
    workerA.emitReady();
    workerA.emitRunFailed("A");
    await expect(pendingA).resolves.toMatchObject({ runId: "A", status: "failed" });
    const pendingB = harness.controller.run(runInput("proj-b"));
    const workerB = await waitForWorker(harness.workers, 1);
    workerB.emitReady();
    workerB.emitCompleted(snapshotFor(harness.persist.get("B") as RunningRunRecord));
    await expect(pendingB).resolves.toMatchObject({ runId: "B", status: "success" });
  });
});
