import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import { applyProjectCommand } from "../features/editor/project-reducer";
import {
  closeFluxlabDatabaseForTests,
  createProjectSaveLane,
  createRunningRun,
  deleteProject,
  deriveLearningEvidenceEnvelope,
  listProjects,
  loadLearningEvidence,
  loadLessonSession,
  loadProject,
  parseStoredLearningEvidenceEnvelope,
  parseStoredSettingEnvelope,
  putLearningEvidence,
  acknowledgeLegacyNotice,
  hasAcknowledgedLegacyNotice,
  loadLastOpenedProject,
  saveLastOpenedProject,
  saveLessonSession,
  loadLocalSettings,
  saveLocalSettings,
  saveProject,
  type StoredSettingEnvelope,
} from "./indexeddb";
import * as indexeddbApi from "./indexeddb";
import { buildRunningRecordForProject } from "../simulation/run-record";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function resetDatabase() {
  await closeFluxlabDatabaseForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("fluxlab");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

afterEach(async () => {
  await resetDatabase();
});

describe("setting envelopes", () => {
  it("accepts every fixed key and rejects drift", () => {
    const local: StoredSettingEnvelope = {
      envelopeVersion: 1,
      storageVersion: 1,
      key: "local-settings",
      value: {
        kind: "local-settings",
        settings: { schemaVersion: 1, theme: "dark", reducedMotion: "system", defaultView: "standard" },
      },
    };
    expect(parseStoredSettingEnvelope(local).ok).toBe(true);

    const lesson: StoredSettingEnvelope = {
      envelopeVersion: 1,
      storageVersion: 1,
      key: "lesson-session:lesson-a",
      projectKey: ["proj-a", "lesson-session:lesson-a"],
      value: { kind: "lesson-session", lessonId: "lesson-a", projectId: "proj-a", templateKey: "divider" },
    };
    expect(parseStoredSettingEnvelope(lesson).ok).toBe(true);

    const last: StoredSettingEnvelope = {
      envelopeVersion: 1,
      storageVersion: 1,
      key: "last-opened-project",
      projectKey: ["proj-a", "last-opened-project"],
      value: { kind: "last-opened-project", projectId: "proj-a" },
    };
    expect(parseStoredSettingEnvelope(last).ok).toBe(true);

    const notice: StoredSettingEnvelope = {
      envelopeVersion: 1,
      storageVersion: 1,
      key: "legacy-notice:/divider",
      value: { kind: "legacy-notice", path: "/divider", acknowledged: true },
    };
    expect(parseStoredSettingEnvelope(notice).ok).toBe(true);

    expect(parseStoredSettingEnvelope({ ...last, key: "local-settings" }).ok).toBe(false);
    expect(parseStoredSettingEnvelope({ ...lesson, projectKey: ["other", "lesson-session:lesson-a"] }).ok).toBe(false);
    expect(parseStoredSettingEnvelope({ ...local, extra: true }).ok).toBe(false);
    expect(parseStoredSettingEnvelope({ ...local, value: { kind: "local-settings", settings: { schemaVersion: 1 } } }).ok).toBe(false);
  });
});

describe("dedicated navigation setting APIs", () => {
  it("writes only the fixed keys and rejects parser drift", async () => {
    const project = dividerProjectFixture();
    expect(await saveProject(null, project)).toMatchObject({ ok: true });
    const last = await saveLastOpenedProject(project.id);
    expect(last.ok && last.value.key).toBe("last-opened-project");
    expect(last.ok && last.value.projectKey).toEqual([project.id, "last-opened-project"]);
    const loaded = await loadLastOpenedProject();
    expect(loaded.ok && loaded.value?.projectId).toBe(project.id);

    const notice = await acknowledgeLegacyNotice("/divider");
    expect(notice.ok && notice.value.key).toBe("legacy-notice:/divider");
    const dividerAck = await hasAcknowledgedLegacyNotice("/divider");
    const ledAck = await hasAcknowledgedLegacyNotice("/led");
    expect(dividerAck.ok && dividerAck.value).toBe(true);
    expect(ledAck.ok && ledAck.value).toBe(false);

    expect(
      parseStoredSettingEnvelope({
        envelopeVersion: 1,
        storageVersion: 1,
        key: "legacy-notice:/divider",
        value: { kind: "last-opened-project", projectId: project.id },
      }).ok
    ).toBe(false);
    expect(
      parseStoredSettingEnvelope({
        envelopeVersion: 1,
        storageVersion: 1,
        key: "last-opened-project",
        projectKey: ["other", "last-opened-project"],
        value: { kind: "last-opened-project", projectId: project.id },
      }).ok
    ).toBe(false);
    expect("writeSetting" in indexeddbApi).toBe(false);
    expect("readSetting" in indexeddbApi).toBe(false);
    expect("getSetting" in indexeddbApi).toBe(false);
    expect("putSetting" in indexeddbApi).toBe(false);
  });
});

describe("project persistence", () => {
  it("creates, lists from keys, loads, conflicts, and deletes", async () => {
    const created = await saveProject(null, dividerProjectFixture());
    expect(created.ok).toBe(true);
    const listed = await listProjects();
    expect(listed.ok && listed.value.map(item => item.projectId)).toEqual(["proj-divider-v2"]);
    const loaded = await loadProject("proj-divider-v2");
    expect(loaded.ok && loaded.value?.revision).toBe(1);
    const conflict = await saveProject(null, dividerProjectFixture());
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.diagnostics[0]?.code).toBe("STORAGE_REVISION_CONFLICT");
    const removed = await deleteProject("proj-divider-v2");
    expect(removed.ok).toBe(true);
    const empty = await loadProject("proj-divider-v2");
    expect(empty.ok && empty.value).toBeNull();
  });
});

