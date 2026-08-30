import { z } from "zod";
import { canonicalJson, sha256Hex } from "../domain/project/canonical";
import type { Diagnostic, DomainResult } from "../domain/project/project-v2";
import { parseCircuitProjectV2 } from "../domain/project/project-schema";
import type { CircuitProjectV2 } from "../domain/project/project-v2";
import type { NetlistSourceMap, RunRecord, SimulationSnapshot } from "./contracts";
import { computeAxisId, computeVectorId, resultUnitFor } from "./result-parser";
import {
  computeAssertionDefinitionHash,
  computeAssertionEvaluationId,
  computeAssertionResultId,
  computeImmutableBaseHash,
  selectEnabledAssertions,
} from "./run-record";
import { endpointKey } from "../domain/schematic/component-library";
import { parseAndValidateSpiceSource } from "./spice-source-parser";

const SHA256_RE = /^[a-f0-9]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const MAX_LOG_BYTES = 1024 * 1024;

function fail<T>(code: string, message: string): DomainResult<T> {
  return { ok: false, diagnostics: [{ severity: "error", code, message, blocksRun: true }] };
}

const float64 = z.custom<Float64Array>(value => value instanceof Float64Array, { message: "expected Float64Array" });

const diagnosticSchema = z
  .object({
    severity: z.enum(["info", "warning", "error"]),
    code: z.string().min(1),
    message: z.string(),
    location: z.record(z.string(), z.unknown()).optional(),
    blocksRun: z.boolean(),
    helpId: z.string().optional(),
  })
  .strict();

const engineSchema = z
  .object({
    name: z.literal("ngspice"),
    version: z.string().min(1),
    resultTransport: z.enum(["vector-callback", "binary-rawfile"]),
    moduleSha256: z.string().regex(SHA256_RE),
    wasmSha256: z.string().regex(SHA256_RE),
    engineBuildId: z.string().min(1),
    verifiedAt: z.string().regex(ISO_RE).optional(),
  })
  .strict();

function valuesLegal(values: Float64Array, projection: string) {
  for (const value of values) {
    if (projection === "db20") {
      if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return false;
    } else if (!Number.isFinite(value)) {
      return false;
    }
  }
  return true;
}

function sourceMapConsistent(sourceMap: NetlistSourceMap, netlist: string): boolean {
  const lines = netlist.split("\n");
  const lineCount = netlist.endsWith("\n") ? lines.length - 1 : lines.length;
  const lineToComponent = sourceMap.lineToComponent;
  const componentToLines = sourceMap.componentToLines;
  for (const [lineKey, componentId] of Object.entries(lineToComponent)) {
    const line = Number(lineKey);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) return false;
    const mapped = componentToLines[componentId];
    if (!mapped?.includes(line)) return false;
  }
  for (const [componentId, mapped] of Object.entries(componentToLines)) {
    for (const line of mapped) {
      if (lineToComponent[line] !== componentId) return false;
    }
  }
  for (const [key, node] of Object.entries(sourceMap.endpointToNode)) {
    const endpoints = sourceMap.nodeToEndpoints[node] ?? [];
    const hit = endpoints.some(item => endpointKey(item) === key);
    if (!hit) return false;
  }
  return true;
}

export function sourceMapMatchesProject(sourceMap: NetlistSourceMap, project: CircuitProjectV2): boolean {
  const componentIds = new Set(project.schematic.components.map(item => item.id));
  for (const componentId of Object.values(sourceMap.lineToComponent)) {
    if (!componentIds.has(componentId)) return false;
  }
  return true;
}

