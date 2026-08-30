const WASM_SHA256 =
  "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c";

function createEngineWorker() {
  return new Worker(
    new URL("../../vendor/ngspice/qualification/qualification.worker.ts", import.meta.url),
    { type: "module" }
  );
}

function requestWorker<T>(worker: Worker, message: unknown) {
  return new Promise<T>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent) => {
      if (event.data?.type === "qualification-complete") resolve(event.data.result);
      else
        reject(
          new Error(
            `${event.data?.code ?? "failed"}: ${event.data?.message ?? "no message"}`
          )
        );
    };
    worker.onerror = event => reject(event.error ?? new Error(event.message));
    worker.postMessage(message);
  });
}

async function webLocksAvailable() {
  if (!navigator.locks?.request) return false;
  let granted = false;
  await navigator.locks.request("fluxlab-qualification", { ifAvailable: true }, async lock => {
    granted = !!lock;
  });
  return granted;
}

const businessRequests: string[] = [];
const origFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
  if (url.origin !== location.origin) businessRequests.push(url.href);
  return origFetch(input, init);
};

async function qualify() {
  const locks = webLocksAvailable();
  const worker = createEngineWorker();
  const result = await requestWorker<Record<string, unknown>>(worker, {
    type: "run-qualification",
    wasmSha256: WASM_SHA256,
  });
  worker.terminate();

  const longWorker = createEngineWorker();
  longWorker.postMessage({ type: "run-long" });
  longWorker.terminate();
  const started = performance.now();
  const rebuilt = createEngineWorker();
  await requestWorker(rebuilt, { type: "ready" });
  const cancelReadyMs = performance.now() - started;
  const divider = await requestWorker<{ dividerVout: number }>(rebuilt, {
    type: "run-divider",
  });
  if (Math.abs(divider.dividerVout - 6) > 1e-6) {
    throw new Error("rebuilt worker divider failed");
  }
  rebuilt.terminate();

  return {
    ...result,
    cancelledWorkerRebuilt: true,
    webLocksAvailable: await locks,
    cancelReadyMs,
    businessRequests,
  } as QualificationResult;
}

window.__qualificationResult = qualify()
  .then(result => {
    document.body.dataset.qualification = "done";
    return result;
  })
  .catch(error => {
    document.body.dataset.qualification = "failed";
    document.body.dataset.qualificationError = String(error);
    throw error;
  });
