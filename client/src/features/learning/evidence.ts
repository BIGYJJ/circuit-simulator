import type { Diagnostic } from "../../domain/project/project-v2";
import type { SuccessfulRunRecord } from "../../simulation/contracts";
import {
  listLearningEvidenceForLesson,
  loadRun,
  type StoredLearningEvidenceEnvelope,
} from "../../storage/indexeddb";
import type { LearningEvidence, LessonDefinition } from "./contracts";
import { lessonById, lessonEvidenceStillValid, listLessons } from "./lessons";

export function unlockedLessonIds(completedLessonIds: ReadonlySet<string>, lessons = listLessons()): string[] {
  return lessons
    .filter(lesson => lesson.prerequisiteLessonIds.every(id => completedLessonIds.has(id)))
    .map(lesson => lesson.id);
}

export async function completedLessonIdsFromStore(): Promise<{ completed: Set<string>; diagnostics: Diagnostic[] }> {
  const completed = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const lesson of listLessons()) {
    const listed = await listLearningEvidenceForLesson(lesson.id);
    diagnostics.push(...listed.diagnostics);
    if (!listed.ok) continue;
    for (const envelope of listed.value) {
      const ok = await envelopeSatisfiesLesson(lesson, envelope);
      if (ok) {
        completed.add(lesson.id);
        break;
      }
    }
  }
  return { completed, diagnostics };
}

export async function envelopeSatisfiesLesson(
  lesson: LessonDefinition,
  envelope: StoredLearningEvidenceEnvelope
): Promise<boolean> {
  const runs = new Map<string, SuccessfulRunRecord>();
  for (const runId of envelope.referencedRunIds) {
    const loaded = await loadRun(runId);
    if (!loaded.ok || !loaded.value || loaded.value.record.status !== "success") return false;
    runs.set(runId, loaded.value.record);
  }
  return lessonEvidenceStillValid(lesson, envelope.evidence, runs);
}

export function catalogLockState(completed: ReadonlySet<string>, lessons = listLessons()) {
  const unlocked = new Set(unlockedLessonIds(completed, lessons));
  return lessons.map(lesson => ({
    lesson,
    locked: !unlocked.has(lesson.id),
    completed: completed.has(lesson.id),
  }));
}

export function lessonOf(lessonId: string): LessonDefinition | undefined {
  return lessonById(lessonId);
}

export type { LearningEvidence };
