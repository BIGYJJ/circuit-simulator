import type { CircuitProjectV2, ComponentId } from "../../domain/project/project-v2";
import type { ProjectCommand } from "./project-reducer";

interface SchematicCanvasProps {
  project: CircuitProjectV2;
  selectedId: ComponentId | null;
  onSelect: (componentId: ComponentId) => void;
  onCommand: (command: ProjectCommand) => void;
}

const KIND_LABEL: Record<string, string> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  voltageSource: "V",
  currentSource: "I",
  diode: "D",
  switch: "S",
  bjt: "Q",
  mosfet: "M",
  subcircuit: "X",
  ground: "GND",
};

export default function SchematicCanvas({ project, selectedId, onSelect, onCommand }: SchematicCanvasProps) {
  function moveSelected(dx: number, dy: number) {
    if (!selectedId) return;
    const current = project.layout.components[selectedId];
    if (!current) return;
    onCommand({
      type: "layout/componentSet",
      componentId: selectedId,
      layout: { ...current, x: current.x + dx, y: current.y + dy },
    });
  }

  return (
    <svg className="workspace-canvas" viewBox="0 0 720 640" role="img" aria-label="原理图">
      {project.schematic.wires.map(wire => {
        const from = project.layout.components[wire.from.componentId];
        const to = project.layout.components[wire.to.componentId];
        if (!from || !to) return null;
        return (
          <line
            key={wire.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="currentColor"
            strokeWidth="2"
          />
        );
      })}
      {project.schematic.components.map(component => {
        const layout = project.layout.components[component.id] ?? { x: 40, y: 40, rotation: 0 };
        const selected = selectedId === component.id;
        return (
          <g
            key={component.id}
            data-testid={`component-${component.id}`}
            tabIndex={0}
            transform={`translate(${layout.x} ${layout.y})`}
            onClick={() => onSelect(component.id)}
            onFocus={() => onSelect(component.id)}
            onKeyDown={event => {
              if (event.altKey && event.key === "ArrowRight") {
                event.preventDefault();
                moveSelected(20, 0);
              }
              if (event.altKey && event.key === "ArrowLeft") {
                event.preventDefault();
                moveSelected(-20, 0);
              }
              if (event.altKey && event.key === "ArrowUp") {
                event.preventDefault();
                moveSelected(0, -20);
              }
              if (event.altKey && event.key === "ArrowDown") {
                event.preventDefault();
                moveSelected(0, 20);
              }
            }}
          >
            <rect
              x={-36}
              y={-22}
              width={72}
              height={44}
              rx={6}
              fill={selected ? "#18200e" : "#101211"}
              stroke={selected ? "#c7f43d" : "rgba(235,244,224,.25)"}
            />
            <text x={0} y={-2} textAnchor="middle" fill="currentColor" fontSize="12">
              {KIND_LABEL[component.kind] ?? component.kind}
            </text>
            <text x={0} y={14} textAnchor="middle" fill="currentColor" fontSize="11">
              {component.refdes}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
