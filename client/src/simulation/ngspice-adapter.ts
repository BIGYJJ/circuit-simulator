import createNgspiceModuleRaw from "../../../vendor/ngspice/ngspice.mjs";
import wasmUrl from "../../../vendor/ngspice/ngspice.wasm?url";
import transportJson from "../../../vendor/ngspice/RESULT_TRANSPORT.json";
import qualifiedVectors from "../../../vendor/ngspice/QUALIFIED_VECTORS.json";
import qualifiedVectorsText from "../../../vendor/ngspice/QUALIFIED_VECTORS.json?raw";
import versionText from "../../../vendor/ngspice/VERSION?raw";
import { sha256Hex } from "../domain/project/canonical";
import type { Diagnostic, DomainResult } from "../domain/project/project-v2";
import type {
  AdapterResult,
  CompiledModelFile,
  EngineMetadata,
  NgspiceRuntimeAdapter,
  ResultTransport,
  SimulationFailure,
} from "./contracts";
import { parseAndValidateSpiceSource } from "./spice-source-parser";
import { parseQualifiedVectorManifest, resolveQualifiedVector } from "./qualified-vectors.mjs";

const createNgspiceModule = createNgspiceModuleRaw as (options?: Record<string, unknown>) => Promise<NgspiceModule>;

export const PINNED_MODULE_SHA256 = "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93";
export const PINNED_WASM_SHA256 = "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c";
export const PINNED_VECTORS_SHA256 = "e15c42aa7f2fbe494c5b740fb84ddc8e9425ccd1f7d448e9855b7b390f941fef";
export const PINNED_VERSION = versionText.split(/\r?\n/)[0]!.trim();
export const PINNED_ENGINE_BUILD_ID = /engineBuildId=(\S+)/.exec(versionText)?.[1] ?? "";

const MODEL_FILE_RE = /^model-[a-f0-9]{64}\.lib$/;

