import { useEffect, useState } from "react";
import qualifiedVectors from "../../../../vendor/ngspice/QUALIFIED_VECTORS.json";
import type { AnalysisDefinition, CircuitProjectV2, Diagnostic, ProbeDefinition } from "../../domain/project/project-v2";
import { REFDES_FAMILY_PREFIX } from "../../domain/project/project-v2";
import { listQualifiedFamilies } from "../../simulation/qualified-vectors.mjs";
import type { ProjectCommand } from "../editor/project-reducer";
import { activeQualifiedVectorManifest, validateProbeDraft } from "./probe-draft";

interface ProbePanelProps {
  project: CircuitProjectV2;
  analysis: AnalysisDefinition | undefined;
  onCommand: (command: ProjectCommand) => void;
}

export default function ProbePanel({ project, analysis, onCommand }: ProbePanelProps) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const manifest = activeQualifiedVectorManifest();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window as Window & {
      __fluxlabDefaultQualifiedVectors?: unknown;
      __fluxlabSubmitProbeDraft?: (probe: ProbeDefinition) => Promise<Diagnostic[]>;
    };
    host.__fluxlabDefaultQualifiedVectors = qualifiedVectors;
    host.__fluxlabSubmitProbeDraft = async (probe: ProbeDefinition) => {
      if (!analysis) return [{ severity: "error", code: "PROBE_NO_ANALYSIS", message: "analysis is missing", blocksRun: true }];
      const validated = await validateProbeDraft(project, analysis, probe, manifest);
      if (!validated.ok) {
        setDiagnostics(validated.diagnostics);
        return validated.diagnostics;
      }
      onCommand({ type: "probe/upsert", probe: validated.value });
      onCommand({
        type: "analysis/upsert",
        analysis: { ...analysis, enabledProbes: [...new Set([...analysis.enabledProbes, validated.value.id])] },
      });
      setDiagnostics([]);
      return [];
    };
    return () => {
      delete host.__fluxlabSubmitProbeDraft;
    };
  }, [analysis, manifest, onCommand, project]);

  if (!analysis) return null;
  const currentFamilies = new Set(listQualifiedFamilies(manifest, "branch-current", analysis.kind));
  const powerFamilies = new Set(listQualifiedFamilies(manifest, "device-power", analysis.kind));

  async function enable(probe: ProbeDefinition) {
    const validated = await validateProbeDraft(project, analysis!, probe, manifest);
    if (!validated.ok) {
      setDiagnostics(validated.diagnostics);
      return;
    }
    onCommand({ type: "probe/upsert", probe: validated.value });
    onCommand({
      type: "analysis/upsert",
      analysis: { ...analysis!, enabledProbes: [...new Set([...analysis!.enabledProbes, validated.value.id])] },
    });
    setDiagnostics([]);
  }

  const endpoints = project.schematic.components
    .filter(item => item.kind !== "ground")
    .map(item => ({ componentId: item.id, pin: item.kind === "bjt" ? "c" : "p", refdes: item.refdes }));

  return (
    <section className="workspace-probes" aria-label="探针">
      <h2>探针</h2>
      {diagnostics.map(item => (
        <p key={item.code} data-testid={`diagnostic-${item.code}`}>
          {item.code}
        </p>
      ))}
      {analysis.kind === "ac" ? <p data-testid="probe-ac-power">PROBE_UNSUPPORTED_DEVICE_POWER</p> : null}
      {endpoints.length >= 2 ? (
        <button
          type="button"
          onClick={() =>
            void enable({
              id: `pr-diff-${endpoints[0]!.componentId}-${endpoints[endpoints.length - 1]!.componentId}`.toLowerCase(),
              kind: "differential-voltage",
              positive: { componentId: endpoints[0]!.componentId, pin: endpoints[0]!.pin },
              negative: { componentId: endpoints[endpoints.length - 1]!.componentId, pin: endpoints[endpoints.length - 1]!.pin },
              label: `V(${endpoints[0]!.refdes},${endpoints[endpoints.length - 1]!.refdes})`,
            })
          }
        >
          {`添加差分电压 ${endpoints[0]!.refdes}-${endpoints[endpoints.length - 1]!.refdes}`}
        </button>
      ) : null}
      {project.schematic.components
        .filter(item => item.kind !== "ground")
        .map(component => {
          const family = REFDES_FAMILY_PREFIX[component.kind];
          const ambiguous = family === "Q" || family === "M" || family === "X";
          return (
            <div key={component.id}>
              <button
                type="button"
                onClick={() =>
                  void enable({
                    id: `pr-v-${component.id.toLowerCase()}`,
                    kind: "node-voltage",
                    node: { componentId: component.id, pin: component.kind === "bjt" ? "c" : "p" },
                    label: `V(${component.refdes})`,
                  })
                }
              >
                {`添加 ${component.refdes} 节点电压`}
              </button>
              {currentFamilies.has(family) && !ambiguous ? (
                <button
                  type="button"
                  data-testid={`add-current-${component.refdes}`}
                  onClick={() =>
                    void enable({
                      id: `pr-i-${component.id.toLowerCase()}`,
                      kind: "branch-current",
                      componentId: component.id,
                      label: `I(${component.refdes})`,
                    })
                  }
                >
                  {`添加 ${component.refdes} 支路电流`}
                </button>
              ) : null}
              {ambiguous ? <p data-testid="probe-ambiguous">PROBE_AMBIGUOUS_BRANCH_CURRENT</p> : null}
              {powerFamilies.has(family) ? (
                <button
                  type="button"
                  data-testid={`add-power-${component.refdes}`}
                  onClick={() =>
                    void enable({
                      id: `pr-p-${component.id.toLowerCase()}`,
                      kind: "device-power",
                      componentId: component.id,
                      label: `P(${component.refdes})`,
                    })
                  }
                >
                  {`添加 ${component.refdes} 器件功率`}
                </button>
              ) : null}
            </div>
          );
        })}
    </section>
  );
}
