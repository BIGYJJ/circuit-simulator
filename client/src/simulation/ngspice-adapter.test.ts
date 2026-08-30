import { describe, expect, it } from "vitest";
import { sha256Hex } from "../domain/project/canonical";
import {
  AdapterRuntimeError,
  PINNED_ENGINE_BUILD_ID,
  PINNED_MODULE_SHA256,
  PINNED_VECTORS_SHA256,
  PINNED_VERSION,
  createNgspiceRuntimeAdapter,
  remainingRunFiles,
  verifyCompiledModelFiles,
} from "./ngspice-adapter";
import { DEFAULT_RUNTIME_LIMITS } from "./resource-estimator";
import { parseAndValidateSpiceSource } from "./spice-source-parser";

function encodeRawfile(names: string[], points: number[][]) {
  let header = "Title: t\nFlags: real\nVariables:\n";
  names.forEach((name, index) => {
    header += `\t${index}\t${name}\tvoltage\n`;
  });
  header += "Binary:\n";
  const prefix = new TextEncoder().encode(header);
  const data = new ArrayBuffer(names.length * (points[0]?.length ?? 0) * 8);
  const view = new DataView(data);
  let offset = 0;
  const count = points[0]?.length ?? 0;
  for (let point = 0; point < count; point += 1) {
    for (let index = 0; index < names.length; index += 1) {
      view.setFloat64(offset, points[index]![point]!, true);
      offset += 8;
    }
  }
  const bytes = new Uint8Array(prefix.byteLength + data.byteLength);
  bytes.set(prefix, 0);
  bytes.set(new Uint8Array(data), prefix.byteLength);
  return bytes;
}

function createFakeModule(raw = encodeRawfile(["v(1)"], [[6]])) {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    FS: {
      mkdir: () => undefined,
      writeFile: (path: string, data: string | Uint8Array) => {
        files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
      },
      readFile: (path: string) => {
        const found = files.get(path);
        if (!found) throw new Error(`missing ${path}`);
        return found;
      },
      readdir: (directory: string) => [
        ".",
        "..",
        ...[...files.keys()].filter(name => name.startsWith(`${directory}/`)).map(name => name.slice(directory.length + 1)),
      ],
      unlink: (path: string) => {
        files.delete(path);
      },
    },
    callMain: () => {
      files.set("/run/out.raw", raw);
      return 0;
    },
    wasmMemory: { buffer: new ArrayBuffer(1024) },
  };
}

