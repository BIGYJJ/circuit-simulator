import { useEffect, useState } from "react";
import type { CircuitProjectV2, ComponentId, ComponentInstance } from "../../domain/project/project-v2";
import type { ProjectCommand } from "./project-reducer";

interface PropertiesPanelProps {
  project: CircuitProjectV2;
  selectedId: ComponentId | null;
  onSelect: (componentId: ComponentId) => void;
  onCommand: (command: ProjectCommand) => void;
}

function resistanceOf(component: ComponentInstance | undefined) {
  if (!component || component.kind !== "resistor") return "";
  return String(component.params.resistanceOhm);
}

export default function PropertiesPanel({ project, selectedId, onSelect, onCommand }: PropertiesPanelProps) {
  const selected = project.schematic.components.find(item => item.id === selectedId);
  const [resistance, setResistance] = useState(resistanceOf(selected));

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
    </aside>
  );
}
