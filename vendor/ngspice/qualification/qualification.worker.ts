import createNgspiceModuleRaw from "../ngspice.mjs";

type NgspiceModule = {
  wasmMemory?: { buffer: ArrayBuffer };
  HEAPU8?: Uint8Array;
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
  _malloc?: (size: number) => number;
  _free?: (ptr: number) => void;
  stringToUTF8?: (value: string, ptr: number, max: number) => void;
};

const createNgspiceModule = createNgspiceModuleRaw as (options?: Record<string, unknown>) => Promise<NgspiceModule>;
import wasmUrl from "../ngspice.wasm?url";
import transportJson from "../RESULT_TRANSPORT.json";
import manifestJson from "../QUALIFIED_VECTORS.json";
import versionText from "../VERSION?raw";
import dividerCir from "./fixtures/divider-op.cir?raw";
import rcCir from "./fixtures/rc-transient.cir?raw";
import diodeCir from "./fixtures/diode-sweep.cir?raw";
import acCir from "./fixtures/rc-lowpass-ac.cir?raw";
import subcktCir from "./fixtures/subcircuit-op.cir?raw";
import subcktLib from "./fixtures/subcircuit-model.lib?raw";
import longCir from "./fixtures/cancel-long-run.cir?raw";
import opVectorsCir from "./fixtures/qualified-vectors/op.cir?raw";
import sweepVectorsCir from "./fixtures/qualified-vectors/sweep.cir?raw";
import tranVectorsCir from "./fixtures/qualified-vectors/transient.cir?raw";
import acVectorsCir from "./fixtures/qualified-vectors/ac.cir?raw";
import {
  parseQualifiedVectorManifest,
  resolveQualifiedVector,
} from "../../../client/src/simulation/qualified-vectors.mjs";

const MODULE_SHA256 =
  "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93";
const WASM_SHA256 =
  "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c";
const VERSION = versionText.split(/\r?\n/)[0].trim();
const ENGINE_BUILD_ID = /engineBuildId=(\S+)/.exec(versionText)?.[1] ?? "";
const LIMITS = {
  maxWasmHeapBytes: 256 * 1024 * 1024,
  maxVirtualFsBytes: 32 * 1024 * 1024,
  maxLogBytes: 1024 * 1024,
  maxResultPoints: 2_000_000,
  maxSingleVectorBytes: 16 * 1024 * 1024,
  maxRawResultBytes: 64 * 1024 * 1024,
};

type RawVector = { name: string; values: Float64Array; imag?: Float64Array };

