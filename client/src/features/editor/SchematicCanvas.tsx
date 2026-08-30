import { memo, useState } from "react";
import type { CircuitProjectV2, ComponentId, ComponentInstance, WireEndpoint } from "../../domain/project/project-v2";
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

const ComponentGlyph = memo(function ComponentGlyph({
  component,
  x,
  y,
  selected,
  pendingPin,
  onSelect,
  onPin,
  onNudge,
  onMoveTo,
}: {
  component: ComponentInstance;
  x: number;
  y: number;
  selected: boolean;
  pendingPin: string | null;
  onSelect: (id: ComponentId) => void;
  onPin: (endpoint: WireEndpoint) => void;
  onNudge: (id: ComponentId, dx: number, dy: number) => void;
  onMoveTo: (id: ComponentId, nextX: number, nextY: number) => void;
}) {
  const pins = component.kind === "subcircuit" ? component.orderedPins : getStaticComponentDefinition(component.kind).pins;
  return (
    <g
      data-testid={`component-${component.id}`}
      tabIndex={0}
      transform={`translate(${x} ${y})`}
      onClick={() => onSelect(component.id)}
      onFocus={() => onSelect(component.id)}
      onPointerDown={event => {
        if (event.button !== 0) return;
        (event.currentTarget as SVGElement).dataset.drag = `${x},${y},${event.clientX},${event.clientY}`;
      }}
      onPointerMove={event => {
        const drag = (event.currentTarget as SVGElement).dataset.drag;
        if (!drag) return;
        const [ox, oy, cx, cy] = drag.split(",").map(Number);
        onMoveTo(component.id, ox + event.clientX - cx, oy + event.clientY - cy);
      }}
      onPointerUp={event => {
        const el = event.currentTarget as SVGElement;
        const drag = el.dataset.drag;
        if (drag) {
          const [ox, oy, cx, cy] = drag.split(",").map(Number);
          onMoveTo(component.id, ox + event.clientX - cx, oy + event.clientY - cy);
        }
        delete el.dataset.drag;
      }}
      onKeyDown={event => {
        if (!event.altKey) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onNudge(component.id, 20, 0);
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onNudge(component.id, -20, 0);
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onNudge(component.id, 0, -20);
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          onNudge(component.id, 0, 20);
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
        return (
          <circle
            key={pin}
            data-testid={`pin-${component.id}-${pin}`}
            cx={offset.x}
            cy={offset.y}
            r={6}
            fill={pendingPin === pin ? "#c7f43d" : "#27d9ef"}
            onClick={event => {
              event.stopPropagation();
              onPin({ componentId: component.id, pin });
            }}
          />
        );
      })}
    </g>
  );
});

export default function SchematicCanvas({
  project,
  selectedId,
  selectedWireId,
  onSelect,
  onSelectWire,
  onCommand,
}: SchematicCanvasProps) {
  const [pending, setPending] = useState<WireEndpoint | null>(null);

  function moveComponent(componentId: ComponentId, dx: number, dy: number) {
    const current = project.layout.components[componentId];
    if (!current || (dx === 0 && dy === 0)) return;
    onCommand({
      type: "layout/componentSet",
      componentId,
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
    <svg className="workspace-canvas" viewBox="0 0 720 640" role="img" aria-label="原理图" data-testid="workspace-canvas">
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
              data-testid={`canvas-hit-wire-${wire.id}`}
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
        return (
          <ComponentGlyph
            key={component.id}
            component={component}
            x={layout.x}
            y={layout.y}
            selected={selectedId === component.id}
            pendingPin={pending?.componentId === component.id ? pending.pin : null}
            onSelect={id => {
              onSelect(id);
              onSelectWire(null);
            }}
            onPin={clickPin}
            onNudge={moveComponent}
            onMoveTo={(id, nextX, nextY) => {
              const current = project.layout.components[id];
              if (!current || (current.x === nextX && current.y === nextY)) return;
              onCommand({ type: "layout/componentSet", componentId: id, layout: { ...current, x: nextX, y: nextY } });
            }}
          />
        );
      })}
    </svg>
  );
}
