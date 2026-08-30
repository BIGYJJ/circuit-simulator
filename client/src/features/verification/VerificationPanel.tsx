import { useEffect, useState } from "react";
import type { AnalysisDefinition, AssertionDefinition, CircuitProjectV2, CornerDefinition, Diagnostic } from "../../domain/project/project-v2";
import { computeVectorId } from "../../simulation/result-parser";
import type { DeliveryGateResult } from "../../simulation/verification";
import { validateAssertionDraft, validateCornerDraft } from "../../simulation/verification";
import type { ProjectCommand } from "../editor/project-reducer";

interface VerificationPanelProps {
  project: CircuitProjectV2;
  analysis: AnalysisDefinition | undefined;
  gate: DeliveryGateResult | null;
  seriesBusy: boolean;
  onCommand: (command: ProjectCommand) => void;
  onRunSeries: () => void;
  onCancelSeries: () => void;
  onReevaluate: () => void;
}

const PATHS: Record<string, Array<"resistanceOhm" | "capacitanceF" | "inductanceH" | "dcV" | "dcA" | "area" | "lengthM" | "widthM" | "multiplicity">> = {
  resistor: ["resistanceOhm"],
  capacitor: ["capacitanceF"],
  inductor: ["inductanceH"],
  voltageSource: ["dcV"],
  currentSource: ["dcA"],
  diode: ["area"],
  bjt: ["area"],
  mosfet: ["lengthM", "widthM", "multiplicity"],
};

