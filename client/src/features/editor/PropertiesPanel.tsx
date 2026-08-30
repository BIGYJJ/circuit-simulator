import { useEffect, useState } from "react";
import type { CircuitProjectV2, ComponentId, ComponentInstance, ModelDefinition } from "../../domain/project/project-v2";
import { familyMatchesKind } from "../models/ModelPanel";
import type { ProjectCommand } from "./project-reducer";

interface PropertiesPanelProps {
  project: CircuitProjectV2;
  selectedId: ComponentId | null;
  selectedWireId: string | null;
  onSelect: (componentId: ComponentId | null) => void;
  onSelectWire: (wireId: string | null) => void;
  onCommand: (command: ProjectCommand) => void;
  allowUpdateParams?: boolean;
}

function resistanceOf(component: ComponentInstance | undefined) {
  if (!component || component.kind !== "resistor") return "";
  return String(component.params.resistanceOhm);
}

function compatibleModels(project: CircuitProjectV2, component: ComponentInstance): ModelDefinition[] {
  if (component.kind === "subcircuit") {
    return project.models.filter(item => item.kind === "spice-subckt");
  }
  if (component.kind === "diode" || component.kind === "bjt" || component.kind === "mosfet" || component.kind === "switch") {
    return project.models.filter(item => item.kind === "spice-model" && familyMatchesKind(item.deviceFamily, component.kind));
  }
  return [];
}

