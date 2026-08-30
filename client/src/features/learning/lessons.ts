import type { CircuitProjectV2, Diagnostic, DomainResult } from "../../domain/project/project-v2";
import { createTemplateForKey } from "../../domain/project/templates";
import type { SuccessfulRunRecord } from "../../simulation/contracts";
import { checkRunFreshness } from "../../simulation/run-record";
import { loadLessonSession, loadProject, saveLessonSession, saveProject, type LessonSessionValue } from "../../storage/indexeddb";
import type { LearningEvidence, LessonAction, LessonDefinition, LessonStepDefinition } from "./contracts";

export { createTemplateForKey } from "../../domain/project/templates";

function blocker(code: string, message: string): Diagnostic {
  return { severity: "error", code, message, blocksRun: true };
}

export function listLessons(): LessonDefinition[] {
  return [FOUNDATION_DIVIDER, FOUNDATION_LED, INTERMEDIATE_RC, ENGINEERING_REVIEW];
}

export function lessonById(lessonId: string): LessonDefinition | undefined {
  return listLessons().find(item => item.id === lessonId);
}

export const FOUNDATION_DIVIDER: LessonDefinition = {
  id: "foundation-divider",
  title: "分压器基础",
  level: "foundation",
  prerequisiteLessonIds: [],
  templateKey: "divider",
  steps: [
    {
      id: "step-predict-6v",
      prompt: "预测分压输出，然后运行 DC 工作点，核对 Vout 是否约为 6 V。",
      prediction: { kind: "number", unit: "V" },
      allowedActions: ["analysis:run"],
      requiredAnalysisId: "an-op",
      assertionIds: ["as-vout"],
      explanation: "串联分压 Vout = 9 × R2 / (R1 + R2) = 6 V。",
    },
    {
      id: "step-after-r2",
      prompt: "改 R2 后旧运行会变成历史结果。再跑一次 DC 工作点才能通过本步。",
      prediction: { kind: "number", unit: "V" },
      allowedActions: ["component:updateParams", "analysis:run"],
      requiredAnalysisId: "an-op",
      assertionIds: ["as-vout"],
      explanation: "电气修订变化后，只有新鲜成功运行才能作为检查点。",
    },
  ],
};

export const FOUNDATION_LED: LessonDefinition = {
  id: "foundation-led",
  title: "LED 限流",
  level: "foundation",
  prerequisiteLessonIds: ["foundation-divider"],
  templateKey: "led",
  steps: [
    {
      id: "step-led-current",
      prompt: "5 V / 680 Ω 的电流约 4.4 mA，不能通过 8–12 mA 断言。把限流电阻改到 330 Ω 再运行。",
      prediction: { kind: "number", unit: "mA" },
      allowedActions: ["component:updateParams", "analysis:run"],
      requiredAnalysisId: "an-op",
      assertionIds: ["as-led-current"],
      explanation: "串联电流由电源、LED 压降和限流电阻共同决定。",
    },
  ],
};

export const INTERMEDIATE_RC: LessonDefinition = {
  id: "intermediate-rc",
  title: "RC 暂态",
  level: "intermediate",
  prerequisiteLessonIds: ["foundation-led"],
  templateKey: "rc",
  steps: [
    {
      id: "step-rc-tau",
      prompt: "运行暂态，核对 t = 1τ 时电容电压约为终值的 63.2%。",
      prediction: { kind: "number", unit: "V" },
      allowedActions: ["analysis:run"],
      requiredAnalysisId: "an-tran",
      assertionIds: ["as-rc-tau"],
      explanation: "一阶 RC 充电 V(t) = V∞ (1 − e^(−t/τ))，τ = RC = 1 s。",
    },
  ],
};

export const ENGINEERING_REVIEW: LessonDefinition = {
  id: "engineering-review",
  title: "低通工程复核",
  level: "engineering",
  prerequisiteLessonIds: ["intermediate-rc"],
  templateKey: "engineering-review",
  steps: [
    {
      id: "step-lowpass-fc",
      prompt: "运行交流分析，核对 −3 dB 截止频率。",
      prediction: { kind: "number", unit: "Hz" },
      allowedActions: ["analysis:run"],
      requiredAnalysisId: "an-ac",
      assertionIds: ["as-fc"],
      explanation: "一极 RC 低通 fc = 1 / (2πRC)。",
    },
  ],
};