type NgspiceModule = {
  wasmMemory?: { buffer: ArrayBuffer };
  HEAPU8?: Uint8Array;
  HEAPU32?: Uint32Array;
  FS: {
    mkdir: (path: string) => void;
    writeFile: (path: string, data: string | Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    readdir: (path: string) => string[];
    unlink: (path: string) => void;
    cwd?: string;
    chdir?: (path: string) => void;
  };
  callMain?: (args: string[]) => number;
  _main?: (argc: number, argv: number) => number;
  stackSave?: () => number;
  stackAlloc?: (bytes: number) => number;
  stackRestore?: (pointer: number) => void;
  stringToUTF8OnStack?: (value: string) => number;
};

export interface VerifiedModelFile {
  modelId: string;
  sha256: string;
  generatedName: string;
  utf8: Uint8Array;
}

export class AdapterRuntimeError extends Error {
  readonly failure: SimulationFailure;
  constructor(failure: SimulationFailure) {
    super(failure.message);
    this.name = "AdapterRuntimeError";
    this.failure = failure;
  }
}

function failure(code: string, message: string, diagnostics: Diagnostic[] = [], retryable = false): SimulationFailure {
  return { code, message, diagnostics, log: [], retryable };
}

function blocker(code: string, message: string, location?: Diagnostic["location"]): Diagnostic {
  return { severity: "error", code, message, blocksRun: true, location };
}

export async function verifyCompiledModelFiles(
  manifest: CompiledModelFile[],
  models: Array<CompiledModelFile & { source: string }>
): Promise<DomainResult<VerifiedModelFile[]>> {
  const verified: VerifiedModelFile[] = [];
  for (const model of models) {
    const parsed = await parseAndValidateSpiceSource(model.source, "stored-model", "opaque-model");
    if (!parsed.ok) return parsed;
    if (parsed.value.sha256 !== model.sha256) {
      return { ok: false, diagnostics: [blocker("MODEL_HASH_MISMATCH", "model source hash does not match", { modelId: model.modelId })] };
    }
    const entry = manifest.find(item => item.modelId === model.modelId);
    if (!entry || entry.sha256 !== model.sha256 || entry.generatedName !== model.generatedName) {
      return { ok: false, diagnostics: [blocker("MODEL_MANIFEST_MISMATCH", "model is not an exact compiled manifest entry", { modelId: model.modelId })] };
    }
    if (!MODEL_FILE_RE.test(model.generatedName) || model.generatedName !== `model-${model.sha256}.lib`) {
      return { ok: false, diagnostics: [blocker("MODEL_BAD_FILENAME", "generated model name is not compiler-owned", { modelId: model.modelId })] };
    }
    verified.push({
      modelId: model.modelId,
      sha256: model.sha256,
      generatedName: model.generatedName,
      utf8: new TextEncoder().encode(parsed.value.normalizedSource ?? model.source),
    });
  }
  return { ok: true, value: verified, diagnostics: [] };
}

function parseRawfile(bytes: Uint8Array) {
  const text = new TextDecoder("latin1").decode(bytes);
  const marker = text.includes("Binary:\r\n") ? "Binary:\r\n" : "Binary:\n";
  const split = text.indexOf(marker);
  if (split < 0) throw new AdapterRuntimeError(failure("ADAPTER_RAWFILE", "rawfile missing Binary header"));
  const header = text.slice(0, split);
  const names = [...header.matchAll(/\t\d+\t([^\t]+)\t/g)].map(match => {
    const lower = match[1]!.toLowerCase();
    const wrapped = /^i\((@.+)\)$/.exec(lower);
    return wrapped ? wrapped[1]! : lower;
  });
  const complex = /Flags:\s*complex/i.test(header);
  const data = bytes.subarray(split + marker.length);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const stride = names.length * (complex ? 2 : 1);
  const points = Math.floor(data.byteLength / 8 / stride);
  const vectors = names.map(name => ({
    name,
    real: new Float64Array(points),
    imaginary: complex ? new Float64Array(points) : undefined,
  }));
  let offset = 0;
  for (let point = 0; point < points; point += 1) {
    for (let index = 0; index < names.length; index += 1) {
      const current = vectors[index];
      if (!current) continue;
      current.real[point] = view.getFloat64(offset, true);
      offset += 8;
      if (complex && current.imaginary) {
        current.imaginary[point] = view.getFloat64(offset, true);
        offset += 8;
      }
    }
  }
  return { vectors, rawfileFsBytes: bytes.byteLength };
}

function estimateHeader(names: string[]) {
  const estimator = transportJson.rawfileHeaderEstimator;
  const nameBytes = names.reduce((sum, name) => sum + new TextEncoder().encode(name).byteLength, 0);
  return estimator.fixedBytes + names.length * estimator.perVariableBytes + nameBytes * estimator.perVariableNameUtf8Byte + estimator.safetyBytes;
}

function exitStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as { name?: string; status?: unknown };
  if (record.name === "ExitStatus" || typeof record.status === "number") {
    return Number(record.status ?? 1);
  }
  return undefined;
}

function invokeMain(module: NgspiceModule, args: string[]) {
  if (module._main && module.stackSave && module.stackAlloc && module.stackRestore && module.stringToUTF8OnStack && module.HEAPU32) {
    const argv = ["ngspice", ...args];
    const stack = module.stackSave();
    const argvPtr = module.stackAlloc((argv.length + 1) * 4);
    argv.forEach((arg, index) => {
      module.HEAPU32![(argvPtr >> 2) + index] = module.stringToUTF8OnStack!(arg);
    });
    module.HEAPU32[(argvPtr >> 2) + argv.length] = 0;
    try {
      return module._main(argv.length, argvPtr);
    } catch (error) {
      const status = exitStatusOf(error);
      if (status !== undefined) return status;
      throw error;
    } finally {
      try {
        module.stackRestore(stack);
      } catch {
        /* exited */
      }
    }
  }
  try {
    return module.callMain?.(args) ?? 0;
  } catch (error) {
    const status = exitStatusOf(error);
    if (status !== undefined) return status;
    throw error;
  }
}

