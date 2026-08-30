import { bundledManifestForValidation } from "../domain/project/bundled-models";
import { parseCircuitProjectV2 } from "../domain/project/project-schema";
import type { AnalysisId, CircuitProjectV2, Diagnostic, DomainResult, ProjectId, RunId } from "../domain/project/project-v2";
import type { AssertionEvaluation, RunRecord, RunningRunRecord, SuccessfulRunRecord, TerminalRunRecord } from "../simulation/contracts";
import { buildRunningRecordForProject, computeImmutableBaseHash, recoverInterruptedRun } from "../simulation/run-record";
import { parseRunRecord } from "../simulation/run-record-schema";
import { validateProjectModels } from "../simulation/spice-source-parser";
import { z, type ZodIssue } from "zod";

export const DATABASE_NAME = "fluxlab";
export const DATABASE_VERSION = 1;

export interface ProjectSummary {
  projectId: ProjectId;
  title: string;
  updatedAt: string;
  revision: number;
}

export interface StoredProjectEnvelope {
  envelopeVersion: 1;
  storageVersion: number;
  project: CircuitProjectV2;
  listKey: readonly [updatedAt: string, projectId: ProjectId, title: string, revision: number];
  revisionKey: readonly [projectId: ProjectId, revision: number, electricalRevision: number];
}

export interface StoredRunSequence {
  envelopeVersion: 1;
  projectId: ProjectId;
  nextAttempt: number;
  storageVersion: number;
}

export interface RunSummary {
  runId: RunId;
  projectId: ProjectId;
  localAttempt: number;
  startedAt: string;
  analysisId: AnalysisId;
  status: RunRecord["status"];
  cornerKey: string;
}

export interface StoredRunEnvelope {
  envelopeVersion: 1;
  storageVersion: number;
  localAttempt: number;
  immutableBaseHash: string;
  record: RunRecord;
  listKey: readonly [ProjectId, number, string, AnalysisId, RunRecord["status"], string, RunId];
}

export interface LocalSettingsV1 {
  schemaVersion: 1;
  theme: "system" | "light" | "dark";
  reducedMotion: "system" | "reduce";
  defaultView: "guided" | "standard" | "expert";
}

export type StoredSettingValue =
  | { kind: "local-settings"; settings: LocalSettingsV1 }
  | { kind: "lesson-session"; lessonId: string; projectId: ProjectId; templateKey: "divider" | "led" | "rc" | "engineering-review" }
  | { kind: "last-opened-project"; projectId: ProjectId }
  | { kind: "legacy-notice"; path: "/divider" | "/led" | "/engineering" | "/engineering/ops"; acknowledged: true };

export interface StoredSettingEnvelope {
  envelopeVersion: 1;
  storageVersion: number;
  key: string;
  projectKey?: readonly [projectId: ProjectId, key: string];
  value: StoredSettingValue;
}

export type ProjectSaveState =
  | { status: "saved"; latestRevision: number; persistedRevision: number }
  | { status: "saving" | "dirty"; latestRevision: number; persistedRevision: number }
  | { status: "error"; latestRevision: number; persistedRevision: number; diagnostics: Diagnostic[] };

export interface ProjectSaveLane {
  enqueue(project: CircuitProjectV2): void;
  flush(): Promise<DomainResult<{ persistedRevision: number }>>;
  retry(): void;
  dispose(): void;
}

declare global {
  interface Window {
    __fluxlabTestDelaySaveMs?: number;
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
const persistentId = z.string().min(1).max(128);

const localSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    theme: z.enum(["system", "light", "dark"]),
    reducedMotion: z.enum(["system", "reduce"]),
    defaultView: z.enum(["guided", "standard", "expert"]),
  })
  .strict();

const settingValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local-settings"), settings: localSettingsSchema }).strict(),
  z
    .object({
      kind: z.literal("lesson-session"),
      lessonId: persistentId,
      projectId: persistentId,
      templateKey: z.enum(["divider", "led", "rc", "engineering-review"]),
    })
    .strict(),
  z.object({ kind: z.literal("last-opened-project"), projectId: persistentId }).strict(),
  z
    .object({
      kind: z.literal("legacy-notice"),
      path: z.enum(["/divider", "/led", "/engineering", "/engineering/ops"]),
      acknowledged: z.literal(true),
    })
    .strict(),
]);