describe("learning evidence and lesson sessions", () => {
  it("writes derived envelopes, sessions, and cascades five stores", async () => {
    const project = dividerProjectFixture();
    const saved = await saveProject(null, project);
    expect(saved.ok).toBe(true);
    const evidence = {
      projectId: project.id,
      lessonId: "foundation-divider",
      steps: [
        {
          stepId: "step-predict-6v",
          projectRevision: 1,
          runId: "run-keep",
          prediction: 6,
          assertionResultIds: ["assertion-result:v1:aaa"],
          completedAt: "2026-08-31T00:00:00.000Z",
        },
      ],
    };
    const derived = deriveLearningEvidenceEnvelope(evidence, 1);
    expect(derived.referencedRunIds).toEqual(["run-keep"]);
    expect(parseStoredLearningEvidenceEnvelope({ ...derived, referencedRunIds: ["run-keep", "run-keep"] }).ok).toBe(false);
    const put = await putLearningEvidence(null, evidence);
    expect(put.ok).toBe(true);
    const loaded = await loadLearningEvidence(project.id, "foundation-divider");
    expect(loaded.ok && loaded.value?.storageVersion).toBe(1);
    const session = await saveLessonSession({
      kind: "lesson-session",
      lessonId: "foundation-divider",
      projectId: project.id,
      templateKey: "divider",
    });
    expect(session.ok).toBe(true);
    const mapped = await loadLessonSession("foundation-divider");
    expect(mapped.ok && mapped.value?.projectId).toBe(project.id);
    await saveLastOpenedProject(project.id);
    await saveLocalSettings({ schemaVersion: 1, theme: "dark", reducedMotion: "system", defaultView: "standard" });
    const removed = await deleteProject(project.id);
    expect(removed.ok).toBe(true);
    const gone = await loadLearningEvidence(project.id, "foundation-divider");
    expect(gone.ok && gone.value).toBeNull();
    const sessionGone = await loadLessonSession("foundation-divider");
    expect(sessionGone.ok && sessionGone.value).toBeNull();
  });
});