function cleanup(module: NgspiceModule, directory: string) {
  try {
    for (const name of module.FS.readdir(directory)) {
      if (name === "." || name === "..") continue;
      try {
        module.FS.unlink(`${directory}/${name}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export interface NgspiceAdapterHooks {
  createModule?: (options?: Record<string, unknown>) => Promise<NgspiceModule>;
  fetchWasm?: (url: string) => Promise<ArrayBuffer>;
  moduleSha256?: string;
  wasmSha256?: string;
  vectorsSha256?: string;
  resultTransport?: ResultTransport;
  qualifiedVectors?: unknown;
}

export function createNgspiceRuntimeAdapter(hooks: NgspiceAdapterHooks = {}): NgspiceRuntimeAdapter {
  let disposed = false;
  let wasmBytes: Uint8Array | undefined;
  return {
    async initialize(input) {
      if (disposed) throw new AdapterRuntimeError(failure("ADAPTER_DISPOSED", "adapter was disposed"));
      const moduleSha = hooks.moduleSha256 ?? PINNED_MODULE_SHA256;
      const wasmSha = hooks.wasmSha256 ?? PINNED_WASM_SHA256;
      const transport = hooks.resultTransport ?? (transportJson.kind as ResultTransport);
      const vectorsBytesSha = hooks.vectorsSha256 ?? (await sha256Hex(qualifiedVectorsText));
      if (input.expectedModuleSha256 !== moduleSha) {
        throw new AdapterRuntimeError(failure("ENGINE_HASH_MISMATCH", "compiled module hash does not match the request"));
      }
      if (input.expectedResultTransport !== transport || transport !== "binary-rawfile") {
        throw new AdapterRuntimeError(failure("ENGINE_TRANSPORT_MISMATCH", "result transport is not the qualified binary-rawfile route"));
      }
      if (vectorsBytesSha !== PINNED_VECTORS_SHA256) {
        throw new AdapterRuntimeError(failure("ENGINE_VECTOR_CONTRACT_MISMATCH", "qualified vector matrix bytes do not match the pin"));
      }
      parseQualifiedVectorManifest(hooks.qualifiedVectors ?? qualifiedVectors);
      const wasm = hooks.fetchWasm
        ? new Uint8Array(await hooks.fetchWasm(input.wasmUrl))
        : new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
      wasmBytes = wasm;
      const actualWasm = await sha256Hex(wasm);
      if (input.expectedWasmSha256 !== wasmSha || actualWasm !== wasmSha) {
        throw new AdapterRuntimeError(failure("ENGINE_HASH_MISMATCH", "wasm hash does not match the pin"));
      }
      if (input.expectedVersion !== PINNED_VERSION || input.expectedEngineBuildId !== PINNED_ENGINE_BUILD_ID) {
        throw new AdapterRuntimeError(failure("ENGINE_BUILD_MISMATCH", "engine version or build id does not match"));
      }
      const metadata: EngineMetadata = {
        name: "ngspice",
        version: PINNED_VERSION,
        resultTransport: transport,
        moduleSha256: moduleSha,
        wasmSha256: wasmSha,
        engineBuildId: PINNED_ENGINE_BUILD_ID,
        verifiedAt: new Date().toISOString(),
      };
      return metadata;
    },
    async runBatch(input) {
      if (disposed) throw new AdapterRuntimeError(failure("ADAPTER_DISPOSED", "adapter was disposed"));
      const verified = await verifyCompiledModelFiles(
        input.modelFiles.map(file => ({
          modelId: file.modelId,
          sha256: file.sha256,
          generatedName: file.generatedName,
        })),
        input.modelFiles
      );
      if (!verified.ok) throw new AdapterRuntimeError(failure(verified.diagnostics[0]?.code ?? "MODEL_INVALID", "model verification failed", verified.diagnostics));
      const grouped = new Map<string, VerifiedModelFile>();
      for (const file of verified.value) {
        const previous = grouped.get(file.generatedName);
        if (previous && (previous.sha256 !== file.sha256 || previous.utf8.length !== file.utf8.length || previous.utf8.some((byte, index) => byte !== file.utf8[index]))) {
          throw new AdapterRuntimeError(failure("MODEL_SYMBOL_CONFLICT", "the same generated name has different bytes"));
        }
        grouped.set(file.generatedName, file);
      }
      const manifest = parseQualifiedVectorManifest(hooks.qualifiedVectors ?? qualifiedVectors);
      for (const name of input.requestedVectors) {
        if (name.startsWith("@")) {
          const resolved = resolveQualifiedVector(manifest, {
            quantity: name.endsWith("[p]") ? "device-power" : "branch-current",
            family: name.slice(1, 2).toUpperCase(),
            analysis: "dc-op",
            refdes: name.slice(1).replace(/\[.+$/, "").toUpperCase(),
          });
          if (resolved && resolved !== name) {
            throw new AdapterRuntimeError(failure("ENGINE_VECTOR_CONTRACT_MISMATCH", "requested raw name is not the qualified name"));
          }
        }
      }
      const factory = hooks.createModule ?? createNgspiceModule;
      const logs: string[] = [];
      let logBytes = 0;
      const wasm = hooks.fetchWasm
        ? new Uint8Array(await hooks.fetchWasm(wasmUrl))
        : wasmBytes
          ? wasmBytes
          : factory === createNgspiceModule
            ? new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer())
            : new Uint8Array();
      const module = await factory({
        noInitialRun: true,
        wasmBinary: wasm,
        print: (text: string) => {
          logBytes += text.length;
          if (logBytes <= input.limits.maxLogBytes) logs.push(text);
        },
        printErr: (text: string) => {
          logBytes += text.length;
          if (logBytes <= input.limits.maxLogBytes) logs.push(text);
        },
      });
      const directory = "/run";
      try {
        module.FS.mkdir(directory);
        for (const file of grouped.values()) {
          module.FS.writeFile(`${directory}/${file.generatedName}`, file.utf8);
        }
        module.FS.writeFile(`${directory}/circuit.cir`, input.netlistUtf8);
        if (typeof module.FS.chdir === "function") module.FS.chdir(directory);
        const headerBound = estimateHeader(input.requestedVectors);
        if (headerBound + input.netlistUtf8.byteLength > input.limits.maxVirtualFsBytes) {
          throw new AdapterRuntimeError(failure("RESOURCE_VIRTUAL_FS", "rawfile header bound exceeds the virtual FS limit"));
        }
        const exit = invokeMain(module, ["-b", "-r", `${directory}/out.raw`, `${directory}/circuit.cir`]);
        if (exit !== 0) throw new AdapterRuntimeError(failure("ADAPTER_EXIT", `ngspice exit ${exit}`, [], true));
        const raw = module.FS.readFile(`${directory}/out.raw`);
        if (raw.byteLength > input.limits.maxRawResultBytes) {
          throw new AdapterRuntimeError(failure("RESOURCE_RAW_RESULT", "raw result exceeded the adapter limit"));
        }
        if (raw.byteLength > input.limits.maxVirtualFsBytes) {
          throw new AdapterRuntimeError(failure("RESOURCE_VIRTUAL_FS", "rawfile exceeded the virtual FS limit"));
        }
        const parsed = parseRawfile(raw);
        return {
          exitCode: exit,
          vectors: parsed.vectors.map(item => ({
            name: item.name,
            axisName: item.name === "time" || item.name === "frequency" ? item.name : item.name,
            real: item.real,
            imaginary: item.imaginary,
          })),
          log: logs,
          resultTransport: "binary-rawfile",
          rawResultBytes: parsed.vectors.reduce((sum, item) => sum + item.real.byteLength + (item.imaginary?.byteLength ?? 0), 0),
          rawfileFsBytes: parsed.rawfileFsBytes,
          wasmHeapPeakBytes: module.wasmMemory?.buffer.byteLength ?? module.HEAPU8?.byteLength ?? 0,
          virtualFsPeakBytes: input.netlistUtf8.byteLength + [...grouped.values()].reduce((sum, file) => sum + file.utf8.byteLength, 0) + parsed.rawfileFsBytes,
        } satisfies AdapterResult;
      } finally {
        cleanup(module, directory);
      }
    },
    async dispose() {
      disposed = true;
    },
  };
}

export function remainingRunFiles(module: { FS: NgspiceModule["FS"] }, directory = "/run") {
  try {
    return module.FS.readdir(directory).filter(name => name !== "." && name !== "..");
  } catch {
    return [];
  }
}