const settingEnvelopeSchema = z
  .object({
    envelopeVersion: z.literal(1),
    storageVersion: z.number().int().positive(),
    key: z.string().min(1),
    projectKey: z.tuple([persistentId, z.string().min(1)]).optional(),
    value: settingValueSchema,
  })
  .strict();

const projectEnvelopeSchema = z
  .object({
    envelopeVersion: z.literal(1),
    storageVersion: z.number().int().positive(),
    project: z.unknown(),
    listKey: z.tuple([isoDate, persistentId, z.string().min(1).max(200), z.number().int().positive()]),
    revisionKey: z.tuple([persistentId, z.number().int().positive(), z.number().int().positive()]),
  })
  .strict();

function fail<T>(code: string, message: string): DomainResult<T> {
  return { ok: false, diagnostics: [{ severity: "error", code, message, blocksRun: true }] };
}

function issuesToDiagnostics(issues: ZodIssue[]): Diagnostic[] {
  return issues.map(item => ({
    severity: "error" as const,
    code: item.code === "unrecognized_keys" ? "STORAGE_INVALID_SETTING" : "STORAGE_INVALID_SETTING",
    message: item.message,
    blocksRun: true,
  }));
}

export function deriveSettingKey(value: StoredSettingValue): string {
  if (value.kind === "local-settings") return "local-settings";
  if (value.kind === "lesson-session") return `lesson-session:${value.lessonId}`;
  if (value.kind === "last-opened-project") return "last-opened-project";
  return `legacy-notice:${value.path}`;
}

export function deriveSettingProjectKey(value: StoredSettingValue): readonly [ProjectId, string] | undefined {
  if (value.kind === "lesson-session") return [value.projectId, deriveSettingKey(value)];
  if (value.kind === "last-opened-project") return [value.projectId, "last-opened-project"];
  return undefined;
}

function sameProjectKey(left: readonly [string, string] | undefined, right: readonly [string, string] | undefined) {
  if (!left && !right) return true;
  return Boolean(left && right && left[0] === right[0] && left[1] === right[1]);
}

export function parseStoredSettingEnvelope(input: unknown): DomainResult<StoredSettingEnvelope> {
  const parsed = settingEnvelopeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, diagnostics: issuesToDiagnostics(parsed.error.issues) };
  const derivedKey = deriveSettingKey(parsed.data.value);
  const derivedProjectKey = deriveSettingProjectKey(parsed.data.value);
  if (parsed.data.key !== derivedKey || !sameProjectKey(parsed.data.projectKey, derivedProjectKey)) {
    return fail("STORAGE_INVALID_SETTING", "setting key fields do not match the payload");
  }
  return { ok: true, value: parsed.data as StoredSettingEnvelope, diagnostics: [] };
}

export function deriveProjectListKey(project: CircuitProjectV2): StoredProjectEnvelope["listKey"] {
  return [project.updatedAt, project.id, project.title, project.revision];
}

export function deriveProjectRevisionKey(project: CircuitProjectV2): StoredProjectEnvelope["revisionKey"] {
  return [project.id, project.revision, project.electricalRevision];
}