async function validateSnapshot(record: Extract<RunRecord, { status: "success" }>, snapshot: SimulationSnapshot): Promise<DomainResult<null>> {
  const fields: Array<keyof SimulationSnapshot> = [
    "appBuildId",
    "runId",
    "projectId",
    "projectRevision",
    "electricalRevision",
    "analysisId",
    "analysisHash",
    "netlistHash",
    "vectorPlanHash",
    "startedAt",
    "finishedAt",
  ];
  for (const field of fields) {
    if (JSON.stringify(snapshot[field]) !== JSON.stringify(record[field as keyof typeof record])) {
      return fail("RUN_SNAPSHOT_MISMATCH", `snapshot ${String(field)} does not match the run wrapper`);
    }
  }
  if (canonicalJson(snapshot.analysis) !== canonicalJson(record.analysis)) return fail("RUN_SNAPSHOT_MISMATCH", "snapshot analysis drifted");
  if (canonicalJson(snapshot.vectorPlan) !== canonicalJson(record.vectorPlan)) return fail("RUN_SNAPSHOT_MISMATCH", "snapshot vector plan drifted");
  if (canonicalJson(snapshot.modelManifest) !== canonicalJson(record.modelManifest)) return fail("RUN_SNAPSHOT_MISMATCH", "snapshot model manifest drifted");
  const engine = snapshot.engine;
  const requested = record.requestedEngine;
  if (
    engine.name !== requested.name ||
    engine.version !== requested.version ||
    engine.resultTransport !== requested.resultTransport ||
    engine.moduleSha256 !== requested.moduleSha256 ||
    engine.wasmSha256 !== requested.wasmSha256 ||
    engine.engineBuildId !== requested.engineBuildId
  ) {
    return fail("RUN_SNAPSHOT_MISMATCH", "snapshot engine does not match requestedEngine");
  }
  if ((await sha256Hex(canonicalJson(snapshot.vectorPlan))) !== snapshot.vectorPlanHash) {
    return fail("RESULT_VECTOR_PLAN", "vector plan hash does not recompute");
  }
  const expectedVectorCount = snapshot.vectorPlan.reduce((sum, item) => sum + item.projections.length, 0);
  if (snapshot.vectors.length !== expectedVectorCount || snapshot.axes.length !== 1) {
    return fail("RESULT_PLAN_ALIGNMENT", "axes/vectors are not one-to-one with the vector plan");
  }
  const axis = snapshot.axes[0]!;
  const expectedAxisId = await computeAxisId(snapshot.analysisId, axis.unit, snapshot.analysis.kind);
  if (axis.id !== expectedAxisId || axis.analysisId !== snapshot.analysisId) return fail("RESULT_AXIS", "axis id is not the canonical formula");
  let offset = 0;
  for (const entry of snapshot.vectorPlan) {
    for (const projection of entry.projections) {
      const vector = snapshot.vectors[offset];
      offset += 1;
      if (!vector) return fail("RESULT_PLAN_ALIGNMENT", "missing planned vector");
      const expectedId = await computeVectorId(snapshot.analysisId, entry.probeId, entry.quantity, projection);
      if (
        vector.id !== expectedId ||
        vector.probeId !== entry.probeId ||
        vector.quantity !== entry.quantity ||
        vector.projection !== projection ||
        vector.sourceVectorName !== entry.sourceVectorName ||
        vector.unit !== resultUnitFor(entry.quantity, projection) ||
        vector.axisId !== axis.id ||
        vector.values.length !== axis.values.length ||
        !valuesLegal(vector.values, projection)
      ) {
        return fail("RESULT_PLAN_ALIGNMENT", "vector fields do not match the compiled plan");
      }
    }
  }
  return { ok: true, value: null, diagnostics: [] };
}

const runBaseShape = z
  .object({
    schemaVersion: z.literal(1),
    appBuildId: z.string().min(1),
    runId: z.string().min(1),
    projectId: z.string().min(1),
    projectRevision: z.number().int().positive(),
    electricalRevision: z.number().int().positive(),
    analysisId: z.string().min(1),
    analysis: z.object({ id: z.string(), kind: z.string() }).passthrough(),
    analysisHash: z.string().regex(SHA256_RE),
    requestedAssertions: z.array(z.object({ id: z.string(), analysisId: z.string(), enabled: z.boolean() }).passthrough()),
    requestedAssertionSetHash: z.string().regex(SHA256_RE),
    netlistHash: z.string().regex(SHA256_RE),
    vectorPlan: z.array(z.object({ probeId: z.string(), sourceVectorName: z.string(), projections: z.array(z.string()) }).passthrough()),
    vectorPlanHash: z.string().regex(SHA256_RE),
    requestedEngine: engineSchema.omit({ verifiedAt: true }),
    modelManifest: z.array(z.object({ modelId: z.string(), sha256: z.string().regex(SHA256_RE), generatedName: z.string() }).strict()),
    inputBundle: z.object({
      netlist: z.string().min(1),
      models: z.array(z.object({ modelId: z.string(), sha256: z.string(), generatedName: z.string(), source: z.string() }).strict()),
      sourceMap: z.object({
        lineToComponent: z.record(z.string(), z.string()),
        componentToLines: z.record(z.string(), z.array(z.number().int())),
        endpointToNode: z.record(z.string(), z.string()),
        nodeToEndpoints: z.record(z.string(), z.array(z.object({ componentId: z.string(), pin: z.string() }).strict())),
      }),
    }),
    corner: z
      .object({
        cornerId: z.string(),
        name: z.string(),
        definitionHash: z.string().regex(SHA256_RE),
        appliedOverridesHash: z.string().regex(SHA256_RE),
        ordinal: z.number().int().nonnegative(),
        total: z.number().int().positive(),
      })
      .strict()
      .optional(),
    startedAt: z.string().regex(ISO_RE),
    preflightDiagnostics: z.array(
      z
        .object({
          phase: z.enum(["schema", "model", "graph", "erc", "compile", "resource"]),
          diagnostic: diagnosticSchema,
        })
        .strict()
    ),
    status: z.enum(["running", "success", "failed", "cancelled", "timeout"]),
  })
  .passthrough();

