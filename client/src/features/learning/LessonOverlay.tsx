import { useState } from "react";
import type { CircuitProjectV2, Diagnostic } from "../../domain/project/project-v2";
import type { SuccessfulRunRecord } from "../../simulation/contracts";
import { loadLearningEvidence, putLearningEvidence } from "../../storage/indexeddb";
import type { LessonDefinition, LessonViewMode } from "./contracts";
import { completeLessonStep } from "./lessons";

interface LessonOverlayProps {
  lesson: LessonDefinition;
  project: CircuitProjectV2;
  selectedRun: SuccessfulRunRecord | null;
  view: LessonViewMode;
  onView: (view: LessonViewMode) => void;
  onStep?: (stepId: string) => void;
  onRestart: () => void;
}

export default function LessonOverlay({ lesson, project, selectedRun, view, onView, onStep, onRestart }: LessonOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [prediction, setPrediction] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const step = lesson.steps[Math.min(stepIndex, lesson.steps.length - 1)];

  async function saveCheckpoint() {
    if (!step || !selectedRun) {
      setDiagnostics([{ severity: "error", code: "LESSON_NO_RUN", message: "checkpoint needs a current successful run", blocksRun: true }]);
      return;
    }
    const loaded = await loadLearningEvidence(project.id, lesson.id);
    if (!loaded.ok) {
      setDiagnostics(loaded.diagnostics);
      return;
    }
    const parsedPrediction = step.prediction.kind === "number" ? Number(prediction) : prediction;
    const completed = await completeLessonStep({
      lesson,
      stepId: step.id,
      project,
      prediction: parsedPrediction,
      run: selectedRun,
      existing: loaded.value?.evidence,
      now: new Date().toISOString(),
    });
    if (!completed.ok) {
      setDiagnostics(completed.diagnostics);
      return;
    }
    const stored = await putLearningEvidence(loaded.value?.storageVersion ?? null, completed.value);
    if (!stored.ok) {
      setDiagnostics(stored.diagnostics);
      return;
    }
    setDiagnostics([]);
    setCompletedSteps(stored.value.evidence.steps.map(item => item.stepId));
    if (stepIndex < lesson.steps.length - 1) {
      const nextId = lesson.steps[stepIndex + 1]!.id;
      setStepIndex(stepIndex + 1);
      onStep?.(nextId);
    } else {
      onStep?.(step.id);
    }
  }

  return (
    <aside className="lesson-overlay" data-testid="lesson-overlay">
      <p data-testid="lesson-id">{lesson.id}</p>
      <h2>{lesson.title}</h2>
      {step ? (
        <>
          <p data-testid="lesson-step">{step.id}</p>
          <p>{step.prompt}</p>
          <label>
            预测
            <input
              data-testid="lesson-prediction"
              value={prediction}
              onChange={event => setPrediction(event.target.value)}
              inputMode={step.prediction.kind === "number" ? "decimal" : "text"}
            />
          </label>
          <button type="button" data-testid="save-checkpoint" onClick={() => void saveCheckpoint()}>
            保存检查点
          </button>
          <p>{step.explanation}</p>
        </>
      ) : null}
      <p data-testid="lesson-view">{view}</p>
      <p data-testid="lesson-completed-steps">{completedSteps.join(" ")}</p>
      <button type="button" data-testid="expand-standard" onClick={() => onView("standard")}>
        展开工作台
      </button>
      <button type="button" data-testid="expand-expert" onClick={() => onView("expert")}>
        专家视图
      </button>
      {view !== "guided" ? (
        <button type="button" data-testid="return-guided" onClick={() => onView("guided")}>
          返回引导
        </button>
      ) : null}
      <button type="button" data-testid="restart-lesson" onClick={() => setConfirmRestart(true)}>
        重新开始
      </button>
      {confirmRestart ? (
        <dialog open data-testid="restart-lesson-dialog">
          <p>确认重新开始本课？会新建项目并只替换本课映射。</p>
          <button type="button" data-testid="cancel-restart-lesson" onClick={() => setConfirmRestart(false)}>
            取消
          </button>
          <button
            type="button"
            data-testid="confirm-restart-lesson"
            onClick={() => {
              setConfirmRestart(false);
              onRestart();
            }}
          >
            确认重新开始
          </button>
        </dialog>
      ) : null}
      {diagnostics.map(item => (
        <p key={`${item.code}-${item.message}`} data-testid="lesson-diagnostic">
          {item.code}
        </p>
      ))}
    </aside>
  );
}
