import { parseCircuitProjectV2 } from "../domain/project/project-schema";
import type { AnalysisId, CircuitProjectV2, CornerDefinition, Diagnostic, DomainResult } from "../domain/project/project-v2";
import { bundledManifestForValidation } from "../domain/project/bundled-models";
import { APP_BUILD_ID, createProductSimulatorWorker } from "../app/build-info";
import { compileNetlist, hashAnalysisDefinition, requestedRawVectorsFromPlan } from "./compile-netlist";
import type {
  EngineFingerprint,
  EngineMetadata,
  RunRecord,
  RunningRunRecord,
  SimulationSnapshot,
  SimulationWorkerEvent,
  SuccessfulRunRecord,
} from "./contracts";
import { evaluateCapturedAssertionSet } from "./measurements";
import {
  PINNED_ENGINE_BUILD_ID,
  PINNED_MODULE_SHA256,
  PINNED_VERSION,
  PINNED_WASM_SHA256,
} from "./ngspice-adapter";
import { DEFAULT_RUN_POLICY, estimateRunResources } from "./resource-estimator";
import {
  buildRunningRecordForProject,
  createCompletedRunCandidate,
  finishRunCancelled,
  finishRunFailure,
  finishRunSuccess,
  finishRunTimeout,
} from "./run-record";
import { validateProjectModels } from "./spice-source-parser";
import { createRunningRun, finishRun } from "../storage/indexeddb";

export type SimulationNotStarted = {
  status: "not-started";
  diagnostics: Diagnostic[];
};

export interface SimulationRunInput {
  project: CircuitProjectV2;
  analysisId: AnalysisId;
  corner?: { definition: CornerDefinition; ordinal: number; total: number };
}

export interface SimulationControllerOptions {
  appBuildId?: string;
  engine?: EngineFingerprint;
  createWorker?: () => Worker;
  now?: () => string;
  timeoutMs?: number;
  locks?: Pick<LockManager, "request">;
  persistRunning?: typeof createRunningRun;
  persistTerminal?: typeof finishRun;
  createRunId?: () => string;
}

type ActiveTuple = {
  generation: number;
  requestId: string;
  runId: string;
  worker: Worker;
  running: RunningRunRecord;
  resolve: (record: RunRecord | SimulationNotStarted) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  claimed?: "completed" | "cancelled" | "timeout" | "failed";
  releaseLock?: () => void;
};

function blocker(code: string, message: string): Diagnostic {
  return { severity: "error", code, message, blocksRun: true };
}

function notStarted(diagnostics: Diagnostic[]): SimulationNotStarted {
  return { status: "not-started", diagnostics };
}

export const PINNED_ENGINE: EngineFingerprint = {
  name: "ngspice",
  version: PINNED_VERSION,
  resultTransport: "binary-rawfile",
  moduleSha256: PINNED_MODULE_SHA256,
  wasmSha256: PINNED_WASM_SHA256,
  engineBuildId: PINNED_ENGINE_BUILD_ID,
};

export class SimulationController {
  private generation = 0;
  private active: ActiveTuple | null = null;
  private busy = false;
  private readonly options: Required<Pick<SimulationControllerOptions, "appBuildId" | "now" | "timeoutMs">> & SimulationControllerOptions;

  constructor(options: SimulationControllerOptions = {}) {
    this.options = {
      appBuildId: options.appBuildId ?? APP_BUILD_ID,
      engine: options.engine ?? PINNED_ENGINE,
      createWorker: options.createWorker,
      now: options.now ?? (() => new Date().toISOString()),
      timeoutMs: options.timeoutMs ?? DEFAULT_RUN_POLICY.timeoutMs,
      locks: options.locks,
      persistRunning: options.persistRunning ?? createRunningRun,
      persistTerminal: options.persistTerminal ?? finishRun,
      createRunId: options.createRunId,
    };
  }

