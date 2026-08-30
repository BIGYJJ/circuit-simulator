import { useState } from "react";
import type { AnalysisDefinition, CircuitProjectV2, DcSweepAnalysis, Diagnostic, SourceSweep } from "../../domain/project/project-v2";
import type { ProjectCommand } from "../editor/project-reducer";
import { parseSiNumber } from "./parse-si";

interface AnalysisPanelProps {
  project: CircuitProjectV2;
  analysisId: string | null;
  estimateText: string;
  onSelect: (analysisId: string) => void;
  onCommand: (command: ProjectCommand) => void;
}

function voltageSweepFields(
  analysis: DcSweepAnalysis,
  sweep: Extract<SourceSweep, { quantity: "voltage" }>,
  upsert: (next: AnalysisDefinition) => void,
  reject: (code: string, message: string) => void
) {
  return [
    numberField("dc-start", "起点（V）", sweep.startV, value => {
      if (value >= sweep.stopV || sweep.stepV <= 0) return reject("ANALYSIS_BAD_RANGE", "invalid sweep range");
      upsert({ ...analysis, sweep: { ...sweep, startV: value } });
    }),
    numberField("dc-stop", "终点（V）", sweep.stopV, value => {
      if (sweep.startV >= value || sweep.stepV <= 0) return reject("ANALYSIS_BAD_RANGE", "invalid sweep range");
      upsert({ ...analysis, sweep: { ...sweep, stopV: value } });
    }),
    numberField("dc-step", "步长（V）", sweep.stepV, value => {
      if (value <= 0 || sweep.startV >= sweep.stopV) return reject("ANALYSIS_BAD_RANGE", "invalid sweep range");
      upsert({ ...analysis, sweep: { ...sweep, stepV: value } });
    }),
  ];
}

function currentSweepFields(
  analysis: DcSweepAnalysis,
  sweep: Extract<SourceSweep, { quantity: "current" }>,
  upsert: (next: AnalysisDefinition) => void,
  reject: (code: string, message: string) => void
) {
  return [
    numberField("dc-start-a", "起点（A）", sweep.startA, value => {
      if (value >= sweep.stopA || sweep.stepA <= 0) return reject("ANALYSIS_BAD_RANGE", "invalid sweep range");
      upsert({ ...analysis, sweep: { ...sweep, startA: value } });
    }),
    numberField("dc-stop-a", "终点（A）", sweep.stopA, value => {
      if (sweep.startA >= value || sweep.stepA <= 0) return reject("ANALYSIS_BAD_RANGE", "invalid sweep range");
      upsert({ ...analysis, sweep: { ...sweep, stopA: value } });
    }),
    numberField("dc-step-a", "步长（A）", sweep.stepA, value => {
      if (value <= 0) return reject("ANALYSIS_BAD_RANGE", "invalid sweep range");
      upsert({ ...analysis, sweep: { ...sweep, stepA: value } });
    }),
  ];
}

function numberField(id: string, label: string, value: number, onCommit: (value: number) => boolean | void) {
  return (
    <label key={id}>
      {label}
      <input
        key={`${id}-${value}`}
        defaultValue={String(value)}
        onBlur={event => {
          const parsed = parseSiNumber(event.target.value);
          if (parsed !== null) onCommit(parsed);
        }}
      />
    </label>
  );
}

