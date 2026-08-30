import { describe, expect, it } from "vitest";
import { createDividerTemplate, createTemplateForKey } from "../../domain/project/templates";
import type { SuccessfulRunRecord } from "../../simulation/contracts";
import { deriveLearningEvidenceEnvelope, parseStoredLearningEvidenceEnvelope, parseStoredSettingEnvelope } from "../../storage/indexeddb";
import * as storage from "../../storage/indexeddb";
import type { LearningEvidence, LessonDefinition } from "./contracts";
import { catalogLockState } from "./evidence";
import {
  canPerformLessonAction,
  completeLessonStep,
  evidenceHasEveryStepOnce,
  FOUNDATION_DIVIDER,
  lessonEvidenceStillValid,
  listLessons,
  validateLessonCatalog,
  validateLessonDefinition,
} from "./lessons";

async function dividerTemplate() {
  const created = await createDividerTemplate("proj-divider-lesson", "2026-08-31T00:00:00.000Z");
  if (!created.ok) throw new Error("template failed");
  return created.value;
}

function brokenLesson(): LessonDefinition {
  return {
    ...FOUNDATION_DIVIDER,
    steps: [
      {
        ...FOUNDATION_DIVIDER.steps[0]!,
        requiredAnalysisId: "missing-analysis",
        assertionIds: ["missing-assertion"],
      },
    ],
  };
}

function sampleEvidence(overrides: Partial<LearningEvidence> = {}): LearningEvidence {
  return {
    projectId: "proj-a",
    lessonId: "foundation-divider",
    steps: [
      {
        stepId: "step-predict-6v",
        projectRevision: 1,
        runId: "run-b",
        prediction: 6,
        assertionResultIds: ["assertion-result:v1:aaa"],
        completedAt: "2026-08-31T00:00:00.000Z",
      },
      {
        stepId: "step-after-r2",
        projectRevision: 2,
        runId: "run-a",
        prediction: 6,
        assertionResultIds: ["assertion-result:v1:bbb"],
        completedAt: "2026-08-31T00:00:01.000Z",
      },
    ],
    ...overrides,
  };
}