describe("project save lane", () => {
  function projectAt(revision: number) {
    const base = dividerProjectFixture();
    return { ...base, revision, updatedAt: `2026-08-28T00:00:0${revision}.000Z` };
  }

  it("keeps dirty while an older write is in flight, then saves the newest", async () => {
    const gate = deferred<void>();
    const calls: number[] = [];
    const states: string[] = [];
    const persist = async (_expected: number | null, project: ReturnType<typeof projectAt>) => {
      calls.push(project.revision);
      if (project.revision === 2) await gate.promise;
      return { ok: true as const, value: project, diagnostics: [] };
    };
    const lane = createProjectSaveLane({
      persist,
      onState: state => states.push(state.status),
      persistedRevision: 1,
    });
    lane.enqueue(projectAt(2));
    await Promise.resolve();
    lane.enqueue(projectAt(3));
    expect(states.includes("saved")).toBe(false);
    gate.resolve();
    const flushed = await lane.flush();
    expect(flushed.ok && flushed.value.persistedRevision).toBe(3);
    expect(calls).toEqual([2, 3]);
    expect(states.at(-1)).toBe("saved");
    lane.dispose();
  });

  it("writes coalesced rev3 when both arrive before a write starts", async () => {
    const calls: number[] = [];
    const persist = async (_expected: number | null, project: ReturnType<typeof projectAt>) => {
      calls.push(project.revision);
      return { ok: true as const, value: project, diagnostics: [] };
    };
    const lane = createProjectSaveLane({ persist, onState: () => undefined, persistedRevision: 1 });
    lane.enqueue(projectAt(2));
    lane.enqueue(projectAt(3));
    const flushed = await lane.flush();
    expect(flushed.ok && flushed.value.persistedRevision).toBe(3);
    expect(calls).toEqual([3]);
    lane.dispose();
  });

  it("stops on failure and resumes only after retry", async () => {
    let failOnce = true;
    const persist = async (_expected: number | null, project: ReturnType<typeof projectAt>) => {
      if (failOnce) {
        failOnce = false;
        return { ok: false as const, diagnostics: [{ severity: "error" as const, code: "STORAGE_WRITE_FAILED", message: "disk", blocksRun: true }] };
      }
      return { ok: true as const, value: project, diagnostics: [] };
    };
    const states: string[] = [];
    const lane = createProjectSaveLane({ persist, onState: state => states.push(state.status), persistedRevision: 1 });
    lane.enqueue(projectAt(2));
    const failed = await lane.flush();
    expect(failed.ok).toBe(false);
    expect(states.at(-1)).toBe("error");
    lane.retry();
    const flushed = await lane.flush();
    expect(flushed.ok && flushed.value.persistedRevision).toBe(2);
    lane.dispose();
  });

  it("ignores completions after dispose", async () => {
    const gate = deferred<void>();
    let lastStatus = "none";
    const persist = async (_expected: number | null, project: ReturnType<typeof projectAt>) => {
      await gate.promise;
      return { ok: true as const, value: project, diagnostics: [] };
    };
    const lane = createProjectSaveLane({
      persist,
      onState: state => {
        lastStatus = state.status;
      },
      persistedRevision: 1,
    });
    lane.enqueue(projectAt(2));
    await Promise.resolve();
    lane.dispose();
    gate.resolve();
    await lane.flush();
    expect(lastStatus).not.toBe("saved");
  });
});

const ENGINE = {
  name: "ngspice" as const,
  version: "ngspice-46",
  resultTransport: "binary-rawfile" as const,
  moduleSha256: "b285fc2d5b19135ed9b775ab41a6ceeb9bb75482bc6b3a44956cc6c959406b93",
  wasmSha256: "710da3c95ca4c86ffd87db6189e80b7d56c630801625db3129e203726701e59c",
  engineBuildId: "ngspice-46-emscripten-singlethread-256m-20260527",
};

