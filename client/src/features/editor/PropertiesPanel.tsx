import { useEffect, useState } from "react";
import type { CircuitProjectV2, ComponentId, ComponentInstance } from "../../domain/project/project-v2";
import type { ProjectCommand } from "./project-reducer";

interface PropertiesPanelProps {
  project: CircuitProjectV2;
  selectedId: ComponentId | null;
  selectedWireId: string | null;
  onSelect: (componentId: ComponentId | null) => void;
  onSelectWire: (wireId: string | null) => void;
  onCommand: (command: ProjectCommand) => void;
}

function resistanceOf(component: ComponentInstance | undefined) {
  if (!component || component.kind !== "resistor") return "";
  return String(component.params.resistanceOhm);
}

export default function PropertiesPanel({
  project,
  selectedId,
  selectedWireId,
  onSelect,
  onSelectWire,
  onCommand,
}: PropertiesPanelProps) {
  const selected = project.schematic.components.find(item => item.id === selectedId);
  const selectedWire = project.schematic.wires.find(item => item.id === selectedWireId);
  const [resistance, setResistance] = useState(resistanceOf(selected));
  const analysis = project.analyses.find(item => item.kind === "dc-op") ?? project.analyses[0];
  const hasCurrentProbe = Boolean(
    selected && project.probes.some(probe => probe.kind === "branch-current" && probe.componentId === selected.id)
  );

  useEffect(() => {
    setResistance(resistanceOf(selected));
  }, [selected]);

  return (
    <aside className="workspace-properties">
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
            <button type="button" data-testid={`select-wire-${wire.id}`} onClick={() => onSelectWire(wire.id)}>
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
            onCommand({
              type: "component/replace",
              component: { ...selected, params: { resistanceOhm: value } },
            });
          }}
        >
          <label>
            电阻（Ω）
            <input
              value={resistance}
              onChange={event => setResistance(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <button type="submit">应用参数</button>
        </form>
      ) : (
        <p>{selected ? `${selected.refdes} 没有可编辑电阻。` : "选择一个元件以编辑参数。"}</p>
      )}
      {selected && selected.kind !== "ground" && !hasCurrentProbe && analysis ? (
        <button
          type="button"
          onClick={() => {
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