  async run(input: SimulationRunInput): Promise<RunRecord | SimulationNotStarted> {
    if (this.busy || this.active) {
      return notStarted([blocker("RUN_ALREADY_ACTIVE", "another run already owns this controller")]);
    }
    this.busy = true;
    try {
      const preflight = await this.preflight(input);
      if (!preflight.ok) {
        this.busy = false;
        return notStarted(preflight.diagnostics);
      }
      const lock = await this.acquireLock(preflight.value.runId);
      if (!lock.ok) {
        this.busy = false;
        return notStarted(lock.diagnostics);
      }
      const persisted = await (this.options.persistRunning ?? createRunningRun)(preflight.value);
      if (!persisted.ok) {
        lock.value.release();
        this.busy = false;
        return notStarted(persisted.diagnostics);
      }
      const worker = this.options.createWorker ? this.options.createWorker() : createProductSimulatorWorker();
      this.generation += 1;
      const requestId = crypto.randomUUID();
      return await new Promise<RunRecord | SimulationNotStarted>(resolve => {
        const tuple: ActiveTuple = {
          generation: this.generation,
          requestId,
          runId: preflight.value.runId,
          worker,
          running: persisted.value.record as RunningRunRecord,
          resolve,
          releaseLock: lock.value.release,
        };
        this.active = tuple;
        worker.addEventListener("message", event => {
          void this.onWorkerEvent(event.data as SimulationWorkerEvent);
        });
        worker.postMessage({
          type: "initialize",
          appBuildId: this.options.appBuildId,
          workerGeneration: tuple.generation,
          requestId,
        });
        tuple.timeoutId = setTimeout(() => {
          void this.claimTerminal("timeout");
        }, this.options.timeoutMs);
      });
    } catch (error) {
      this.busy = false;
      return notStarted([blocker("RUN_CONTROLLER", error instanceof Error ? error.message : "run failed to start")]);
    }
  }

  async cancel(reason: "user" | "project-changed"): Promise<RunRecord | null> {
    if (!this.active || this.active.claimed) return null;
    return this.claimTerminal("cancelled", reason);
  }

  async dispose(): Promise<void> {
    if (this.active && !this.active.claimed) {
      await this.claimTerminal("cancelled", "project-changed");
      return;
    }
    this.active?.worker.terminate();
    this.active = null;
    this.busy = false;
  }

  private async preflight(input: SimulationRunInput): Promise<DomainResult<RunningRunRecord>> {
    const parsed = parseCircuitProjectV2(input.project);
    if (!parsed.ok) return parsed;
    const models = await validateProjectModels(parsed.value, "stored-model", await bundledManifestForValidation());
    if (!models.ok) return models;
    const analysis = parsed.value.analyses.find(item => item.id === input.analysisId);
    if (!analysis) return { ok: false, diagnostics: [blocker("RUN_ANALYSIS_MISMATCH", "analysis is not on the project")] };
    await hashAnalysisDefinition(analysis);
    const compiled = await compileNetlist({
      project: parsed.value,
      analysis,
      ...(input.corner ? { corner: input.corner } : {}),
    });
    if (!compiled.ok) return compiled;
    const estimate = estimateRunResources({
      project: parsed.value,
      analysis,
      compiled: compiled.value,
      resultTransport: "binary-rawfile",
      modelSources: parsed.value.models.map(model => ({
        generatedName: `model-${model.sha256}.lib`,
        sha256: model.sha256,
        source: model.source,
      })),
    });
    if (!estimate.ok) return estimate;
    return buildRunningRecordForProject({
      project: parsed.value,
      analysisId: analysis.id,
      runId: this.options.createRunId?.() ?? crypto.randomUUID(),
      appBuildId: this.options.appBuildId,
      engine: this.options.engine ?? PINNED_ENGINE,
      startedAt: this.options.now(),
      compiled: compiled.value,
    });
  }

  private async acquireLock(runId: string): Promise<DomainResult<{ release: () => void }>> {
    const locks = this.options.locks ?? (typeof navigator !== "undefined" ? navigator.locks : undefined);
    if (!locks?.request) return { ok: false, diagnostics: [blocker("RUN_LOCK_UNAVAILABLE", "Web Locks are unavailable")] };
    return new Promise(resolve => {
      let settled = false;
      void locks.request(`fluxlab-run:${runId}`, { mode: "exclusive", ifAvailable: true }, async lock => {
        if (!lock) {
          if (!settled) {
            settled = true;
            resolve({ ok: false, diagnostics: [blocker("RUN_LOCK_UNAVAILABLE", "the run lock is held elsewhere")] });
          }
          return;
        }
        await new Promise<void>(release => {
          if (!settled) {
            settled = true;
            resolve({ ok: true, value: { release }, diagnostics: [] });
          }
        });
      });
    });
  }

  private matches(event: SimulationWorkerEvent) {
    const tuple = this.active;
    if (!tuple) return false;
    if (event.appBuildId !== this.options.appBuildId || event.workerGeneration !== tuple.generation || event.requestId !== tuple.requestId) {
      return false;
    }
    if ("runId" in event && event.runId !== tuple.runId) return false;
    return true;
  }

