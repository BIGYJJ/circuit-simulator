import type { AnalysisId, Diagnostic, DomainResult, ProjectId, RunId } from "../../domain/project/project-v2";

export type TemplateKey = "divider" | "led" | "rc" | "engineering-review";
export type LessonViewMode = "guided" | "standard" | "expert";

export type LessonAction =
  | "component:add"
  | "component:remove"
  | "component:updateParams"
  | "wire:add"
  | "wire:remove"
  | "probe:add"
  | "analysis:run";

export interface LessonStepDefinition {
  id: string;
  prompt: string;
  prediction: { kind: "number" | "choice" | "text"; unit?: string; choices?: string[] };
  allowedActions: LessonAction[];
  requiredAnalysisId: AnalysisId;
  assertionIds: string[];
  explanation: string;
}

export interface LessonDefinition {
  id: string;
  title: string;
  level: "foundation" | "intermediate" | "engineering";
  prerequisiteLessonIds: string[];
  templateKey: TemplateKey;
  steps: LessonStepDefinition[];
}

export interface LearningEvidenceStep {
  stepId: string;
  projectRevision: number;
  runId: RunId;
  prediction: string | number | boolean | null;
  assertionResultIds: string[];
  completedAt: string;
}

export interface LearningEvidence {
  projectId: ProjectId;
  lessonId: string;
  steps: LearningEvidenceStep[];
}

export type { Diagnostic, DomainResult };