export default function PropertiesPanel({
  project,
  selectedId,
  selectedWireId,
  onSelect,
  onSelectWire,
  onCommand,
  allowUpdateParams = true,
}: PropertiesPanelProps) {
  const selected = project.schematic.components.find(item => item.id === selectedId);
  const selectedWire = project.schematic.wires.find(item => item.id === selectedWireId);
  const [resistance, setResistance] = useState(resistanceOf(selected));
  const [capacitance, setCapacitance] = useState(selected?.kind === "capacitor" ? String(selected.params.capacitanceF) : "");
  const [dcValue, setDcValue] = useState(
    selected?.kind === "voltageSource"
      ? String(selected.params.dcV ?? "")
      : selected?.kind === "currentSource"
        ? String(selected.params.dcA ?? "")
        : ""
  );
  const [explicitDc, setExplicitDc] = useState(
    selected?.kind === "voltageSource" ? selected.params.dcV !== undefined : selected?.kind === "currentSource" ? selected.params.dcA !== undefined : true
  );
  const [dcError, setDcError] = useState("");

  useEffect(() => {
    setResistance(resistanceOf(selected));
    setCapacitance(selected?.kind === "capacitor" ? String(selected.params.capacitanceF) : "");
    setDcValue(
      selected?.kind === "voltageSource"
        ? String(selected.params.dcV ?? "")
        : selected?.kind === "currentSource"
          ? String(selected.params.dcA ?? "")
          : ""
    );
    setExplicitDc(
      selected?.kind === "voltageSource" ? selected.params.dcV !== undefined : selected?.kind === "currentSource" ? selected.params.dcA !== undefined : true
    );
    setDcError("");
  }, [selected]);

  const models = selected ? compatibleModels(project, selected) : [];

  function replace(component: ComponentInstance) {
    onCommand({ type: "component/replace", component });
  }

  return (
    <aside className="workspace-properties" data-testid="workspace-properties">
      <h2>元件</h2>
      <ul>
        {project.schematic.components.map(component => (
          <li key={component.id}>
            <button type="button" onClick={() => onSelect(component.id)}>
              {`选择 ${component.refdes}`}
            </button>
          </li>
        ))}
      </ul>
      <ul>
        {project.schematic.wires.map(wire => (
          <li key={wire.id}>
            <button type="button" data-testid={`panel-select-wire-${wire.id}`} onClick={() => onSelectWire(wire.id)}>
              {`选择连线 ${wire.id}`}
            </button>
          </li>
        ))}
      </ul>
      {selectedWire ? (
        <button
          type="button"
          onClick={() => {
            onCommand({ type: "wire/remove", wireId: selectedWire.id });
          }}
        >
          删除连线
        </button>
      ) : null}
      {selected?.kind === "resistor" ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            const value = Number(resistance);
            if (!Number.isFinite(value)) return;
            replace({ ...selected, params: { resistanceOhm: value } });
          }}
        >
          <label>
            电阻（Ω）
            <input value={resistance} onChange={event => setResistance(event.target.value)} inputMode="decimal" />
          </label>
          <button type="submit" disabled={!allowUpdateParams}>应用参数</button>
        </form>
      ) : null}
      {selected?.kind === "capacitor" ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            const value = Number(capacitance);
            if (!Number.isFinite(value)) return;
            replace({ ...selected, params: { capacitanceF: value } });
          }}
        >
          <label>
            电容（F）
            <input value={capacitance} onChange={event => setCapacitance(event.target.value)} inputMode="decimal" />
          </label>
          <button type="submit" disabled={!allowUpdateParams}>应用参数</button>
        </form>
      ) : null}
      {selected?.kind === "voltageSource" || selected?.kind === "currentSource" ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            const waveform = selected.kind === "voltageSource" ? selected.params.transient : selected.params.transient;
            const ac = selected.params.ac;
            if (!explicitDc && !waveform) {
              setDcError("清除显式 DC 需要先存在暂态波形");
              return;
            }
            if (!explicitDc && !waveform && !ac) {
              setDcError("不能移除全部 DC/AC/暂态事实");
              return;
            }
            const numeric = Number(dcValue);
            if (explicitDc && !Number.isFinite(numeric)) return;
            if (selected.kind === "voltageSource") {
              const next = { ...selected.params };
              if (explicitDc) next.dcV = numeric;
              else delete next.dcV;
              replace({ ...selected, params: next });
            } else {
              const next = { ...selected.params };
              if (explicitDc) next.dcA = numeric;
              else delete next.dcA;
              replace({ ...selected, params: next });
            }
            setDcError("");
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={explicitDc}
              onChange={event => {
                const waveform = selected.kind === "voltageSource" ? selected.params.transient : selected.params.transient;
                if (!event.target.checked && !waveform) {
                  setDcError("清除显式 DC 需要先存在暂态波形");
                  return;
                }
                setExplicitDc(event.target.checked);
              }}
            />
            显式 DC
          </label>
          {explicitDc ? (
            <label>
              {selected.kind === "voltageSource" ? "直流电压（V）" : "直流电流（A）"}
              <input value={dcValue} onChange={event => setDcValue(event.target.value)} inputMode="decimal" />
            </label>
          ) : (
            <p>工作点由波形时间零推导，网表不发射显式 DC。</p>
          )}
          <button type="submit" disabled={!allowUpdateParams}>应用参数</button>
          {dcError ? <p data-testid="source-dc-error">{dcError}</p> : null}
        </form>
      ) : null}
      {selected && models.length > 0 && "modelRef" in selected ? (
        <label>
          模型引用
          <select
            aria-label="模型引用"
            value={selected.modelRef}
            onChange={event => {
              const model = project.models.find(item => item.id === event.target.value);
              if (!model) return;
              if (selected.kind === "subcircuit" && model.kind === "spice-subckt") {
                const iface = model.interfaces[0];
                if (!iface) return;
                replace({ ...selected, modelRef: model.id, subcircuitName: iface.name, orderedPins: iface.orderedPins });
                return;
              }
              replace({ ...selected, modelRef: model.id });
            }}
          >
            {models.map(model => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {selected?.kind === "subcircuit" ? <p data-testid="subckt-pins">{selected.orderedPins.join(" ")}</p> : null}
      {selected &&
      selected.kind !== "resistor" &&
      selected.kind !== "capacitor" &&
      selected.kind !== "voltageSource" &&
      selected.kind !== "currentSource" &&
      !("modelRef" in selected) ? (
        <p>{`${selected.refdes} 没有可编辑电阻。`}</p>
      ) : null}
      {!selected ? <p>选择一个元件以编辑参数。</p> : null}
      {selected && selected.kind !== "ground" && !project.probes.some(probe => probe.kind === "branch-current" && probe.componentId === selected.id) ? (
        <button
          type="button"
          onClick={() => {
            const analysis = project.analyses.find(item => item.kind === "dc-op") ?? project.analyses[0];
            if (!analysis) return;
            const probeId = `pr-i-${selected.id.toLowerCase()}`;
            onCommand({
              type: "probe/upsert",
              probe: { id: probeId, kind: "branch-current", componentId: selected.id, label: `I(${selected.refdes})` },
            });
            onCommand({
              type: "analysis/upsert",
              analysis: { ...analysis, enabledProbes: [...new Set([...analysis.enabledProbes, probeId])] },
            });
          }}
        >
          添加支路电流探针
        </button>
      ) : null}
      {selected ? (
        <button
          type="button"
          onClick={() => {
            onCommand({ type: "component/remove", componentId: selected.id });
            onSelect(null);
          }}
        >
          删除元件
        </button>
      ) : null}
    </aside>
  );
}