export function parseStoredProjectEnvelope(input: unknown): DomainResult<StoredProjectEnvelope> {
  const parsed = projectEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues.map(item => ({
        severity: "error" as const,
        code: "STORAGE_INVALID_PROJECT",
        message: item.message,
        blocksRun: true,
      })),
    };
  }
  const project = parseCircuitProjectV2(parsed.data.project);
  if (!project.ok) {
    return {
      ok: false,
      diagnostics: project.diagnostics.map(item => ({ ...item, code: item.code || "STORAGE_INVALID_PROJECT" })),
    };
  }
  const listKey = deriveProjectListKey(project.value);
  const revisionKey = deriveProjectRevisionKey(project.value);
  if (JSON.stringify(listKey) !== JSON.stringify(parsed.data.listKey) || JSON.stringify(revisionKey) !== JSON.stringify(parsed.data.revisionKey)) {
    return fail("STORAGE_INVALID_PROJECT", "project envelope keys do not match the stored project");
  }
  return {
    ok: true,
    value: {
      envelopeVersion: 1,
      storageVersion: parsed.data.storageVersion,
      project: project.value,
      listKey,
      revisionKey,
    },
    diagnostics: [],
  };
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) {
        const projects = db.createObjectStore("projects");
        projects.createIndex("listKey", "listKey", { unique: true });
        projects.createIndex("revisionKey", "revisionKey", { unique: true });
      }
      if (!db.objectStoreNames.contains("runSequences")) {
        db.createObjectStore("runSequences", { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains("runs")) {
        const runs = db.createObjectStore("runs");
        runs.createIndex("listKey", "listKey", { unique: true });
        runs.createIndex("status", "record.status");
      }
      if (!db.objectStoreNames.contains("lessonEvidence")) {
        const evidence = db.createObjectStore("lessonEvidence", { keyPath: "lessonKey" });
        evidence.createIndex("lessonKey", "lessonKey", { unique: true });
        evidence.createIndex("projectKey", "projectKey");
        evidence.createIndex("referencedRunIds", "referencedRunIds", { multiEntry: true });
      }
      if (!db.objectStoreNames.contains("settings")) {
        const settings = db.createObjectStore("settings", { keyPath: "key" });
        settings.createIndex("projectKey", "projectKey");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

export async function closeFluxlabDatabaseForTests(): Promise<void> {
  if (!databasePromise) return;
  const db = await databasePromise;
  db.close();
  databasePromise = null;
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("aborted", "AbortError"));
  });
}

function projectBound(projectId: ProjectId) {
  return IDBKeyRange.bound([projectId], [projectId, "\uffff"]);
}

async function maybeDelaySave() {
  const delay = typeof window !== "undefined" ? window.__fluxlabTestDelaySaveMs : undefined;
  if (typeof delay === "number" && delay > 0) {
    window.__fluxlabTestDelaySaveMs = 0;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export async function saveProject(
  expectedRevision: number | null,
  project: CircuitProjectV2
): Promise<DomainResult<CircuitProjectV2>> {
  const parsed = parseCircuitProjectV2(project);
  if (!parsed.ok) return parsed;
  const models = await validateProjectModels(parsed.value, "stored-model", await bundledManifestForValidation());
  if (!models.ok) return models;
  const envelope: StoredProjectEnvelope = {
    envelopeVersion: 1,
    storageVersion: 1,
    project: models.value,
    listKey: deriveProjectListKey(models.value),
    revisionKey: deriveProjectRevisionKey(models.value),
  };
  const checked = parseStoredProjectEnvelope(envelope);
  if (!checked.ok) return checked;
  await maybeDelaySave();
  const db = await openDatabase();
  let conflict = false;
  try {
    const tx = db.transaction(["projects", "runSequences"], "readwrite");
    const store = tx.objectStore("projects");
    const currentReq = store.get(models.value.id);
    currentReq.onsuccess = () => {
      const current = currentReq.result as StoredProjectEnvelope | undefined;
      if (expectedRevision === null) {
        if (current !== undefined) {
          conflict = true;
          tx.abort();
          return;
        }
        store.add(checked.value, models.value.id);
        tx.objectStore("runSequences").add({
          envelopeVersion: 1,
          projectId: models.value.id,
          nextAttempt: 1,
          storageVersion: 1,
        } satisfies StoredRunSequence);
        return;
      }
      const currentRevision = current && typeof current === "object" ? current.project?.revision : undefined;
      if (!current || currentRevision !== expectedRevision) {
        conflict = true;
        tx.abort();
        return;
      }
      store.put({ ...checked.value, storageVersion: current.storageVersion + 1 }, models.value.id);
    };
    await waitForTransaction(tx);
  } catch (error) {
    if (conflict) return fail("STORAGE_REVISION_CONFLICT", "project revision does not match the stored envelope");
    return fail("STORAGE_WRITE_FAILED", error instanceof Error ? error.message : "project write failed");
  }
  return { ok: true, value: models.value, diagnostics: [] };
}

export async function loadProject(projectId: ProjectId): Promise<DomainResult<CircuitProjectV2 | null>> {
  const db = await openDatabase();
  let raw: unknown;
  const tx = db.transaction("projects", "readonly");
  const request = tx.objectStore("projects").get(projectId);
  request.onsuccess = () => {
    raw = request.result;
  };
  await waitForTransaction(tx);
  if (raw === undefined) return { ok: true, value: null, diagnostics: [] };
  const envelope = parseStoredProjectEnvelope(raw);
  if (!envelope.ok) return fail("STORAGE_INVALID_PROJECT", "stored project envelope is invalid");
  const models = await validateProjectModels(envelope.value.project, "stored-model", await bundledManifestForValidation());
  if (!models.ok) return fail("STORAGE_INVALID_PROJECT", "stored project models are invalid");
  return { ok: true, value: models.value, diagnostics: [] };
}

function parseListKey(key: unknown, primary: unknown): ProjectSummary | null {
  if (!Array.isArray(key) || key.length !== 4) return null;
  const [updatedAt, projectId, title, revision] = key;
  if (typeof updatedAt !== "string" || typeof projectId !== "string" || typeof title !== "string" || typeof revision !== "number") {
    return null;
  }
  if (primary !== projectId) return null;
  return { projectId, title, updatedAt, revision };
}

export async function listProjects(): Promise<DomainResult<ProjectSummary[]>> {
  const db = await openDatabase();
  const summaries: ProjectSummary[] = [];
  const tx = db.transaction("projects", "readonly");
  const cursorReq = tx.objectStore("projects").index("listKey").openKeyCursor(null, "prev");
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const summary = parseListKey(cursor.key, cursor.primaryKey);
    if (summary) summaries.push(summary);
    cursor.continue();
  };
  await waitForTransaction(tx);
  return { ok: true, value: summaries, diagnostics: [] };
}

function deleteByIndex(store: IDBObjectStore, indexName: string, range: IDBKeyRange) {
  const request = store.index(indexName).openKeyCursor(range);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    store.delete(cursor.primaryKey);
    cursor.continue();
  };
}

