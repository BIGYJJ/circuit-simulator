import {
  PINNED_ENGINE_BUILD_ID,
  PINNED_MODULE_SHA256,
  PINNED_VERSION,
  PINNED_WASM_SHA256,
  createNgspiceRuntimeAdapter,
} from "./ngspice-adapter";
import { parseAdapterResult } from "./result-parser";
import { APP_BUILD_ID } from "../app/build-info";
import wasmUrl from "../../../vendor/ngspice/ngspice.wasm?url";
import type { SimulationWorkerEvent, SimulationWorkerRequest } from "./contracts";

const adapter = createNgspiceRuntimeAdapter();
let engine: Awaited<ReturnType<typeof adapter.initialize>> | undefined;

function post(event: SimulationWorkerEvent, transfer: Transferable[] = []) {
  const scope = self as unknown as { postMessage: (message: unknown, options?: { transfer?: Transferable[] }) => void };
  scope.postMessage(event, transfer.length ? { transfer } : undefined);
}

function failure(code: string, message: string) {
  return { code, message, diagnostics: [{ severity: "error" as const, code, message, blocksRun: true }], log: [], retryable: false };
}

self.onmessage = async (event: MessageEvent<SimulationWorkerRequest>) => {
  const message = event.data;
  if (message.appBuildId !== APP_BUILD_ID) {
    if (message.type === "initialize") {
      post({
        type: "initialization-failed",
        appBuildId: message.appBuildId,
        workerGeneration: message.workerGeneration,
        requestId: message.requestId,
        error: failure("ENGINE_BUILD_MISMATCH", "worker appBuildId does not match the compiled identity"),
      });
    } else {
      post({
        type: "run-failed",
        appBuildId: message.appBuildId,
        workerGeneration: message.workerGeneration,
        requestId: message.requestId,
        runId: message.run.runId,
        error: failure("ENGINE_BUILD_MISMATCH", "worker appBuildId does not match the compiled identity"),
      });
    }
    return;
  }
  if (message.type === "initialize") {
    try {
      engine = await adapter.initialize({
        wasmUrl,
        expectedResultTransport: "binary-rawfile",
        expectedModuleSha256: PINNED_MODULE_SHA256,
        expectedWasmSha256: PINNED_WASM_SHA256,
        expectedVersion: PINNED_VERSION,
        expectedEngineBuildId: PINNED_ENGINE_BUILD_ID,
      });
      post({
        type: "ready",
        appBuildId: message.appBuildId,
        workerGeneration: message.workerGeneration,
        requestId: message.requestId,
        engine,
      });
    } catch (error) {
      const structured = error && typeof error === "object" && "failure" in error ? (error as { failure: ReturnType<typeof failure> }).failure : failure("ADAPTER_INIT", error instanceof Error ? error.message : "initialize failed");
      post({
        type: "initialization-failed",
        appBuildId: message.appBuildId,
        workerGeneration: message.workerGeneration,
        requestId: message.requestId,
        error: structured,
      });
    }
    return;
  }
  try {
    if (!engine) throw new Error("worker is not initialized");
    if (message.run.corner && JSON.stringify(message.run.corner) !== JSON.stringify(message.run.compiled.appliedCorner)) {
      throw Object.assign(new Error("corner mismatch"), { failure: failure("RUN_CORNER_MISMATCH", "run.corner is not the compiled applied corner") });
    }
    const manifest = message.run.compiled.modelManifest;
    if (
      message.run.models.length !== manifest.length ||
      message.run.models.some((model, index) => {
        const entry = manifest[index];
        return !entry || entry.modelId !== model.modelId || entry.sha256 !== model.sha256 || entry.generatedName !== model.generatedName;
      })
    ) {
      throw Object.assign(new Error("model mismatch"), { failure: failure("MODEL_MANIFEST_MISMATCH", "run.models do not match the compiled manifest") });
    }
    post({
      type: "progress",
      appBuildId: message.appBuildId,
      workerGeneration: message.workerGeneration,
      requestId: message.requestId,
      runId: message.run.runId,
      phase: "running",
    });
    const adapterResult = await adapter.runBatch({
      netlistUtf8: new TextEncoder().encode(message.run.compiled.netlist),
      modelFiles: message.run.models,
      requestedVectors: message.run.compiled.requestedRawVectors,
      limits: {
        maxWasmHeapBytes: 256 * 1024 * 1024,
        maxVirtualFsBytes: 32 * 1024 * 1024,
        maxLogBytes: 1024 * 1024,
        maxResultPoints: 2_000_000,
        maxSingleVectorBytes: 16 * 1024 * 1024,
        maxRawResultBytes: 64 * 1024 * 1024,
        maxSnapshotTransferBytes: 64 * 1024 * 1024,
        maxExpandedNetlistBytes: 16 * 1024 * 1024,
      },
    });
    const startedAt = new Date().toISOString();
    const finishedAt = startedAt;
    const snapshot = await parseAdapterResult({
      run: message.run,
      adapterResult,
      engine,
      startedAt,
      finishedAt,
    });
    if (!snapshot.ok) {
      post({
        type: "run-failed",
        appBuildId: message.appBuildId,
        workerGeneration: message.workerGeneration,
        requestId: message.requestId,
        runId: message.run.runId,
        error: failure(snapshot.diagnostics[0]?.code ?? "RESULT_INVALID", snapshot.diagnostics[0]?.message ?? "result parse failed"),
      });
      return;
    }
    const transfer = [...new Set([snapshot.value.axes[0]?.values.buffer, ...snapshot.value.vectors.map(item => item.values.buffer)].filter((item): item is ArrayBuffer => Boolean(item)))];
    post(
      {
        type: "completed",
        appBuildId: message.appBuildId,
        workerGeneration: message.workerGeneration,
        requestId: message.requestId,
        runId: message.run.runId,
        snapshot: snapshot.value,
      },
      transfer
    );
  } catch (error) {
    const structured = error && typeof error === "object" && "failure" in error ? (error as { failure: ReturnType<typeof failure> }).failure : failure("ADAPTER_EXIT", error instanceof Error ? error.message : "run failed");
    post({
      type: "run-failed",
      appBuildId: message.appBuildId,
      workerGeneration: message.workerGeneration,
      requestId: message.requestId,
      runId: message.run.runId,
      error: structured,
    });
  }
};
