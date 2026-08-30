import type { AnalysisId, CircuitProjectV2, Diagnostic } from "../../domain/project/project-v2";

interface RunControlsProps {
  project: CircuitProjectV2;
  analysisId: AnalysisId | null;
  statusLabel: string;
  running: boolean;
  saveBusy: boolean;
  blockers: Diagnostic[];
  runLabel: string;
  allowRun?: boolean;
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
  runLabel,
  allowRun = true,
  onRun,
  onCancel,
}: RunControlsProps) {
  const analysis = project.analyses.find(item => item.id === analysisId);
  const disabled = running || saveBusy || !analysis || !allowRun;
  const icon = running ? "●" : statusLabel.includes("成功") ? "✓" : statusLabel.includes("失败") || statusLabel.includes("blocked") ? "!" : "○";
  return (
    <section className="workspace-run-controls" aria-label="运行">
      <button type="button" onClick={onRun} disabled={disabled}>
        {runLabel}
      </button>
      <button type="button" onClick={onCancel} disabled={!running}>
        取消运行
      </button>
      <p data-testid="run-status" aria-live="polite">
        <span data-status-icon aria-hidden="true">
          {icon}
        </span>{" "}
        {statusLabel}
      </p>
      {blockers.length > 0 ? <p data-testid="run-blockers">{blockers.map(item => item.code).join(" ")}</p> : null}
    </section>
  );
}