export function validateLessonDefinition(lesson: LessonDefinition, template: CircuitProjectV2): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const analysisIds = new Set(template.analyses.map(item => item.id));
  const assertionById = new Map(template.assertions.map(item => [item.id, item]));
  for (const step of lesson.steps) {
    if (!analysisIds.has(step.requiredAnalysisId)) {
      diagnostics.push(blocker("LESSON_UNKNOWN_ANALYSIS", `step ${step.id} references a missing analysis`));
    }
    if (step.assertionIds.length === 0) {
      diagnostics.push(blocker("LESSON_EMPTY_ASSERTIONS", `step ${step.id} has no assertions`));
    }
    if (new Set(step.assertionIds).size !== step.assertionIds.length) {
      diagnostics.push(blocker("LESSON_DUPLICATE_ASSERTION", `step ${step.id} repeats an assertion id`));
    }
    for (const assertionId of step.assertionIds) {
      const assertion = assertionById.get(assertionId);
      if (!assertion) {
        diagnostics.push(blocker("LESSON_UNKNOWN_ASSERTION", `step ${step.id} references a missing assertion`));
        continue;
      }
      if (assertion.analysisId !== step.requiredAnalysisId) {
        diagnostics.push(blocker("LESSON_ASSERTION_ANALYSIS", `assertion ${assertionId} is not owned by ${step.requiredAnalysisId}`));
      }
    }
  }
  return diagnostics;
}