describe("lesson registry", () => {
  it("blocks a lesson that references a missing analysis or assertion", async () => {
    const diagnostics = validateLessonDefinition(brokenLesson(), await dividerTemplate());
    expect(diagnostics.map(item => item.code)).toEqual(["LESSON_UNKNOWN_ANALYSIS", "LESSON_UNKNOWN_ASSERTION"]);
    expect(diagnostics.every(item => item.blocksRun)).toBe(true);
  });

  it("accepts the four registered lessons against their templates", async () => {
    for (const lesson of listLessons()) {
      const template = await createTemplateForKey(lesson.templateKey, `proj-${lesson.id}`, "2026-08-31T00:00:00.000Z");
      expect(template.ok).toBe(true);
      if (!template.ok) continue;
      expect(validateLessonDefinition(lesson, template.value)).toEqual([]);
    }
    expect(validateLessonCatalog(listLessons())).toEqual([]);
    expect(validateLessonCatalog([{ ...FOUNDATION_DIVIDER, prerequisiteLessonIds: ["foundation-divider"] }]).map(item => item.code)).toContain(
      "LESSON_PREREQ_SELF"
    );
    expect(validateLessonCatalog([{ ...FOUNDATION_DIVIDER, prerequisiteLessonIds: ["ghost"] }]).map(item => item.code)).toContain("LESSON_UNKNOWN_PREREQ");
  });

  it("gates guided actions and empty predictions", async () => {
    const step = FOUNDATION_DIVIDER.steps[0]!;
    expect(canPerformLessonAction(step, "analysis:run")).toBe(true);
    expect(canPerformLessonAction(step, "component:add")).toBe(false);
    const project = await dividerTemplate();
    const fakeRun = { projectRevision: 1, electricalRevision: 1, analysisId: "an-op", assertionEvaluations: [] } as unknown as SuccessfulRunRecord;
    const empty = await completeLessonStep({
      lesson: FOUNDATION_DIVIDER,
      stepId: step.id,
      project,
      prediction: "  ",
      run: fakeRun,
      now: "2026-08-31T00:00:00.000Z",
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.diagnostics[0]?.code).toBe("LESSON_EMPTY_PREDICTION");
  });
});

describe("learning evidence envelopes", () => {
  it("derives sorted unique referenced runs and rejects key drift", () => {
    const derived = deriveLearningEvidenceEnvelope(sampleEvidence(), 1);
    expect(derived.lessonKey).toEqual(["foundation-divider", "proj-a"]);
    expect(derived.projectKey).toEqual(["proj-a", "foundation-divider"]);
    expect(derived.referencedRunIds).toEqual(["run-a", "run-b"]);
    expect(parseStoredLearningEvidenceEnvelope(derived).ok).toBe(true);
    expect(parseStoredLearningEvidenceEnvelope({ ...derived, lessonKey: ["other", "proj-a"] }).ok).toBe(false);
    expect(parseStoredLearningEvidenceEnvelope({ ...derived, projectKey: ["proj-a", "other"] }).ok).toBe(false);
    expect(parseStoredLearningEvidenceEnvelope({ ...derived, referencedRunIds: ["run-b"] }).ok).toBe(false);
  });

  it("does not export a generic settings accessor", () => {
    const exported = Object.keys(storage);
    expect(exported.some(name => /^(get|put|read|write)Setting/.test(name))).toBe(false);
    expect(exported).toContain("saveLessonSession");
    expect(exported).toContain("loadLessonSession");
    expect(exported).not.toContain("getSetting");
    expect(exported).not.toContain("putSetting");
  });

  it("rejects lesson-session kind/key/payload mismatch on the shared parser", () => {
    const valid = parseStoredSettingEnvelope({
      envelopeVersion: 1,
      storageVersion: 1,
      key: "lesson-session:foundation-divider",
      projectKey: ["proj-a", "lesson-session:foundation-divider"],
      value: { kind: "lesson-session", lessonId: "foundation-divider", projectId: "proj-a", templateKey: "divider" },
    });
    expect(valid.ok).toBe(true);
    expect(
      parseStoredSettingEnvelope({
        envelopeVersion: 1,
        storageVersion: 1,
        key: "local-settings",
        projectKey: ["proj-a", "lesson-session:foundation-divider"],
        value: { kind: "lesson-session", lessonId: "foundation-divider", projectId: "proj-a", templateKey: "divider" },
      }).ok
    ).toBe(false);
  });
});

describe("catalog unlock", () => {
  it("unlocks the next lesson only from complete valid evidence", () => {
    const completeIds = new Set(["foundation-divider"]);
    const rows = catalogLockState(completeIds);
    expect(rows.find(item => item.lesson.id === "foundation-led")?.locked).toBe(false);
    expect(rows.find(item => item.lesson.id === "intermediate-rc")?.locked).toBe(true);
    const evidence = sampleEvidence();
    expect(evidenceHasEveryStepOnce(FOUNDATION_DIVIDER, evidence)).toBe(true);
    expect(evidenceHasEveryStepOnce(FOUNDATION_DIVIDER, { ...evidence, steps: evidence.steps.slice(0, 1) })).toBe(false);
    expect(
      evidenceHasEveryStepOnce(FOUNDATION_DIVIDER, {
        ...evidence,
        steps: [...evidence.steps, evidence.steps[0]!],
      })
    ).toBe(false);
    expect(
      evidenceHasEveryStepOnce(FOUNDATION_DIVIDER, {
        ...evidence,
        steps: [{ ...evidence.steps[0]!, stepId: "unknown-step" }, evidence.steps[1]!],
      })
    ).toBe(false);
    expect(lessonEvidenceStillValid(FOUNDATION_DIVIDER, evidence, new Map())).toBe(false);
  });
});