export async function deleteProject(projectId: ProjectId): Promise<DomainResult<null>> {
  const db = await openDatabase();
  let missing = false;
  try {
    const tx = db.transaction(["projects", "runSequences", "runs", "lessonEvidence", "settings"], "readwrite");
    const projects = tx.objectStore("projects");
    const currentReq = projects.get(projectId);
    currentReq.onsuccess = () => {
      if (currentReq.result === undefined) {
        missing = true;
        tx.abort();
        return;
      }
      projects.delete(projectId);
      tx.objectStore("runSequences").delete(projectId);
      deleteByIndex(tx.objectStore("runs"), "listKey", projectBound(projectId));
      deleteByIndex(tx.objectStore("lessonEvidence"), "projectKey", projectBound(projectId));
      deleteByIndex(tx.objectStore("settings"), "projectKey", projectBound(projectId));
    };
    await waitForTransaction(tx);
  } catch (error) {
    if (missing) return fail("STORAGE_NOT_FOUND", "project does not exist");
    return fail("STORAGE_WRITE_FAILED", error instanceof Error ? error.message : "project delete failed");
  }
  return { ok: true, value: null, diagnostics: [] };
}

export function createProjectSaveLane(input: {
  persist: (expectedRevision: number | null, project: CircuitProjectV2) => Promise<DomainResult<CircuitProjectV2>>;
  onState: (state: ProjectSaveState) => void;
  persistedRevision: number;
}): ProjectSaveLane {
  let latestRevision = input.persistedRevision;
  let persistedRevision = input.persistedRevision;
  let latest: CircuitProjectV2 | null = null;
  let pending: CircuitProjectV2 | null = null;
  let inFlight = false;
  let failed = false;
  let disposed = false;
  let writeTail: Promise<void> = Promise.resolve();
  let lastDiagnostics: Diagnostic[] = [];

  function emit(status: ProjectSaveState["status"]) {
    if (disposed) return;
    if (status === "error") {
      input.onState({ status, latestRevision, persistedRevision, diagnostics: lastDiagnostics });
      return;
    }
    input.onState({ status, latestRevision, persistedRevision });
  }

  function pump() {
    if (disposed || failed || inFlight || !pending) return;
    const next = pending;
    pending = null;
    inFlight = true;
    emit("saving");
    writeTail = writeTail.then(async () => {
      if (disposed) {
        inFlight = false;
        return;
      }
      const result = await input.persist(persistedRevision, next);
      inFlight = false;
      if (disposed) return;
      if (!result.ok) {
        failed = true;
        lastDiagnostics = result.diagnostics;
        pending = latest;
        emit("error");
        return;
      }
      persistedRevision = next.revision;
      if (pending) {
        emit(pending.revision === latestRevision ? "saving" : "dirty");
        pump();
        return;
      }
      emit(latestRevision === persistedRevision ? "saved" : "dirty");
    });
  }

  return {
    enqueue(project) {
      if (disposed || failed) {
        latest = project;
        latestRevision = project.revision;
        pending = project;
        if (failed) emit("error");
        else emit("dirty");
        return;
      }
      latest = project;
      latestRevision = project.revision;
      pending = project;
      emit(inFlight ? "saving" : "dirty");
      queueMicrotask(() => pump());
    },
    async flush() {
      await Promise.resolve();
      await writeTail;
      while (!disposed && !failed && (inFlight || pending)) {
        await writeTail;
        await Promise.resolve();
      }
      if (failed) return { ok: false, diagnostics: lastDiagnostics };
      return { ok: true, value: { persistedRevision }, diagnostics: [] };
    },
    retry() {
      if (disposed) return;
      failed = false;
      if (latest) pending = latest;
      emit("dirty");
      queueMicrotask(() => pump());
    },
    dispose() {
      disposed = true;
    },
  };
}