describe("run sequence allocation", () => {
  it("assigns localAttempt 1 then 2", async () => {
    const project = dividerProjectFixture();
    const saved = await saveProject(null, project);
    expect(saved.ok).toBe(true);
    const firstRecord = await buildRunningRecordForProject({
      project,
      analysisId: project.analyses[0]!.id,
      runId: "run-1",
      appBuildId: "verify-test",
      engine: ENGINE,
      startedAt: "2026-08-31T00:00:00.000Z",
    });
    const secondRecord = await buildRunningRecordForProject({
      project,
      analysisId: project.analyses[0]!.id,
      runId: "run-2",
      appBuildId: "verify-test",
      engine: ENGINE,
      startedAt: "2026-08-31T00:00:01.000Z",
    });
    expect(firstRecord.ok && secondRecord.ok).toBe(true);
    if (!firstRecord.ok || !secondRecord.ok) return;
    const first = await createRunningRun(firstRecord.value);
    const second = await createRunningRun(secondRecord.value);
    expect(first.ok && first.value.localAttempt).toBe(1);
    expect(second.ok && second.value.localAttempt).toBe(2);
  });

  it("fails closed when the sequence is exhausted", async () => {
    const project = dividerProjectFixture();
    project.id = "proj-exhausted";
    const saved = await saveProject(null, project);
    expect(saved.ok).toBe(true);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("fluxlab", 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("runSequences", "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore("runSequences").put({
          envelopeVersion: 1,
          projectId: project.id,
          nextAttempt: Number.MAX_SAFE_INTEGER,
          storageVersion: 2,
        });
      };
      request.onerror = () => reject(request.error);
    });
    const record = await buildRunningRecordForProject({
      project,
      analysisId: project.analyses[0]!.id,
      runId: "run-exhausted",
      appBuildId: "verify-test",
      engine: ENGINE,
      startedAt: "2026-08-31T00:00:00.000Z",
    });
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    const created = await createRunningRun(record.value);
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.diagnostics[0]?.code).toBe("STORAGE_RUN_SEQUENCE_EXHAUSTED");
  });
});

describe("local settings preferences", () => {
  it("round-trips only under local-settings and rejects extra fields without a write", async () => {
    const saved = await saveLocalSettings({
      schemaVersion: 1,
      theme: "light",
      reducedMotion: "reduce",
      defaultView: "expert",
    });
    expect(saved.ok).toBe(true);
    const loaded = await loadLocalSettings();
    expect(loaded.ok && loaded.value).toEqual({
      schemaVersion: 1,
      theme: "light",
      reducedMotion: "reduce",
      defaultView: "expert",
    });
    const rejected = await saveLocalSettings({
      schemaVersion: 1,
      theme: "dark",
      reducedMotion: "system",
      defaultView: "standard",
      extra: true,
    } as never);
    expect(rejected.ok).toBe(false);
    const after = await loadLocalSettings();
    expect(after.ok && after.value?.theme).toBe("light");
    const lessonPayload = parseStoredSettingEnvelope({
      envelopeVersion: 1,
      storageVersion: 1,
      key: "local-settings",
      value: { kind: "lesson-session", lessonId: "foundation-divider", projectId: "p1", templateKey: "divider" },
    });
    expect(lessonPayload.ok).toBe(false);
    const extraField = parseStoredSettingEnvelope({
      envelopeVersion: 1,
      storageVersion: 1,
      key: "local-settings",
      value: {
        kind: "local-settings",
        settings: { schemaVersion: 1, theme: "dark", reducedMotion: "system", defaultView: "standard", extra: 1 },
      },
    });
    expect(extraField.ok).toBe(false);
    const still = await loadLocalSettings();
    expect(still.ok && still.value?.theme).toBe("light");
  });
});

describe("revision commands used by the save lane", () => {
  it("can produce a later electrical revision for persist tests", () => {
    const moved = applyProjectCommand(
      dividerProjectFixture(),
      { type: "component/replace", component: { id: "R2", refdes: "R2", kind: "resistor", params: { resistanceOhm: 3000 } } },
      "2026-08-28T00:00:01.000Z"
    );
    expect(moved.ok && moved.value.revision).toBe(2);
  });
});