export function validateLessonCatalog(lessons: LessonDefinition[]): Diagnostic[] {
  const ids = new Set(lessons.map(item => item.id));
  const diagnostics: Diagnostic[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string, stack: string[]) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      diagnostics.push(blocker("LESSON_PREREQ_CYCLE", `prerequisite cycle at ${id}`));
      return;
    }
    visiting.add(id);
    const lesson = lessons.find(item => item.id === id);
    if (!lesson) {
      diagnostics.push(blocker("LESSON_UNKNOWN_PREREQ", `unknown lesson ${id}`));
      visiting.delete(id);
      return;
    }
    for (const prereq of lesson.prerequisiteLessonIds) {
      if (prereq === id) {
        diagnostics.push(blocker("LESSON_PREREQ_SELF", `${id} lists itself as a prerequisite`));
        continue;
      }
      if (!ids.has(prereq)) {
        diagnostics.push(blocker("LESSON_UNKNOWN_PREREQ", `${id} lists unknown prerequisite ${prereq}`));
        continue;
      }
      walk(prereq, [...stack, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const lesson of lessons) walk(lesson.id, []);
  return diagnostics;
}

export function canPerformLessonAction(step: LessonStepDefinition, action: LessonAction): boolean {
  return step.allowedActions.includes(action);
}

function nonemptyPrediction(prediction: string | number | boolean | null): boolean {
  if (prediction === null) return false;
  if (typeof prediction === "string") return prediction.trim().length > 0;
  if (typeof prediction === "boolean") return true;
  return Number.isFinite(prediction);
}

export async function completeLessonStep(input: {
  lesson: LessonDefinition;
  stepId: string;
  project: CircuitProjectV2;
  prediction: string | number | boolean | null;
  run: SuccessfulRunRecord;
  existing?: LearningEvidence;
  now: string;
}): Promise<DomainResult<LearningEvidence>> {
  const templateCheck = validateLessonDefinition(input.lesson, input.project);
  if (templateCheck.length) return { ok: false, diagnostics: templateCheck };
  const step = input.lesson.steps.find(item => item.id === input.stepId);
  if (!step) return { ok: false, diagnostics: [blocker("LESSON_UNKNOWN_STEP", "step is not part of the lesson")] };
  if (!nonemptyPrediction(input.prediction)) {
    return { ok: false, diagnostics: [blocker("LESSON_EMPTY_PREDICTION", "a non-empty prediction is required")] };
  }
  if (input.run.projectRevision !== input.project.revision) {
    return { ok: false, diagnostics: [blocker("LESSON_STALE_REVISION", "checkpoint requires the exact current project revision")] };
  }
  if (input.run.electricalRevision !== input.project.electricalRevision || input.run.analysisId !== step.requiredAnalysisId) {
    return { ok: false, diagnostics: [blocker("LESSON_STALE_RUN", "checkpoint requires a fresh successful run of the required analysis")] };
  }
  const freshness = await checkRunFreshness({
    run: input.run,
    project: input.project,
    appBuildId: input.run.appBuildId,
    engine: input.run.requestedEngine,
  });
  if (!freshness.ok || !freshness.value.fresh) {
    return { ok: false, diagnostics: freshness.ok ? [blocker("LESSON_STALE_RUN", freshness.value.reason ?? "run is historical")] : freshness.diagnostics };
  }
  const evaluation = input.run.assertionEvaluations.at(-1);
  if (!evaluation) return { ok: false, diagnostics: [blocker("LESSON_ASSERTION_MISSING", "the run has no assertion evaluation")] };
  const assertionResultIds: string[] = [];
  for (const assertionId of step.assertionIds) {
    const result = evaluation.results.find(item => item.assertionId === assertionId);
    if (!result || result.status !== "passed") {
      return { ok: false, diagnostics: [blocker("LESSON_ASSERTION_FAILED", `assertion ${assertionId} did not pass on the current run`)] };
    }
    assertionResultIds.push(result.id);
  }
  const nextStep = {
    stepId: step.id,
    projectRevision: input.project.revision,
    runId: input.run.runId,
    prediction: input.prediction,
    assertionResultIds,
    completedAt: input.now,
  };
  const prior = input.existing && input.existing.projectId === input.project.id && input.existing.lessonId === input.lesson.id ? input.existing.steps : [];
  return {
    ok: true,
    value: {
      projectId: input.project.id,
      lessonId: input.lesson.id,
      steps: [...prior.filter(item => item.stepId !== step.id), nextStep],
    },
    diagnostics: [],
  };
}

export function evidenceHasEveryStepOnce(lesson: LessonDefinition, evidence: LearningEvidence): boolean {
  if (evidence.lessonId !== lesson.id) return false;
  if (evidence.steps.length !== lesson.steps.length) return false;
  const seen = new Set<string>();
  for (const step of evidence.steps) {
    if (!lesson.steps.some(item => item.id === step.stepId)) return false;
    if (seen.has(step.stepId)) return false;
    seen.add(step.stepId);
  }
  return seen.size === lesson.steps.length;
}

export function lessonEvidenceStillValid(
  lesson: LessonDefinition,
  evidence: LearningEvidence,
  runs: ReadonlyMap<string, SuccessfulRunRecord>
): boolean {
  if (!evidenceHasEveryStepOnce(lesson, evidence)) return false;
  for (const stepEvidence of evidence.steps) {
    const step = lesson.steps.find(item => item.id === stepEvidence.stepId);
    const run = runs.get(stepEvidence.runId);
    if (!step || !run || run.status !== "success") return false;
    const evaluation = run.assertionEvaluations.at(-1);
    if (!evaluation) return false;
    for (const resultId of stepEvidence.assertionResultIds) {
      const result = evaluation.results.find(item => item.id === resultId);
      if (!result || result.status !== "passed") return false;
    }
    for (const assertionId of step.assertionIds) {
      if (!evaluation.results.some(item => item.assertionId === assertionId && item.status === "passed")) return false;
    }
  }
  return true;
}

export async function openOrCreateLessonProject(lessonId: string): Promise<DomainResult<{ projectId: string; lesson: LessonDefinition }>> {
  const lesson = lessonById(lessonId);
  if (!lesson) return { ok: false, diagnostics: [blocker("LESSON_UNKNOWN", "lesson is not registered")] };
  const catalog = validateLessonCatalog(listLessons());
  if (catalog.length) return { ok: false, diagnostics: catalog };
  const session = await loadLessonSession(lessonId);
  if (session.ok && session.value) {
    if (session.value.templateKey !== lesson.templateKey) {
      return createFreshLessonProject(lesson);
    }
    const project = await loadProject(session.value.projectId);
    if (project.ok && project.value) return { ok: true, value: { projectId: project.value.id, lesson }, diagnostics: [] };
  }
  return createFreshLessonProject(lesson);
}

async function createFreshLessonProject(lesson: LessonDefinition): Promise<DomainResult<{ projectId: string; lesson: LessonDefinition }>> {
  const createdAt = new Date().toISOString();
  const projectId = crypto.randomUUID();
  const template = await createTemplateForKey(lesson.templateKey, projectId, createdAt);
  if (!template.ok) return template;
  const refs = validateLessonDefinition(lesson, template.value);
  if (refs.length) return { ok: false, diagnostics: refs };
  const saved = await saveProject(null, template.value);
  if (!saved.ok) return saved;
  const session: LessonSessionValue = {
    kind: "lesson-session",
    lessonId: lesson.id,
    projectId: saved.value.id,
    templateKey: lesson.templateKey,
  };
  const mapped = await saveLessonSession(session);
  if (!mapped.ok) return mapped;
  return { ok: true, value: { projectId: saved.value.id, lesson }, diagnostics: [] };
}

export async function restartLessonProject(lesson: LessonDefinition): Promise<DomainResult<{ projectId: string }>> {
  return createFreshLessonProject(lesson);
}
