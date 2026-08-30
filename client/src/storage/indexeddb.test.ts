import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../tests/fixtures/circuits/projects";
import { applyProjectCommand } from "../features/editor/project-reducer";
import {
  closeFluxlabDatabaseForTests,
  createProjectSaveLane,
  deleteProject,
  listProjects,
  loadProject,
  parseStoredSettingEnvelope,
  saveProject,
  type StoredSettingEnvelope,
} from "./indexeddb";

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