export default function AnalysisPanel({ project, analysisId, estimateText, onSelect, onCommand }: AnalysisPanelProps) {
  const analysis = project.analyses.find(item => item.id === analysisId);
  const [draftError, setDraftError] = useState<Diagnostic | null>(null);

  function upsert(next: AnalysisDefinition) {
    onCommand({ type: "analysis/upsert", analysis: next });
    setDraftError(null);
  }

  function reject(code: string, message: string) {
    setDraftError({ severity: "error", code, message, blocksRun: true });
  }

  return (
    <section className="workspace-analysis" aria-label="分析">
      <h2>分析</h2>
      <ul>
        {project.analyses.map(item => (
          <li key={item.id}>
            <button type="button" aria-pressed={item.id === analysisId} onClick={() => onSelect(item.id)}>
              {item.name}
            </button>
          </li>
        ))}
      </ul>
      <p data-testid="selected-analysis-kind">{analysis?.kind ?? ""}</p>
      <p data-testid="resource-estimate">{estimateText}</p>
      {draftError ? <p data-testid={`diagnostic-${draftError.code}`}>{draftError.code}</p> : null}
      {analysis?.kind === "dc-sweep" ? (
        <>
          <label>
            扫描源
            <select
              value={analysis.sweep.sourceComponentId}
              onChange={event => {
                const source = project.schematic.components.find(item => item.id === event.target.value);
                if (!source) return;
                if (source.kind === "voltageSource") {
                  upsert({
                    ...analysis,
                    sweep: {
                      sourceComponentId: source.id,
                      quantity: "voltage",
                      startV: analysis.sweep.quantity === "voltage" ? analysis.sweep.startV : 0,
                      stopV: analysis.sweep.quantity === "voltage" ? analysis.sweep.stopV : 1,
                      stepV: analysis.sweep.quantity === "voltage" ? analysis.sweep.stepV : 0.1,
                    },
                  });
                  return;
                }
                if (source.kind === "currentSource") {
                  upsert({
                    ...analysis,
                    sweep: {
                      sourceComponentId: source.id,
                      quantity: "current",
                      startA: analysis.sweep.quantity === "current" ? analysis.sweep.startA : 0,
                      stopA: analysis.sweep.quantity === "current" ? analysis.sweep.stopA : 1,
                      stepA: analysis.sweep.quantity === "current" ? analysis.sweep.stepA : 0.1,
                    },
                  });
                }
              }}
            >
              {project.schematic.components
                .filter(item => item.kind === "voltageSource" || item.kind === "currentSource")
                .map(item => (
                  <option key={item.id} value={item.id}>
                    {item.refdes}
                  </option>
                ))}
            </select>
          </label>
          {analysis.sweep.quantity === "voltage"
            ? voltageSweepFields(analysis, analysis.sweep, upsert, reject)
            : currentSweepFields(analysis, analysis.sweep, upsert, reject)}
        </>
      ) : null}
      {analysis?.kind === "transient"
        ? [
            numberField("tran-start", "起点（s）", analysis.startS ?? 0, value => {
              if (value < 0 || value >= analysis.stopS) return reject("ANALYSIS_BAD_RANGE", "invalid transient range");
              upsert({ ...analysis, startS: value });
            }),
            numberField("tran-stop", "终点（s）", analysis.stopS, value => {
              if ((analysis.startS ?? 0) >= value || analysis.stepS <= 0) return reject("ANALYSIS_BAD_RANGE", "invalid transient range");
              upsert({ ...analysis, stopS: value });
            }),
            numberField("tran-step", "步长（s）", analysis.stepS, value => {
              if (value <= 0) return reject("ANALYSIS_BAD_RANGE", "invalid transient range");
              upsert({ ...analysis, stepS: value });
            }),
            numberField("tran-max", "最大步长（s）", analysis.maxStepS ?? analysis.stepS, value => {
              if (value <= 0) return reject("ANALYSIS_BAD_RANGE", "invalid transient range");
              upsert({ ...analysis, maxStepS: value });
            }),
          ]
        : null}
      {analysis?.kind === "ac" ? (
        <>
          <label>
            频率刻度
            <select
              value={analysis.scale}
              onChange={event => {
                const scale = event.target.value;
                if (scale === "lin") {
                  upsert({
                    id: analysis.id,
                    name: analysis.name,
                    kind: "ac",
                    scale: "lin",
                    totalPoints: 21,
                    startHz: analysis.startHz,
                    stopHz: analysis.stopHz,
                    enabledProbes: analysis.enabledProbes,
                  });
                  return;
                }
                if (scale === "dec" || scale === "oct") {
                  upsert({
                    id: analysis.id,
                    name: analysis.name,
                    kind: "ac",
                    scale,
                    pointsPerInterval: analysis.scale === "lin" ? 20 : analysis.pointsPerInterval,
                    startHz: analysis.startHz,
                    stopHz: analysis.stopHz,
                    enabledProbes: analysis.enabledProbes,
                  });
                }
              }}
            >
              <option value="dec">dec</option>
              <option value="oct">oct</option>
              <option value="lin">lin</option>
            </select>
          </label>
          {numberField("ac-start", "起点（Hz）", analysis.startHz, value => {
            if (value <= 0 || value >= analysis.stopHz) return reject("ANALYSIS_BAD_RANGE", "invalid ac range");
            upsert({ ...analysis, startHz: value });
          })}
          {numberField("ac-stop", "终点（Hz）", analysis.stopHz, value => {
            if (analysis.startHz >= value) return reject("ANALYSIS_BAD_RANGE", "invalid ac range");
            upsert({ ...analysis, stopHz: value });
          })}
          {analysis.scale === "lin"
            ? numberField("ac-points", "总点数", analysis.totalPoints, value => {
                if (!Number.isInteger(value) || value < 2) return reject("ANALYSIS_BAD_INTEGER", "ac point count must be an integer");
                upsert({ ...analysis, totalPoints: value });
              })
            : numberField("ac-ppi", "每区间点数", analysis.pointsPerInterval, value => {
                if (!Number.isInteger(value) || value < 1) return reject("ANALYSIS_BAD_INTEGER", "ac point count must be an integer");
                upsert({ ...analysis, pointsPerInterval: value });
              })}
        </>
      ) : null}
    </section>
  );
}
