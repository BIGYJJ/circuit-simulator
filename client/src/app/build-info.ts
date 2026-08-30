declare const __FLUXLAB_APP_BUILD_ID__: string;
declare const __FLUXLAB_NON_RELEASE_BUILD__: boolean;

export const APP_BUILD_ID = typeof __FLUXLAB_APP_BUILD_ID__ === "string" ? __FLUXLAB_APP_BUILD_ID__ : "verify-dev";
export const NON_RELEASE_BUILD = typeof __FLUXLAB_NON_RELEASE_BUILD__ === "boolean" ? __FLUXLAB_NON_RELEASE_BUILD__ : true;

export function createProductSimulatorWorker() {
  if (typeof window !== "undefined") {
    const current = window as Window & { __fluxlabWorkerCreations?: number };
    current.__fluxlabWorkerCreations = (current.__fluxlabWorkerCreations ?? 0) + 1;
  }
  return new Worker(new URL("../simulation/simulator.worker.ts", import.meta.url), { type: "module" });
}