  private async onWorkerEvent(event: SimulationWorkerEvent) {
    if (!this.matches(event) || !this.active || this.active.claimed) return;
    if (event.type === "ready") {
      this.active.running = { ...this.active.running, verifiedEngine: event.engine };
      this.active.worker.postMessage({
        type: "run",
        appBuildId: this.options.appBuildId,
        workerGeneration: this.active.generation,
        requestId: this.active.requestId,
        run: {
          appBuildId: this.options.appBuildId,
          runId: this.active.runId,
          projectId: this.active.running.projectId,
          projectRevision: this.active.running.projectRevision,
          electricalRevision: this.active.running.electricalRevision,
          analysisHash: this.active.running.analysisHash,
          requestedAssertionSetHash: this.active.running.requestedAssertionSetHash,
          analysis: this.active.running.analysis,
          corner: this.active.running.corner,
          compiled: {
            netlist: this.active.running.inputBundle.netlist,
            netlistHash: this.active.running.netlistHash,
            diagnostics: [],
            sourceMap: this.active.running.inputBundle.sourceMap,
            modelManifest: this.active.running.modelManifest,
            vectorPlan: this.active.running.vectorPlan,
            vectorPlanHash: this.active.running.vectorPlanHash,
            requestedRawVectors: requestedRawVectorsFromPlan(this.active.running.vectorPlan),
            appliedCorner: this.active.running.corner,
          },
          models: this.active.running.inputBundle.models,
        },
      });
      return;
    }
    if (event.type === "initialization-failed") {
      await this.claimTerminal("failed", undefined, event.error);
      return;
    }
    if (event.type === "completed") {
      await this.claimTerminal("completed", undefined, undefined, undefined, event.snapshot);
      return;
    }
    if (event.type === "run-failed") {
      await this.claimTerminal("failed", undefined, event.error);
    }
  }

  private async claimTerminal(
    kind: "completed" | "cancelled" | "timeout" | "failed",
    reason: "user" | "project-changed" = "user",
    failure?: { code: string; message: string; diagnostics: Diagnostic[]; log: string[]; retryable: boolean },
    engine?: EngineMetadata,
    snapshot?: SimulationSnapshot
  ): Promise<RunRecord | null> {
    const tuple = this.active;
    if (!tuple || tuple.claimed) return null;
    tuple.claimed = kind;
    if (tuple.timeoutId) clearTimeout(tuple.timeoutId);
    this.generation += 1;
    tuple.worker.terminate();
    const finishedAt = this.options.now();
    let terminal: DomainResult<RunRecord>;
    if (kind === "cancelled") terminal = finishRunCancelled(tuple.running, finishedAt, reason);
    else if (kind === "timeout") terminal = finishRunTimeout(tuple.running, finishedAt, this.options.timeoutMs);
    else if (kind === "completed" && snapshot) {
      const aligned = { ...snapshot, startedAt: tuple.running.startedAt, finishedAt };
      const candidate = createCompletedRunCandidate(tuple.running, aligned, finishedAt);
      if (!candidate.ok) terminal = candidate;
      else {
        const evaluation = await evaluateCapturedAssertionSet({ candidate: candidate.value, evaluatedAt: finishedAt });
        terminal = evaluation.ok ? finishRunSuccess(candidate.value, evaluation.value) : evaluation;
      }
    } else {
      terminal = finishRunFailure(tuple.running, finishedAt, failure ?? {
        code: "RUN_FAILED",
        message: "the worker failed",
        diagnostics: [],
        log: [],
        retryable: false,
      });
    }
    if (terminal.ok) {
      await (this.options.persistTerminal ?? finishRun)(terminal.value as Exclude<RunRecord, { status: "running" }>);
    }
    tuple.releaseLock?.();
    this.active = null;
    this.busy = false;
    const fallback = finishRunFailure(tuple.running, finishedAt, {
      code: terminal.ok ? "RUN_TERMINAL" : terminal.diagnostics[0]?.code ?? "RUN_TERMINAL",
      message: terminal.ok ? "terminal persistence failed" : terminal.diagnostics[0]?.message ?? "terminal persistence failed",
      diagnostics: terminal.ok ? [] : terminal.diagnostics,
      log: [],
      retryable: false,
    });
    const result = terminal.ok ? terminal.value : fallback.ok ? fallback.value : tuple.running;
    tuple.resolve(result as RunRecord);
    void engine;
    return result as RunRecord;
  }
}

export type { SuccessfulRunRecord };