export default function VerificationPanel({
  project,
  analysis,
  gate,
  seriesBusy,
  onCommand,
  onRunSeries,
  onCancelSeries,
  onReevaluate,
}: VerificationPanelProps) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [assertName, setAssertName] = useState("Vout");
  const [expected, setExpected] = useState("6");
  const [tolerance, setTolerance] = useState("0.01");
  const [cornerName, setCornerName] = useState("low");
  const [cornerComponent, setCornerComponent] = useState("R2");
  const [cornerValue, setCornerValue] = useState("1600");
  const [pendingDelete, setPendingDelete] = useState<{ kind: "assertion" | "corner"; id: string } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window as Window & {
      __fluxlabSubmitAssertionDraft?: (draft: AssertionDefinition) => Promise<Diagnostic[]>;
      __fluxlabSubmitCornerDraft?: (draft: CornerDefinition) => Promise<Diagnostic[]>;
    };
    host.__fluxlabSubmitAssertionDraft = async draft => {
      const validated = await validateAssertionDraft(project, draft);
      if (!validated.ok) {
        setDiagnostics(validated.diagnostics);
        return validated.diagnostics;
      }
      onCommand({ type: "assertion/upsert", assertion: validated.value });
      return [];
    };
    host.__fluxlabSubmitCornerDraft = async draft => {
      const validated = await validateCornerDraft(project, draft);
      if (!validated.ok) {
        setDiagnostics(validated.diagnostics);
        return validated.diagnostics;
      }
      onCommand({ type: "corner/upsert", corner: validated.value });
      return [];
    };
    return () => {
      delete host.__fluxlabSubmitAssertionDraft;
      delete host.__fluxlabSubmitCornerDraft;
    };
  }, [onCommand, project]);

  async function adoptAssertion() {
    if (!analysis) return;
    const probeId = analysis.enabledProbes[0];
    if (!probeId) return;
    const vectorId = await computeVectorId(analysis.id, probeId, "voltage", "scalar");
    const draft: AssertionDefinition = {
      id: `assert-${assertName.toLowerCase()}`,
      name: assertName,
      enabled: true,
      analysisId: analysis.id,
      expression: { function: "valueAt", vectorId, at: { value: 0, unit: analysis.kind === "dc-op" ? "index" : analysis.kind === "ac" ? "Hz" : "s" } },
      comparator: {
        kind: "near",
        expected: { value: Number(expected), unit: "V" },
        absoluteTolerance: { value: Number(tolerance), unit: "V" },
      },
    };
    const validated = await validateAssertionDraft(project, draft);
    if (!validated.ok) {
      setDiagnostics(validated.diagnostics);
      return;
    }
    onCommand({ type: "assertion/upsert", assertion: validated.value });
    setDiagnostics([]);
  }

  async function adoptCorner() {
    const path = PATHS[project.schematic.components.find(item => item.id === cornerComponent)?.kind ?? ""]?.[0];
    if (!path || path === undefined) return;
    const draft: CornerDefinition = {
      id: `corner-${cornerName.toLowerCase()}`,
      name: cornerName,
      enabled: true,
      overrides: [{ kind: "component-parameter", componentId: cornerComponent, path, value: Number(cornerValue) }],
    };
    const validated = await validateCornerDraft(project, draft);
    if (!validated.ok) {
      setDiagnostics(validated.diagnostics);
      return;
    }
    onCommand({ type: "corner/upsert", corner: validated.value });
    setDiagnostics([]);
  }

  return (
    <section className="workspace-verification" aria-label="验证">
      <h2>验证</h2>
      <p data-testid="delivery-gate">{gate?.status ?? "未评估"}</p>
      <p data-testid="gate-codes">{gate?.diagnostics.map(item => item.code).join(" ") ?? ""}</p>
      <p data-testid="gate-run-ids">{gate?.evidenceRunIds.join(" ") ?? ""}</p>
      <p>断言改动可重新评估，不必重跑 ngspice；角点改动必须新运行。</p>
      {diagnostics.map(item => (
        <p key={item.code} data-testid={`diagnostic-${item.code}`}>
          {item.code}
        </p>
      ))}
      <h3>断言</h3>
      <label>
        名称
        <input value={assertName} onChange={event => setAssertName(event.target.value)} />
      </label>
      <label>
        期望（V）
        <input aria-label="断言期望" value={expected} onChange={event => setExpected(event.target.value)} />
      </label>
      <label>
        绝对容差（V）
        <input aria-label="断言容差" value={tolerance} onChange={event => setTolerance(event.target.value)} />
      </label>
      <button type="button" onClick={() => void adoptAssertion()}>
        采用断言
      </button>
      <ul>
        {project.assertions.map(item => (
          <li key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={event => onCommand({ type: "assertion/upsert", assertion: { ...item, enabled: event.target.checked } })}
              />
              {item.name}
            </label>
            <button type="button" onClick={() => setPendingDelete({ kind: "assertion", id: item.id })}>
              删除断言
            </button>
          </li>
        ))}
      </ul>
      <h3>角点</h3>
      <label>
        角点名
        <input value={cornerName} onChange={event => setCornerName(event.target.value)} />
      </label>
      <label>
        元件
        <select aria-label="角点元件" value={cornerComponent} onChange={event => setCornerComponent(event.target.value)}>
          {project.schematic.components
            .filter(item => item.kind !== "ground")
            .map(item => (
              <option key={item.id} value={item.id}>
                {item.refdes}
              </option>
            ))}
        </select>
      </label>
      <label>
        角点值
        <input aria-label="角点值" value={cornerValue} onChange={event => setCornerValue(event.target.value)} />
      </label>
      <button type="button" onClick={() => void adoptCorner()}>
        采用角点
      </button>
      <ul>
        {project.corners.map(item => (
          <li key={item.id} data-testid={`corner-row-${item.id}`}>
            <label>
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={event => onCommand({ type: "corner/upsert", corner: { ...item, enabled: event.target.checked } })}
              />
              {`${item.name} ${item.id}`}
            </label>
            <button type="button" onClick={() => setPendingDelete({ kind: "corner", id: item.id })}>
              删除角点
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onRunSeries} disabled={seriesBusy}>
        运行名义与角点
      </button>
      <button type="button" onClick={onCancelSeries} disabled={!seriesBusy}>
        取消序列
      </button>
      <button type="button" onClick={onReevaluate} disabled={seriesBusy}>
        重新评估断言
      </button>
      {pendingDelete ? (
        <dialog open>
          <p>确认删除？</p>
          <button type="button" onClick={() => setPendingDelete(null)}>
            取消
          </button>
          <button
            type="button"
            data-testid="confirm-delete-evidence"
            onClick={() => {
              if (pendingDelete.kind === "assertion") onCommand({ type: "assertion/remove", assertionId: pendingDelete.id });
              else onCommand({ type: "corner/remove", cornerId: pendingDelete.id });
              setPendingDelete(null);
            }}
          >
            确认删除
          </button>
        </dialog>
      ) : null}
    </section>
  );
}