function cornerKeyOf(record: RunRecord) {
  return record.corner?.cornerId ?? "nominal";
}

export function deriveRunListKey(record: RunRecord, localAttempt: number): StoredRunEnvelope["listKey"] {
  return [record.projectId, localAttempt, record.startedAt, record.analysisId, record.status, cornerKeyOf(record), record.runId];
}

function listKeysEqual(left: StoredRunEnvelope["listKey"], right: StoredRunEnvelope["listKey"]) {
  return left.every((value, index) => value === right[index]);
}

export async function parseStoredRunEnvelope(input: unknown): Promise<DomainResult<StoredRunEnvelope>> {
  if (!input || typeof input !== "object") return fail("STORAGE_INVALID_RUN", "run envelope is not an object");
  const envelope = input as StoredRunEnvelope;
  if (envelope.envelopeVersion !== 1 || !Number.isSafeInteger(envelope.storageVersion) || envelope.storageVersion < 1) {
    return fail("STORAGE_INVALID_RUN", "run envelope version fields are invalid");
  }
  if (!Number.isSafeInteger(envelope.localAttempt) || envelope.localAttempt < 1) {
    return fail("STORAGE_INVALID_RUN", "localAttempt is not a positive safe integer");
  }
  const record = await parseRunRecord(envelope.record);
  if (!record.ok) return record;
  const hash = await computeImmutableBaseHash(record.value);
  if (hash !== envelope.immutableBaseHash) return fail("STORAGE_RUN_HASH", "immutableBaseHash does not recompute");
  const listKey = deriveRunListKey(record.value, envelope.localAttempt);
  if (!Array.isArray(envelope.listKey) || !listKeysEqual(listKey, envelope.listKey as StoredRunEnvelope["listKey"])) {
    return fail("STORAGE_INVALID_RUN", "run listKey does not match the record");
  }
  return {
    ok: true,
    value: {
      envelopeVersion: 1,
      storageVersion: envelope.storageVersion,
      localAttempt: envelope.localAttempt,
      immutableBaseHash: hash,
      record: record.value,
      listKey,
    },
    diagnostics: [],
  };
}

async function readRawRun(runId: RunId): Promise<unknown> {
  const db = await openDatabase();
  let raw: unknown;
  const tx = db.transaction("runs", "readonly");
  const request = tx.objectStore("runs").get(runId);
  request.onsuccess = () => {
    raw = request.result;
  };
  await waitForTransaction(tx);
  return raw;
}