describe("verifyCompiledModelFiles", () => {
  it("rejects a source whose bytes do not match the compiled manifest", async () => {
    const result = await verifyCompiledModelFiles(
      [{ modelId: "DLED", sha256: "0".repeat(64), generatedName: `model-${"0".repeat(64)}.lib` }],
      [{ modelId: "DLED", sha256: "0".repeat(64), generatedName: `model-${"0".repeat(64)}.lib`, source: ".model DLED D(IS=1e-12)\n" }]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe("MODEL_HASH_MISMATCH");
  });
});

describe("ngspice adapter", () => {
  it("cleans files between isolated runs and after a write failure", async () => {
    const wasm = new Uint8Array([1, 2, 3]);
    const wasmSha = await sha256Hex(wasm);
    const created: ReturnType<typeof createFakeModule>[] = [];
    const adapter = createNgspiceRuntimeAdapter({
      moduleSha256: PINNED_MODULE_SHA256,
      wasmSha256: wasmSha,
      vectorsSha256: PINNED_VECTORS_SHA256,
      fetchWasm: async () => wasm,
      createModule: async () => {
        const next = createFakeModule(encodeRawfile([created.length === 0 ? "v-a" : "v-b"], [[created.length]]));
        created.push(next);
        return next;
      },
    });
    await adapter.initialize({
      wasmUrl: "https://example.invalid/ngspice.wasm",
      expectedResultTransport: "binary-rawfile",
      expectedModuleSha256: PINNED_MODULE_SHA256,
      expectedWasmSha256: wasmSha,
      expectedVersion: PINNED_VERSION,
      expectedEngineBuildId: PINNED_ENGINE_BUILD_ID,
    });
    const runA = await adapter.runBatch({
      netlistUtf8: new TextEncoder().encode("* FLUXLAB GENERATED NETLIST\n.end\n"),
      modelFiles: [],
      requestedVectors: ["v(1)"],
      limits: DEFAULT_RUNTIME_LIMITS,
    });
    expect(runA.vectors[0]?.name).toBe("v-a");
    expect(remainingRunFiles(created[0]!)).toEqual([]);

    const runB = await adapter.runBatch({
      netlistUtf8: new TextEncoder().encode("* FLUXLAB GENERATED NETLIST\n.end\n"),
      modelFiles: [],
      requestedVectors: ["v(1)"],
      limits: DEFAULT_RUNTIME_LIMITS,
    });
    expect(runB.vectors[0]?.name).toBe("v-b");
    expect(runB.vectors.some(item => item.name === "v-a")).toBe(false);
    expect(remainingRunFiles(created[1]!)).toEqual([]);
  });

  it("writes one generated file when two model IDs share name, hash, and bytes", async () => {
    const wasm = new Uint8Array([4]);
    const wasmSha = await sha256Hex(wasm);
    const filesWritten: string[] = [];
    const adapter = createNgspiceRuntimeAdapter({
      moduleSha256: PINNED_MODULE_SHA256,
      wasmSha256: wasmSha,
      vectorsSha256: PINNED_VECTORS_SHA256,
      fetchWasm: async () => wasm,
      createModule: async () => {
        const fake = createFakeModule();
        const original = fake.FS.writeFile;
        fake.FS.writeFile = (path, data) => {
          filesWritten.push(path);
          original(path, data);
        };
        return fake;
      },
    });
    const source = ".model DLED D(IS=1e-14 N=1)\n";
    const parsed = await parseAndValidateSpiceSource(source, "stored-model", "opaque-model");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected valid model source");
    const hash = parsed.value.sha256;
    const name = `model-${hash}.lib`;
    const result = await adapter.runBatch({
      netlistUtf8: new TextEncoder().encode("* FLUXLAB GENERATED NETLIST\n.end\n"),
      modelFiles: [
        { modelId: "one", sha256: hash, generatedName: name, source },
        { modelId: "two", sha256: hash, generatedName: name, source },
      ],
      requestedVectors: ["v(1)"],
      limits: DEFAULT_RUNTIME_LIMITS,
    });
    expect(result.exitCode).toBe(0);
    expect(filesWritten.filter(path => path.endsWith(name))).toHaveLength(1);
  });

  it("throws a structured failure when two model IDs share a name but not bytes", async () => {
    const wasm = new Uint8Array([9]);
    const wasmSha = await sha256Hex(wasm);
    const adapter = createNgspiceRuntimeAdapter({
      moduleSha256: PINNED_MODULE_SHA256,
      wasmSha256: wasmSha,
      vectorsSha256: PINNED_VECTORS_SHA256,
      fetchWasm: async () => wasm,
      createModule: async () => createFakeModule(),
    });
    const hash = "a".repeat(64);
    const name = `model-${hash}.lib`;
    await expect(
      adapter.runBatch({
        netlistUtf8: new TextEncoder().encode("n"),
        modelFiles: [
          { modelId: "one", sha256: hash, generatedName: name, source: ".model DLED D(IS=1e-14 N=1)\n" },
          { modelId: "two", sha256: hash, generatedName: name, source: ".model DLED D(IS=1e-15 N=1)\n" },
        ],
        requestedVectors: ["v(1)"],
        limits: DEFAULT_RUNTIME_LIMITS,
      })
    ).rejects.toBeInstanceOf(AdapterRuntimeError);
  });

  it("rejects a rawfile one byte over the adapter limit and cleans the run directory", async () => {
    const wasm = new Uint8Array([7]);
    const wasmSha = await sha256Hex(wasm);
    const raw = encodeRawfile(["v(1)"], [[6]]);
    const created: ReturnType<typeof createFakeModule>[] = [];
    const adapter = createNgspiceRuntimeAdapter({
      moduleSha256: PINNED_MODULE_SHA256,
      wasmSha256: wasmSha,
      vectorsSha256: PINNED_VECTORS_SHA256,
      fetchWasm: async () => wasm,
      createModule: async () => {
        const next = createFakeModule(raw);
        created.push(next);
        return next;
      },
    });
    await expect(
      adapter.runBatch({
        netlistUtf8: new TextEncoder().encode("n"),
        modelFiles: [],
        requestedVectors: ["v(1)"],
        limits: { ...DEFAULT_RUNTIME_LIMITS, maxRawResultBytes: raw.byteLength - 1 },
      })
    ).rejects.toMatchObject({ failure: { code: "RESOURCE_RAW_RESULT" } });
    expect(remainingRunFiles(created[0]!)).toEqual([]);
  });

  it("cleans files after a write failure before callMain", async () => {
    const wasm = new Uint8Array([8]);
    const wasmSha = await sha256Hex(wasm);
    const created: ReturnType<typeof createFakeModule>[] = [];
    const adapter = createNgspiceRuntimeAdapter({
      moduleSha256: PINNED_MODULE_SHA256,
      wasmSha256: wasmSha,
      vectorsSha256: PINNED_VECTORS_SHA256,
      fetchWasm: async () => wasm,
      createModule: async () => {
        const next = createFakeModule();
        next.FS.writeFile = () => {
          throw new Error("disk full");
        };
        created.push(next);
        return next;
      },
    });
    await expect(
      adapter.runBatch({
        netlistUtf8: new TextEncoder().encode("n"),
        modelFiles: [],
        requestedVectors: ["v(1)"],
        limits: DEFAULT_RUNTIME_LIMITS,
      })
    ).rejects.toBeInstanceOf(Error);
    expect(remainingRunFiles(created[0]!)).toEqual([]);
  });
});
