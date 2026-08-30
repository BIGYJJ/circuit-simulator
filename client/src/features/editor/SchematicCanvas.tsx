import { useState } from "react";
import type { CircuitProjectV2, ComponentId, WireEndpoint } from "../../domain/project/project-v2";
import { getStaticComponentDefinition } from "../../domain/schematic/component-library";
import type { ProjectCommand } from "./project-reducer";

interface SchematicCanvasProps {
  project: CircuitProjectV2;
  selectedId: ComponentId | null;
  selectedWireId: string | null;
  onSelect: (componentId: ComponentId | null) => void;
  onSelectWire: (wireId: string | null) => void;
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

const PIN_OFFSET: Record<string, { x: number; y: number }> = {
  p: { x: 0, y: -28 },
  n: { x: 0, y: 28 },
  cp: { x: 28, y: -12 },
  cn: { x: 28, y: 12 },
  c: { x: 0, y: -28 },
  b: { x: -28, y: 0 },
  e: { x: 0, y: 28 },
  d: { x: 0, y: -28 },
  g: { x: -28, y: 0 },
  s: { x: 0, y: 28 },
};

function pinOffset(pin: string) {
  return PIN_OFFSET[pin] ?? { x: 24, y: 0 };
}

export default function SchematicCanvas({
  project,
  selectedId,
  selectedWireId,
  onSelect,
  onSelectWire,
  onCommand,
}: SchematicCanvasProps) {
  const [pending, setPending] = useState<WireEndpoint | null>(null);

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

  function clickPin(endpoint: WireEndpoint) {
    onSelect(endpoint.componentId);
    onSelectWire(null);
    if (!pending) {
      setPending(endpoint);
      return;
    }
    if (pending.componentId === endpoint.componentId && pending.pin === endpoint.pin) {
      setPending(null);
      return;
    }
    onCommand({
      type: "wire/add",
      wire: {
        id: `wire-${crypto.randomUUID()}`,
        from: pending,
        to: endpoint,
      },
    });
    setPending(null);
  }

  return (
    <svg className="workspace-canvas" viewBox="0 0 720 640" role="img" aria-label="原理图">
      {project.schematic.wires.map(wire => {
        const from = project.layout.components[wire.from.componentId];
        const to = project.layout.components[wire.to.componentId];
        if (!from || !to) return null;
        const fromPin = pinOffset(wire.from.pin);
        const toPin = pinOffset(wire.to.pin);
        const selected = selectedWireId === wire.id;
        return (
          <g key={wire.id} data-testid={`wire-${wire.id}`}>
            <line
              x1={from.x + fromPin.x}
              y1={from.y + fromPin.y}
              x2={to.x + toPin.x}
              y2={to.y + toPin.y}
              stroke="transparent"
              strokeWidth="16"
              onClick={event => {
                event.stopPropagation();
                onSelect(null);
                onSelectWire(wire.id);
              }}
            />
            <line
              x1={from.x + fromPin.x}
              y1={from.y + fromPin.y}
              x2={to.x + toPin.x}
              y2={to.y + toPin.y}
              stroke={selected ? "#c7f43d" : "currentColor"}
              strokeWidth={selected ? 3 : 2}
              pointerEvents="none"
            />
          </g>
        );
      })}
      {project.schematic.components.map(component => {
        const layout = project.layout.components[component.id] ?? { x: 40, y: 40, rotation: 0 };
        const selected = selectedId === component.id;
        const pins = component.kind === "subcircuit" ? component.orderedPins : getStaticComponentDefinition(component.kind).pins;
        return (
          <g
            key={component.id}
            data-testid={`component-${component.id}`}
            tabIndex={0}
            transform={`translate(${layout.x} ${layout.y})`}
            onClick={() => {
              onSelect(component.id);
              onSelectWire(null);
            }}
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
            {pins.map(pin => {
              const offset = pinOffset(pin);
              const active = pending?.componentId === component.id && pending.pin === pin;
              return (
                <circle
                  key={pin}
                  data-testid={`pin-${component.id}-${pin}`}
                  cx={offset.x}
                  cy={offset.y}
                  r={6}
                  fill={active ? "#c7f43d" : "#27d9ef"}
                  onClick={event => {
                    event.stopPropagation();
                    clickPin({ componentId: component.id, pin });
                  }}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