export async function createRunningRun(run: RunningRunRecord): Promise<DomainResult<StoredRunEnvelope>> {
  const parsed = await parseRunRecord(run);
  if (!parsed.ok) return parsed;
  if (parsed.value.status !== "running") return fail("RUN_BAD_TRANSITION", "createRunningRun requires a running record");
  const immutableBaseHash = await computeImmutableBaseHash(parsed.value);
  const db = await openDatabase();
  let created: StoredRunEnvelope | undefined;
  let code = "STORAGE_WRITE_FAILED";
  try {
    const tx = db.transaction(["projects", "runSequences", "runs"], "readwrite");
    const revisionRange = IDBKeyRange.only([parsed.value.projectId, parsed.value.projectRevision, parsed.value.electricalRevision]);
    const cursorReq = tx.objectStore("projects").index("revisionKey").openKeyCursor(revisionRange);
    cursorReq.onsuccess = () => {
      if (!cursorReq.result) {
        code = "STORAGE_RUN_STALE_PROJECT";
        tx.abort();
        return;
      }
      const sequenceReq = tx.objectStore("runSequences").get(parsed.value.projectId);
      sequenceReq.onsuccess = () => {
        const sequence = sequenceReq.result as StoredRunSequence | undefined;
        if (!sequence || !Number.isSafeInteger(sequence.nextAttempt) || sequence.nextAttempt < 1) {
          code = "STORAGE_INVALID_RUN_SEQUENCE";
          tx.abort();
          return;
        }
        if (sequence.nextAttempt === Number.MAX_SAFE_INTEGER) {
          code = "STORAGE_RUN_SEQUENCE_EXHAUSTED";
          tx.abort();
          return;
        }
        const localAttempt = sequence.nextAttempt;
        created = {
          envelopeVersion: 1,
          storageVersion: 1,
          localAttempt,
          immutableBaseHash,
          record: parsed.value,
          listKey: deriveRunListKey(parsed.value, localAttempt),
        };
        tx.objectStore("runSequences").put({
          ...sequence,
          nextAttempt: sequence.nextAttempt + 1,
          storageVersion: sequence.storageVersion + 1,
        });
        tx.objectStore("runs").add(created, parsed.value.runId);
      };
    };
    await waitForTransaction(tx);
  } catch (error) {
    return fail(code, error instanceof Error ? error.message : "createRunningRun failed");
  }
  if (!created) return fail(code, "createRunningRun did not persist an envelope");
  return { ok: true, value: created, diagnostics: [] };
}

export async function finishRun(candidate: TerminalRunRecord): Promise<DomainResult<StoredRunEnvelope>> {
  const raw = await readRawRun(candidate.runId);
  if (raw === undefined) return fail("STORAGE_NOT_FOUND", "run does not exist");
  const current = await parseStoredRunEnvelope(raw);
  if (!current.ok) return current;
  if (current.value.record.status !== "running") return fail("STORAGE_RUN_CONFLICT", "run is not running");
  const parsed = await parseRunRecord(candidate);
  if (!parsed.ok) return parsed;
  const immutableBaseHash = await computeImmutableBaseHash(parsed.value);
  if (immutableBaseHash !== current.value.immutableBaseHash) return fail("STORAGE_RUN_HASH", "terminal record changed immutable base fields");
  const next: StoredRunEnvelope = {
    envelopeVersion: 1,
    storageVersion: current.value.storageVersion + 1,
    localAttempt: current.value.localAttempt,
    immutableBaseHash,
    record: parsed.value,
    listKey: deriveRunListKey(parsed.value, current.value.localAttempt),
  };
  const db = await openDatabase();
  let conflict = false;
  try {
    const tx = db.transaction("runs", "readwrite");
    const request = tx.objectStore("runs").get(candidate.runId);
    request.onsuccess = () => {
      const stored = request.result as StoredRunEnvelope | undefined;
      if (
        !stored ||
        stored.storageVersion !== current.value.storageVersion ||
        stored.localAttempt !== current.value.localAttempt ||
        stored.immutableBaseHash !== current.value.immutableBaseHash ||
        stored.record.runId !== candidate.runId ||
        stored.record.status !== "running"
      ) {
        conflict = true;
        tx.abort();
        return;
      }
      tx.objectStore("runs").put(next, candidate.runId);
    };
    await waitForTransaction(tx);
  } catch (error) {
    if (conflict) return fail("STORAGE_RUN_CONFLICT", "run changed before the terminal write");
    return fail("STORAGE_WRITE_FAILED", error instanceof Error ? error.message : "finishRun failed");
  }
  return { ok: true, value: next, diagnostics: [] };
}

