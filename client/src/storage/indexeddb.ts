import { bundledManifestForValidation } from "../domain/project/bundled-models";
import { parseCircuitProjectV2 } from "../domain/project/project-schema";
import type { CircuitProjectV2, Diagnostic, DomainResult, ProjectId } from "../domain/project/project-v2";
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
        const runs = db.createObjectStore("runs", { keyPath: "record.id" });
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