export async function parseRunRecord(input: unknown, options?: { project?: CircuitProjectV2 }): Promise<DomainResult<RunRecord>> {
  const parsed = runBaseShape.safeParse(input);
  if (!parsed.success) return fail("RUN_INVALID", parsed.error.issues[0]?.message ?? "run record failed structural parse");
  const raw = parsed.data as unknown as RunRecord & { snapshot?: unknown };
  if (raw.preflightDiagnostics.some(item => item.diagnostic.blocksRun)) {
    return fail("RUN_BLOCKING_PREFLIGHT", "a blocking preflight diagnostic cannot appear on a run record");
  }
  if (raw.status !== "success" && "snapshot" in raw && raw.snapshot !== undefined) {
    return fail("RUN_SNAPSHOT_MISMATCH", "non-success records cannot carry a snapshot");
  }
  if (raw.analysis.id !== raw.analysisId) return fail("RUN_ANALYSIS_MISMATCH", "analysis id does not match the captured analysis");
  const captured = selectEnabledAssertions(raw.requestedAssertions as never, raw.analysisId);
  if (canonicalJson(captured) !== canonicalJson(raw.requestedAssertions)) {
    return fail("RUN_ASSERTION_SET", "requested assertions must be enabled for the run analysis and sorted by id");
  }
  if ((await sha256Hex(canonicalJson(captured))) !== raw.requestedAssertionSetHash) {
    return fail("RUN_ASSERTION_SET", "requested assertion set hash does not recompute");
  }
  if ((await sha256Hex(canonicalJson(raw.vectorPlan))) !== raw.vectorPlanHash) {
    return fail("RESULT_VECTOR_PLAN", "vector plan hash does not recompute");
  }
  if (raw.inputBundle.netlist.includes("\r") || (await sha256Hex(raw.inputBundle.netlist)) !== raw.netlistHash) {
    return fail("RUN_NETLIST_HASH", "input bundle netlist is not the captured LF netlist");
  }
  if (!sourceMapConsistent(raw.inputBundle.sourceMap, raw.inputBundle.netlist)) {
    return fail("RUN_SOURCE_MAP", "source map is not internally consistent with the captured netlist");
  }
  if (options?.project && !sourceMapMatchesProject(raw.inputBundle.sourceMap, options.project)) {
    return fail("RUN_SOURCE_MAP", "source map does not belong to the captured project facts");
  }
  if (options?.project) {
    const project = parseCircuitProjectV2(options.project);
    if (!project.ok) return fail("RUN_PROJECT", "creation-time project is invalid");
  }
  for (const model of raw.inputBundle.models) {
    const parsedModel = await parseAndValidateSpiceSource(model.source, "stored-model", "opaque-model");
    if (!parsedModel.ok) return parsedModel;
    if (parsedModel.value.sha256 !== model.sha256) return fail("MODEL_HASH_MISMATCH", "model source hash does not match the bundle");
    const manifest = raw.modelManifest.find(item => item.modelId === model.modelId);
    if (!manifest || manifest.sha256 !== model.sha256 || manifest.generatedName !== model.generatedName) {
      return fail("MODEL_MANIFEST_MISMATCH", "bundle model is not an exact manifest entry");
    }
  }
  if (raw.status === "failed") {
    const failed = raw as Extract<RunRecord, { status: "failed" }>;
    const logBytes = new TextEncoder().encode(failed.failure.log.join("\n")).byteLength;
    if (logBytes > MAX_LOG_BYTES) return fail("RESOURCE_LOG", "failed engine log exceeds 1 MiB");
  }
  if (raw.status === "success") {
    const success = raw as Extract<RunRecord, { status: "success" }>;
    if (!success.snapshot || !Array.isArray(success.assertionEvaluations) || success.assertionEvaluations.length < 1) {
      return fail("RUN_EVALUATION_MISSING", "a success record must include a snapshot and the initial evaluation");
    }
    const snapshotCheck = await validateSnapshot(success, success.snapshot);
    if (!snapshotCheck.ok) return snapshotCheck;
    const first = success.assertionEvaluations[0]!;
    if (canonicalJson(first.definitions) !== canonicalJson(success.requestedAssertions)) {
      return fail("RUN_EVALUATION_MISMATCH", "the first evaluation must repeat the captured assertion definitions");
    }
    if (first.assertionSetHash !== success.requestedAssertionSetHash || first.projectRevision !== success.projectRevision) {
      return fail("RUN_EVALUATION_MISMATCH", "the first evaluation hash or revision is wrong");
    }
    const seen = new Set<string>();
    for (const evaluation of success.assertionEvaluations) {
      if (evaluation.runId !== success.runId || evaluation.electricalRevision !== success.electricalRevision) {
        return fail("RUN_EVALUATION_MISMATCH", "evaluation does not belong to the parent run");
      }
      if (evaluation.projectRevision < success.projectRevision) {
        return fail("RUN_EVALUATION_REVISION", "evaluation project revision is older than the run");
      }
      const expectedId = await computeAssertionEvaluationId(evaluation.runId, evaluation.assertionSetHash);
      if (evaluation.id !== expectedId) return fail("RUN_EVALUATION_ID", "evaluation id is not the canonical formula");
      if (seen.has(evaluation.assertionSetHash)) return fail("RUN_EVALUATION_DUPLICATE", "assertion set hashes must be unique");
      seen.add(evaluation.assertionSetHash);
      if (evaluation.results.length !== evaluation.definitions.length) return fail("RUN_EVALUATION_ALIGNMENT", "results are not one-to-one with definitions");
      for (let index = 0; index < evaluation.definitions.length; index += 1) {
        const definition = evaluation.definitions[index]!;
        const result = evaluation.results[index]!;
        const definitionHash = await computeAssertionDefinitionHash(definition as never);
        const resultId = await computeAssertionResultId({
          runId: evaluation.runId,
          assertionSetHash: evaluation.assertionSetHash,
          assertionId: definition.id,
          assertionDefinitionHash: definitionHash,
        });
        if (
          result.id !== resultId ||
          result.runId !== evaluation.runId ||
          result.assertionSetHash !== evaluation.assertionSetHash ||
          result.projectRevision !== evaluation.projectRevision ||
          result.electricalRevision !== evaluation.electricalRevision ||
          result.assertionDefinitionHash !== definitionHash
        ) {
          return fail("RUN_EVALUATION_ALIGNMENT", "assertion result does not repeat its parent evaluation fields");
        }
      }
    }
  }
  void engineSchema;
  return { ok: true, value: raw as RunRecord, diagnostics: [] };
}

export async function parseStoredRunEnvelopeShape(input: unknown): Promise<DomainResult<{ storageVersion: number; localAttempt: number; immutableBaseHash: string; record: RunRecord }>> {
  const envelope = z
    .object({
      envelopeVersion: z.literal(1),
      storageVersion: z.number().int().positive(),
      localAttempt: z.number().int().positive(),
      immutableBaseHash: z.string().regex(SHA256_RE),
      record: z.unknown(),
      listKey: z.tuple([z.string(), z.number(), z.string(), z.string(), z.string(), z.string(), z.string()]),
    })
    .strict()
    .safeParse(input);
  if (!envelope.success) return fail("STORAGE_INVALID_RUN", "run envelope failed structural parse");
  const record = await parseRunRecord(envelope.data.record);
  if (!record.ok) return record;
  const hash = await computeImmutableBaseHash(record.value);
  if (hash !== envelope.data.immutableBaseHash) return fail("STORAGE_RUN_HASH", "immutableBaseHash does not recompute");
  return { ok: true, value: { ...envelope.data, record: record.value }, diagnostics: [] };
}