export async function appendAssertionEvaluation(
  runId: RunId,
  evaluation: AssertionEvaluation
): Promise<DomainResult<StoredRunEnvelope>> {
  const raw = await readRawRun(runId);
  if (raw === undefined) return fail("STORAGE_NOT_FOUND", "run does not exist");
  const current = await parseStoredRunEnvelope(raw);
  if (!current.ok) return current;
  if (current.value.record.status !== "success") return fail("RUN_BAD_TRANSITION", "assertions can only append to a success record");
  const success = current.value.record as SuccessfulRunRecord;
  const existing = success.assertionEvaluations.find(item => item.id === evaluation.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(evaluation)) return fail("RUN_EVALUATION_CORRUPT", "duplicate evaluation id has a different payload");
    return { ok: true, value: current.value, diagnostics: [] };
  }
  const nextRecord: SuccessfulRunRecord = {
    ...success,
    assertionEvaluations: [...success.assertionEvaluations, evaluation],
  };
  const parsed = await parseRunRecord(nextRecord);
  if (!parsed.ok) return parsed;
  const next: StoredRunEnvelope = {
    ...current.value,
    storageVersion: current.value.storageVersion + 1,
    record: parsed.value,
    listKey: deriveRunListKey(parsed.value, current.value.localAttempt),
  };
  const db = await openDatabase();
  let conflict = false;
  try {
    const tx = db.transaction("runs", "readwrite");
    const request = tx.objectStore("runs").get(runId);
    request.onsuccess = () => {
      const stored = request.result as StoredRunEnvelope | undefined;
      if (
        !stored ||
        stored.storageVersion !== current.value.storageVersion ||
        stored.localAttempt !== current.value.localAttempt ||
        stored.immutableBaseHash !== current.value.immutableBaseHash
      ) {
        conflict = true;
        tx.abort();
        return;
      }
      tx.objectStore("runs").put(next, runId);
    };
    await waitForTransaction(tx);
  } catch (error) {
    if (conflict) {
      const latestRaw = await readRawRun(runId);
      const latest = latestRaw === undefined ? undefined : await parseStoredRunEnvelope(latestRaw);
      if (latest?.ok && latest.value.record.status === "success") {
        const hit = (latest.value.record as SuccessfulRunRecord).assertionEvaluations.find(item => item.id === evaluation.id);
        if (hit && JSON.stringify(hit) === JSON.stringify(evaluation)) return { ok: true, value: latest.value, diagnostics: [] };
        if (hit) return fail("RUN_EVALUATION_CORRUPT", "duplicate evaluation id has a different payload");
      }
      return fail("STORAGE_RUN_CONFLICT", "run changed before the evaluation write");
    }
    return fail("STORAGE_WRITE_FAILED", error instanceof Error ? error.message : "appendAssertionEvaluation failed");
  }
  return { ok: true, value: next, diagnostics: [] };
}

export async function loadRun(runId: RunId): Promise<DomainResult<StoredRunEnvelope | null>> {
  const raw = await readRawRun(runId);
  if (raw === undefined) return { ok: true, value: null, diagnostics: [] };
  return parseStoredRunEnvelope(raw);
}

export async function listProjectRunEnvelopes(projectId: ProjectId): Promise<DomainResult<StoredRunEnvelope[]>> {
  const listed = await listRuns(projectId);
  if (!listed.ok) return listed;
  const envelopes: StoredRunEnvelope[] = [];
  for (const summary of listed.value) {
    const loaded = await loadRun(summary.runId);
    if (!loaded.ok) return loaded;
    if (loaded.value) envelopes.push(loaded.value);
  }
  return { ok: true, value: envelopes, diagnostics: [] };
}

export async function listRuns(projectId: ProjectId): Promise<DomainResult<RunSummary[]>> {
  const db = await openDatabase();
  const summaries: RunSummary[] = [];
  const tx = db.transaction("runs", "readonly");
  const cursorReq = tx.objectStore("runs").index("listKey").openKeyCursor(projectBound(projectId));
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const key = cursor.key;
    if (Array.isArray(key) && key.length === 7) {
      summaries.push({
        projectId: String(key[0]),
        localAttempt: Number(key[1]),
        startedAt: String(key[2]),
        analysisId: String(key[3]),
        status: key[4] as RunRecord["status"],
        cornerKey: String(key[5]),
        runId: String(key[6]),
      });
    }
    cursor.continue();
  };
  await waitForTransaction(tx);
  return { ok: true, value: summaries, diagnostics: [] };
}

