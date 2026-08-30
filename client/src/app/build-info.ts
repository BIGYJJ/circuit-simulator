declare const __FLUXLAB_APP_BUILD_ID__: string;
declare const __FLUXLAB_NON_RELEASE_BUILD__: boolean;
declare const __FLUXLAB_NON_RELEASE_FIXTURE__: boolean;
declare const __FLUXLAB_ENGINE_BUILD_ID__: string;
declare const __FLUXLAB_ENGINE_VERSION__: string;
declare const __FLUXLAB_RESULT_TRANSPORT__: string;
declare const __FLUXLAB_MODULE_SHA256__: string;
declare const __FLUXLAB_WASM_SHA256__: string;

export const APP_BUILD_ID = typeof __FLUXLAB_APP_BUILD_ID__ === "string" ? __FLUXLAB_APP_BUILD_ID__ : "verify-dev";
export const NON_RELEASE_BUILD = typeof __FLUXLAB_NON_RELEASE_BUILD__ === "boolean" ? __FLUXLAB_NON_RELEASE_BUILD__ : true;
export const NON_RELEASE_FIXTURE = typeof __FLUXLAB_NON_RELEASE_FIXTURE__ === "boolean" ? __FLUXLAB_NON_RELEASE_FIXTURE__ : false;
export const ENGINE_BUILD_ID = typeof __FLUXLAB_ENGINE_BUILD_ID__ === "string" ? __FLUXLAB_ENGINE_BUILD_ID__ : "";
export const ENGINE_VERSION = typeof __FLUXLAB_ENGINE_VERSION__ === "string" ? __FLUXLAB_ENGINE_VERSION__ : "";
export const RESULT_TRANSPORT = typeof __FLUXLAB_RESULT_TRANSPORT__ === "string" ? __FLUXLAB_RESULT_TRANSPORT__ : "binary-rawfile";
export const MODULE_SHA256 = typeof __FLUXLAB_MODULE_SHA256__ === "string" ? __FLUXLAB_MODULE_SHA256__ : "";
export const WASM_SHA256 = typeof __FLUXLAB_WASM_SHA256__ === "string" ? __FLUXLAB_WASM_SHA256__ : "";

export function createProductSimulatorWorker() {
  if (typeof window !== "undefined") {
    const current = window as Window & { __fluxlabWorkerCreations?: number };
    current.__fluxlabWorkerCreations = (current.__fluxlabWorkerCreations ?? 0) + 1;
  }
  return new Worker(new URL("../simulation/simulator.worker.ts", import.meta.url), { type: "module" });
}

if (typeof window !== "undefined") {
  const host = window as Window & { __fluxlabAppBuildId?: string; __fluxlabEngineBuildId?: string };
  host.__fluxlabAppBuildId = APP_BUILD_ID;
  host.__fluxlabEngineBuildId = ENGINE_BUILD_ID;
}