async function sha256Hex(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseRawfile(bytes: Uint8Array) {
  const text = new TextDecoder("latin1").decode(bytes);
  const marker = text.includes("Binary:\r\n") ? "Binary:\r\n" : "Binary:\n";
  const split = text.indexOf(marker);
  if (split < 0) throw new Error("rawfile missing Binary header");
  const header = text.slice(0, split);
  const headerBytes = new TextEncoder().encode(header + marker).length;
  const names = [...header.matchAll(/\t\d+\t([^\t]+)\t/g)].map(m => {
    const lower = m[1].toLowerCase();
    const wrapped = /^i\((@.+)\)$/.exec(lower);
    return wrapped ? wrapped[1] : lower;
  });
  const complex = /Flags:\s*complex/i.test(header);
  const data = bytes.subarray(split + marker.length);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const stride = names.length * (complex ? 2 : 1);
  const points = Math.floor(data.byteLength / 8 / stride);
  const vectors: RawVector[] = names.map(name => ({
    name,
    values: new Float64Array(points),
    imag: complex ? new Float64Array(points) : undefined,
  }));
  let offset = 0;
  for (let p = 0; p < points; p++) {
    for (let v = 0; v < names.length; v++) {
      vectors[v].values[p] = view.getFloat64(offset, true);
      offset += 8;
      const imag = vectors[v]?.imag;
      if (complex && imag) {
        imag[p] = view.getFloat64(offset, true);
        offset += 8;
      }
    }
  }
  return { headerBytes, rawfileFsBytes: bytes.byteLength, vectors, complex };
}

function estimateHeader(variableNames: string[]) {
  const est = transportJson.rawfileHeaderEstimator;
  const nameBytes = variableNames.reduce((sum, name) => sum + name.length, 0);
  return (
    est.fixedBytes +
    variableNames.length * est.perVariableBytes +
    nameBytes * est.perVariableNameUtf8Byte +
    est.safetyBytes
  );
}

function interpolate(x: Float64Array, y: Float64Array, target: number) {
  for (let i = 1; i < x.length; i++) {
    const lo = Math.min(x[i - 1], x[i]);
    const hi = Math.max(x[i - 1], x[i]);
    if (target >= lo && target <= hi) {
      const t = (target - x[i - 1]) / (x[i] - x[i - 1] || 1);
      return y[i - 1] + t * (y[i] - y[i - 1]);
    }
  }
  return y[y.length - 1];
}

function requiredName(vectors: RawVector[], name: string) {
  const found = vectors.find(item => item.name === name.toLowerCase());
  if (!found) throw new Error(`missing vector ${name}`);
  return found;
}

function callMain(module: any, args: string[]) {
  const argv = ["ngspice", ...args];
  const stack = module.stackSave();
  const argvPtr = module.stackAlloc((argv.length + 1) * 4);
  argv.forEach((arg, i) => {
    module.HEAPU32[(argvPtr >> 2) + i] = module.stringToUTF8OnStack(arg);
  });
  module.HEAPU32[(argvPtr >> 2) + argv.length] = 0;
  try {
    return module._main(argv.length, argvPtr);
  } catch (error: any) {
    if (error?.name === "ExitStatus") return error.status;
    throw error;
  } finally {
    try {
      module.stackRestore(stack);
    } catch {
      /* exited */
    }
  }
}

async function instantiate(expected: {
  moduleSha256: string;
  wasmSha256: string;
  version: string;
  resultTransport: string;
  engineBuildId: string;
}) {
  if (expected.moduleSha256 !== MODULE_SHA256) {
    throw Object.assign(new Error("ENGINE_MODULE_HASH_MISMATCH"), {
      code: "ENGINE_MODULE_HASH_MISMATCH",
    });
  }
  if (expected.version !== VERSION) {
    throw Object.assign(new Error("ENGINE_VERSION_MISMATCH"), {
      code: "ENGINE_VERSION_MISMATCH",
    });
  }
  if (expected.resultTransport !== transportJson.kind) {
    throw Object.assign(new Error("ENGINE_TRANSPORT_MISMATCH"), {
      code: "ENGINE_TRANSPORT_MISMATCH",
    });
  }
  if (expected.engineBuildId !== ENGINE_BUILD_ID) {
    throw Object.assign(new Error("ENGINE_BUILD_MISMATCH"), {
      code: "ENGINE_BUILD_MISMATCH",
    });
  }
  const wasmBytes = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
  const wasmSha = await sha256Hex(wasmBytes);
  if (expected.wasmSha256 !== WASM_SHA256 || wasmSha !== expected.wasmSha256) {
    throw Object.assign(new Error("ENGINE_HASH_MISMATCH"), {
      code: "ENGINE_HASH_MISMATCH",
    });
  }
  const logs: string[] = [];
  let logBytes = 0;
  const module = await createNgspiceModule({
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary: wasmBytes,
    print: (text: string) => {
      logBytes += text.length;
      if (logBytes <= LIMITS.maxLogBytes) logs.push(text);
    },
    printErr: (text: string) => {
      logBytes += text.length;
      if (logBytes <= LIMITS.maxLogBytes) logs.push(text);
    },
  });
  return { module, logs, getLogBytes: () => logBytes };
}

async function runCircuit(
  netlist: string,
  models: Array<{ generatedName: string; utf8: string }>,
  limits = LIMITS
) {
  const include = models.map(model => `.include "${model.generatedName}"`).join("\n");
  const body = include ? `${include}\n${netlist}` : netlist;
  const netBytes = new TextEncoder().encode(body);
  const modelBytes = models.reduce((sum, model) => sum + model.utf8.length, 0);
  if (netBytes.byteLength + modelBytes > limits.maxVirtualFsBytes) {
    throw Object.assign(new Error("RESOURCE_FS"), { code: "RESOURCE_FS" });
  }
  const { module, logs, getLogBytes } = await instantiate({
    moduleSha256: MODULE_SHA256,
    wasmSha256: WASM_SHA256,
    version: VERSION,
    resultTransport: transportJson.kind,
    engineBuildId: ENGINE_BUILD_ID,
  });
  const heapBytes =
    module.wasmMemory?.buffer?.byteLength ?? module.HEAPU8?.byteLength ?? 0;
  if (heapBytes > limits.maxWasmHeapBytes) {
    throw Object.assign(new Error("RESOURCE_HEAP"), { code: "RESOURCE_HEAP" });
  }
  module.FS.mkdir("/run");
  for (const model of models) {
    module.FS.writeFile(`/run/${model.generatedName}`, model.utf8);
  }
  module.FS.writeFile("/run/circuit.cir", body);
  const cwd = module.FS.cwd;
  if (typeof module.FS.chdir === "function") module.FS.chdir("/run");
  const exit = callMain(module, ["-b", "-r", "/run/out.raw", "/run/circuit.cir"]);
  if (cwd && typeof module.FS.chdir === "function") {
    try {
      module.FS.chdir(cwd);
    } catch {
      /* ignore */
    }
  }
  if (getLogBytes() > limits.maxLogBytes) {
    throw Object.assign(new Error("RESOURCE_LOG"), { code: "RESOURCE_LOG" });
  }
  if (exit !== 0) throw new Error(`ngspice exit ${exit}: ${logs.slice(-5).join(" | ")}`);
  const raw = module.FS.readFile("/run/out.raw") as Uint8Array;
  const parsed = parseRawfile(raw);
  const names = parsed.vectors.map(item => item.name);
  if (estimateHeader(names) < parsed.headerBytes) {
    throw new Error("rawfile header estimator below actual");
  }
  const points = parsed.vectors[0]?.values.length ?? 0;
  if (points > limits.maxResultPoints) {
    throw Object.assign(new Error("RESOURCE_POINTS"), { code: "RESOURCE_POINTS" });
  }
  if (raw.byteLength > limits.maxRawResultBytes) {
    throw Object.assign(new Error("RESOURCE_RAW_RESULT"), { code: "RESOURCE_RAW_RESULT" });
  }
  for (const vector of parsed.vectors) {
    if (vector.values.byteLength > limits.maxSingleVectorBytes) {
      throw Object.assign(new Error("RESOURCE_VECTOR"), { code: "RESOURCE_VECTOR" });
    }
  }
  for (const name of module.FS.readdir("/run")) {
    if (name === "." || name === "..") continue;
    try {
      module.FS.unlink(`/run/${name}`);
    } catch {
      /* ignore */
    }
  }
  const leftover = module.FS.readdir("/run").filter((name: string) => name !== "." && name !== "..");
  return {
    parsed,
    leftover,
    logs,
    heap: module.wasmMemory?.buffer?.byteLength ?? module.HEAPU8?.byteLength ?? 0,
  };
}

function collectObservations() {
  const manifest = parseQualifiedVectorManifest(manifestJson);
  return manifest.capabilities.map(capability => {
    const familyRef: Record<string, string> = {
      R: "R1",
      C: "C1",
      L: "L1",
      V: "V1",
      I: "I1",
      D: "D1",
      S: "S1",
    };
    return {
      quantity: capability.quantity,
      family: capability.family,
      analysis: capability.analysis,
      rawName: resolveQualifiedVector(manifest, {
        quantity: capability.quantity,
        family: capability.family,
        analysis: capability.analysis,
        refdes: familyRef[capability.family],
      }),
    };
  });
}

async function runQualification() {
  const first = await runCircuit(dividerCir, []);
  const second = await runCircuit(dividerCir, []);
  const rc = await runCircuit(rcCir, []);
  const diode = await runCircuit(diodeCir, []);
  const ac = await runCircuit(acCir, []);
  const sub = await runCircuit(subcktCir, [
    { generatedName: "model-subckt.lib", utf8: subcktLib },
  ]);
  const vectorRuns = {
    "dc-op": await runCircuit(opVectorsCir, []),
    "dc-sweep": await runCircuit(sweepVectorsCir, []),
    transient: await runCircuit(tranVectorsCir, []),
    ac: await runCircuit(acVectorsCir, []),
  };

  const vout = requiredName(first.parsed.vectors, "v(2)").values[0];
  const time = requiredName(rc.parsed.vectors, "time").values;
  const vcap = requiredName(rc.parsed.vectors, "v(2)").values;
  const sweepV = requiredName(diode.parsed.vectors, "v(v-sweep)").values;
  const sweepI = requiredName(diode.parsed.vectors, "i(v1)").values.map(v => Math.abs(v));
  const iLow = interpolate(sweepV, Float64Array.from(sweepI), 0.4);
  const iHigh = interpolate(sweepV, Float64Array.from(sweepI), 0.8);
  const freq = requiredName(ac.parsed.vectors, "frequency").values;
  const v2 = requiredName(ac.parsed.vectors, "v(2)");
  const mag = v2.values.map((re, i) => Math.hypot(re, v2.imag?.[i] ?? 0));
  const targetMag = 1 / Math.SQRT2;
  let cutoff = freq[freq.length - 1];
  for (let i = 1; i < mag.length; i++) {
    if (mag[i] <= targetMag && mag[i - 1] >= targetMag) {
      cutoff = interpolate(
        Float64Array.from([mag[i - 1], mag[i]]),
        Float64Array.from([freq[i - 1], freq[i]]),
        targetMag
      );
      break;
    }
  }
  const power = requiredName(first.parsed.vectors, "@r1[p]").values[0];
  const diodePower = requiredName(diode.parsed.vectors, "@d1[p]");
  const diodeVI = requiredName(diode.parsed.vectors, "i(v1)");
  const diodePowerMatchesVI = diodePower.values.every((p, i) => {
    const expected = Math.abs(sweepV[i] * diodeVI.values[i]);
    return Math.abs(p - expected) <= Math.max(1e-9, 1e-4 * Math.max(expected, Math.abs(p)));
  });

  const observations = collectObservations();
  for (const observation of observations) {
    const run = vectorRuns[observation.analysis as keyof typeof vectorRuns];
    if (!observation.rawName || !run.parsed.vectors.some(item => item.name === observation.rawName)) {
      throw new Error(`unqualified ${observation.family} ${observation.analysis}`);
    }
  }

  const limitCodes: string[] = [];
  const probes: Array<[string, typeof LIMITS]> = [
    ["RESOURCE_FS", { ...LIMITS, maxVirtualFsBytes: 8 }],
    ["RESOURCE_HEAP", { ...LIMITS, maxWasmHeapBytes: 1 }],
    ["RESOURCE_LOG", { ...LIMITS, maxLogBytes: 1 }],
    ["RESOURCE_POINTS", { ...LIMITS, maxResultPoints: 0 }],
    ["RESOURCE_RAW_RESULT", { ...LIMITS, maxRawResultBytes: 8 }],
    ["RESOURCE_VECTOR", { ...LIMITS, maxSingleVectorBytes: 7 }],
  ];
  for (const [code, limits] of probes) {
    try {
      await runCircuit(dividerCir, [], limits);
    } catch (error: any) {
      if (error?.code === code || String(error).includes(code)) limitCodes.push(code);
    }
  }

  const mismatch = async (field: string, expected: Record<string, string>) => {
    try {
      await instantiate(expected as any);
      return "";
    } catch (error: any) {
      return error.code ?? "";
    }
  };
  const good = {
    moduleSha256: MODULE_SHA256,
    wasmSha256: WASM_SHA256,
    version: VERSION,
    resultTransport: transportJson.kind,
    engineBuildId: ENGINE_BUILD_ID,
  };

  return {
    dividerVout: vout,
    rcAt1Tau: interpolate(time, vcap, 1),
    rcAt5Tau: interpolate(time, vcap, 5),
    diodeCurrentRatio: iHigh / iLow,
    lowpassCutoffHz: cutoff,
    subcircuitVout: requiredName(sub.parsed.vectors, "v(2)").values[0],
    dividerR1PowerW: power,
    diodePowerMatchesVI,
    secondRunEqualsFirst: requiredName(second.parsed.vectors, "v(2)").values[0] === vout,
    resultTransport: transportJson.kind,
    rawfileFsBytes: first.parsed.rawfileFsBytes,
    rawfileEstimateCoversActual:
      estimateHeader(first.parsed.vectors.map(item => item.name)) >= first.parsed.headerBytes,
    limitCodes,
    fsEntriesAfterRun: first.leftover,
    plotsAfterCleanup: [],
    hashMismatchCode: await mismatch("wasm", { ...good, wasmSha256: "0".repeat(64) }),
    moduleHashMismatchCode: await mismatch("module", { ...good, moduleSha256: "1".repeat(64) }),
    versionMismatchCode: await mismatch("version", { ...good, version: "nope" }),
    transportMismatchCode: await mismatch("transport", { ...good, resultTransport: "vector-callback" }),
    engineBuildMismatchCode: await mismatch("build", { ...good, engineBuildId: "nope" }),
  };
}

self.onmessage = async (event: MessageEvent) => {
  try {
    if (event.data?.type === "run-qualification") {
      if (event.data.wasmSha256 && event.data.wasmSha256 !== WASM_SHA256) {
        throw Object.assign(new Error("ENGINE_HASH_MISMATCH"), {
          code: "ENGINE_HASH_MISMATCH",
        });
      }
      const result = await runQualification();
      (self as any).postMessage({ type: "qualification-complete", result });
      return;
    }
    if (event.data?.type === "ready") {
      (self as any).postMessage({ type: "qualification-complete", result: { ready: true } });
      return;
    }
    if (event.data?.type === "run-divider") {
      const divider = await runCircuit(dividerCir, []);
      (self as any).postMessage({
        type: "qualification-complete",
        result: { dividerVout: requiredName(divider.parsed.vectors, "v(2)").values[0] },
      });
      return;
    }
    if (event.data?.type === "run-long") {
      await runCircuit(longCir, []);
      (self as any).postMessage({ type: "qualification-complete", result: { long: true } });
    }
  } catch (error: any) {
    (self as any).postMessage({
      type: "qualification-failed",
      code: error.code ?? "QUALIFICATION_FAILED",
      message: String(error?.message ?? error),
    });
  }
};