export async function recoverInterruptedRuns(): Promise<DomainResult<Array<{ runId: RunId; status: string; code?: string }>>> {
  const db = await openDatabase();
  const runningIds: RunId[] = [];
  const collect = db.transaction("runs", "readonly");
  const cursorReq = collect.objectStore("runs").index("status").openKeyCursor(IDBKeyRange.only("running"));
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    runningIds.push(String(cursor.primaryKey));
    cursor.continue();
  };
  await waitForTransaction(collect);
  const summaries: Array<{ runId: RunId; status: string; code?: string }> = [];
  for (const runId of runningIds) {
    const raw = await readRawRun(runId);
    const parsed = raw === undefined ? undefined : await parseStoredRunEnvelope(raw);
    if (!parsed?.ok) {
      summaries.push({ runId, status: "invalid", code: "STORAGE_INVALID_RUN" });
      continue;
    }
    if (parsed.value.record.status !== "running") continue;
    const lockName = `fluxlab-run:${runId}`;
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      let busy = false;
      await navigator.locks.request(lockName, { mode: "exclusive", ifAvailable: true }, async lock => {
        if (!lock) {
          busy = true;
          return;
        }
        const recovered = recoverInterruptedRun(parsed.value.record as RunningRunRecord, new Date().toISOString());
        if (!recovered.ok) {
          summaries.push({ runId, status: "failed", code: recovered.diagnostics[0]?.code });
          return;
        }
        const finished = await finishRun(recovered.value);
        summaries.push({
          runId,
          status: finished.ok ? "interrupted" : "failed",
          code: finished.ok ? "RUN_INTERRUPTED" : finished.diagnostics[0]?.code,
        });
      });
      if (busy) summaries.push({ runId, status: "running", code: "RUN_ACTIVE_IN_OTHER_TAB" });
    } else {
      const recovered = recoverInterruptedRun(parsed.value.record as RunningRunRecord, new Date().toISOString());
      if (!recovered.ok) {
        summaries.push({ runId, status: "failed", code: recovered.diagnostics[0]?.code });
        continue;
      }
      const finished = await finishRun(recovered.value);
      summaries.push({
        runId,
        status: finished.ok ? "interrupted" : "failed",
        code: finished.ok ? "RUN_INTERRUPTED" : finished.diagnostics[0]?.code,
      });
    }
  }
  return { ok: true, value: summaries, diagnostics: [] };
}

export async function pruneRuns(
  projectId: ProjectId,
  protectedRunIds: RunId[],
  keep = 20
): Promise<DomainResult<{ deleted: RunId[]; blocked?: string }>> {
  const listed = await listRuns(projectId);
  if (!listed.ok) return listed;
  const protectedSet = new Set(protectedRunIds);
  const terminals = listed.value
    .filter(item => item.status !== "running")
    .sort((left, right) => left.localAttempt - right.localAttempt);
  const runningCount = listed.value.filter(item => item.status === "running").length;
  const extra = terminals.length + runningCount - keep;
  const deleted: RunId[] = [];
  if (extra <= 0) return { ok: true, value: { deleted }, diagnostics: [] };
  const victims = terminals.filter(item => !protectedSet.has(item.runId)).slice(0, extra);
  if (victims.length < extra && terminals.some(item => protectedSet.has(item.runId))) {
    return fail("RUN_RETENTION_BLOCKED", "protected evidence keeps the project above the retention limit");
  }
  const db = await openDatabase();
  const tx = db.transaction("runs", "readwrite");
  for (const victim of victims) tx.objectStore("runs").delete(victim.runId);
  await waitForTransaction(tx);
  deleted.push(...victims.map(item => item.runId));
  return { ok: true, value: { deleted }, diagnostics: [] };
}

declare global {
  interface Window {
    __fluxlabRunStorage?: any;
    __fluxlabBuildRunningRecord?: any;
  }
}

if (typeof window !== "undefined") {
  window.__fluxlabRunStorage = {
    createRunningRun,
    finishRun,
    recoverInterruptedRuns,
    listRuns,
    listProjectRunEnvelopes,
    loadRun,
    loadProject,
    saveProject,
    deleteProject,
  };
  window.__fluxlabBuildRunningRecord = buildRunningRecordForProject;
}
