import type { AnalysisId, CircuitProjectV2, Diagnostic } from "../../domain/project/project-v2";

interface RunControlsProps {
  project: CircuitProjectV2;
  analysisId: AnalysisId | null;
  statusLabel: string;
  running: boolean;
  saveBusy: boolean;
  blockers: Diagnostic[];
  onRun: () => void;
  onCancel: () => void;
}

export default function RunControls({
  project,
  analysisId,
  statusLabel,
  running,
  saveBusy,
  blockers,
  onRun,
  onCancel,
}: RunControlsProps) {
  const analysis = project.analyses.find(item => item.id === analysisId);
  const disabled = running || saveBusy || !analysis;
  return (
    <section className="workspace-run-controls" aria-label="运行">
      <button type="button" onClick={onRun} disabled={disabled}>
        运行 DC 工作点
      </button>
      <button type="button" onClick={onCancel} disabled={!running}>
        取消运行
      </button>
      <p data-testid="run-status">{statusLabel}</p>
      {blockers.length > 0 ? <p data-testid="run-blockers">{blockers.map(item => item.code).join(" ")}</p> : null}
    </section>
  );
}
