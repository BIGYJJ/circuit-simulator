/**
 * 精密实验档案：SVG 只呈现可编辑的电路事实及临时指针预览，完成操作才向上层提交版本化文档变更。
 * 深色网格承载搭建层；白色连线表示实际连接；萤光石灰仅表示吸附、选中和正在构建的连接。
 */

import type { ComponentKind, CircuitComponent, CircuitDocument, CircuitPortName, WireEndpoint } from "@/lib/circuit-model";
import type { SimulationResult } from "@/lib/circuit-solver";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";

interface CircuitCanvasProps {
  document: CircuitDocument;
  selectedId: string | null;
  selectedWireId: string | null;
  simulation: SimulationResult | null;
  zoom: number;
  onSelect: (componentId: string) => void;
  onSelectWire: (wireId: string | null) => void;
  onMoveComponent: (componentId: string, x: number, y: number) => void;
  onDropComponent: (kind: ComponentKind, x: number, y: number) => void;
  onCreateWire: (from: WireEndpoint, to: WireEndpoint) => void;
  onDeleteWire: (wireId: string) => void;
}

type Point = { x: number; y: number };
type ActiveDrag = { componentId: string; point: Point };
type ActiveWire = { from: WireEndpoint; point: Point; target: WireEndpoint | null };

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 650;
const GRID_SIZE = 25;
const SNAP_RADIUS = 26;

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function snapPoint(point: Point): Point {
  return { x: Math.max(50, Math.min(CANVAS_WIDTH - 50, snap(point.x))), y: Math.max(50, Math.min(CANVAS_HEIGHT - 50, snap(point.y))) };
}

function sameEndpoint(left: WireEndpoint, right: WireEndpoint) {
  return left.componentId === right.componentId && left.port === right.port;
}

function portPoint(component: CircuitComponent, port: CircuitPortName): Point {
  if (component.kind === "ground") return { x: component.x, y: component.y - 34 };
  const offset = component.kind === "voltageSource" ? 66 : 60;
  return { x: component.x, y: component.y + (port === "top" ? -offset : offset) };
}

function portsFor(component: CircuitComponent): CircuitPortName[] {
  return component.kind === "ground" ? ["top"] : ["top", "bottom"];
}

function formatResistance(value?: number) {
  if (value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 1 : 2)} kΩ` : `${value} Ω`;
}

function componentLabel(component: CircuitComponent) {
  const title = component.kind === "voltageSource" ? `${component.value ?? 0}V` : formatResistance(component.value);
  return `${component.label} ${title}`;
}

function drawWire(from: Point, to: Point) {
  const middle = Math.round((from.x + to.x) / 2);
  return `M ${from.x} ${from.y} H ${middle} V ${to.y} H ${to.x}`;
}

function ResistorSymbol({ component, active }: { component: CircuitComponent; active: boolean }) {
  const top = portPoint(component, "top");
  const bottom = portPoint(component, "bottom");
  const left = component.x - 13;
  const right = component.x + 13;
  const points = [
    `${component.x},${top.y}`,
    `${component.x},${top.y + 17}`,
    `${left},${top.y + 29}`,
    `${right},${top.y + 41}`,
    `${left},${top.y + 53}`,
    `${right},${top.y + 65}`,
    `${left},${top.y + 77}`,
    `${right},${top.y + 89}`,
    `${component.x},${top.y + 101}`,
    `${component.x},${bottom.y}`,
  ].join(" ");

  return (
    <>
      {active && <rect className="svg-selected-box" x={component.x - 31} y={top.y + 11} width="62" height="99" rx="6" />}
      <polyline className={cn("svg-symbol", active && "svg-symbol-active")} points={points} />
      <text className="svg-label" x={component.x + 38} y={component.y - 8}>{component.label}</text>
      <text className="svg-value" x={component.x + 38} y={component.y + 17}>{formatResistance(component.value)}</text>
    </>
  );
}

function VoltageSourceSymbol({ component, active }: { component: CircuitComponent; active: boolean }) {
  const top = portPoint(component, "top");
  const bottom = portPoint(component, "bottom");
  return (
    <>
      {active && <circle className="svg-selected-ring" cx={component.x} cy={component.y} r="40" />}
      <line className={cn("svg-symbol", active && "svg-symbol-active")} x1={component.x} y1={top.y} x2={component.x} y2={component.y - 28} />
      <circle className={cn("svg-symbol-fill", active && "svg-symbol-fill-active")} cx={component.x} cy={component.y} r="28" />
      <line className={cn("svg-symbol", active && "svg-symbol-active")} x1={component.x} y1={component.y + 28} x2={component.x} y2={bottom.y} />
      <path className={cn("svg-symbol", active && "svg-symbol-active")} d={`M ${component.x - 7} ${component.y - 8} H ${component.x + 7} M ${component.x} ${component.y - 15} V ${component.x} ${component.y - 1} M ${component.x - 7} ${component.y + 13} H ${component.x + 7}`} />
      <text className="svg-label" x={component.x + 46} y={component.y - 7}>{component.label}</text>
      <text className="svg-value" x={component.x + 46} y={component.y + 17}>{component.value ?? 0} V</text>
    </>
  );
}

function GroundSymbol({ component, active }: { component: CircuitComponent; active: boolean }) {
  const top = portPoint(component, "top");
  return (
    <>
      {active && <circle className="svg-selected-ring" cx={component.x} cy={component.y - 3} r="35" />}
      <line className={cn("svg-symbol", active && "svg-symbol-active")} x1={component.x} y1={top.y} x2={component.x} y2={component.y - 8} />
      <path className={cn("svg-symbol", active && "svg-symbol-active")} d={`M ${component.x - 25} ${component.y - 8} H ${component.x + 25} M ${component.x - 16} ${component.y + 3} H ${component.x + 16} M ${component.x - 7} ${component.y + 14} H ${component.x + 7}`} />
      <text className="svg-muted-label" x={component.x + 42} y={component.y + 5}>参考地</text>
    </>
  );
}

export default function CircuitCanvas({
  document,
  selectedId,
  selectedWireId,
  simulation,
  zoom,
  onSelect,
  onSelectWire,
  onMoveComponent,
  onDropComponent,
  onCreateWire,
  onDeleteWire,
}: CircuitCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<ActiveDrag | null>(null);
  const [wiring, setWiring] = useState<ActiveWire | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const components = document.components.map((component) =>
    drag?.componentId === component.id ? { ...component, ...drag.point } : component,
  );
  const componentById = new Map(components.map((component) => [component.id, component]));
  const isLive = simulation?.success === true;
  const outputResistorId = isLive ? simulation.solution.rLow.id : null;
  const outputResistor = outputResistorId ? componentById.get(outputResistorId) : undefined;
  const outputNode = outputResistor ? portPoint(outputResistor, "top") : null;

  const eventPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return snapPoint({ x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH, y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT });
  };

  const findTargetPort = (point: Point, ignored: WireEndpoint): WireEndpoint | null => {
    let nearest: { endpoint: WireEndpoint; distance: number } | null = null;
    for (const component of components) {
      for (const port of portsFor(component)) {
        const candidate = { componentId: component.id, port } as WireEndpoint;
        if (sameEndpoint(candidate, ignored)) continue;
        const targetPoint = portPoint(component, port);
        const distance = Math.hypot(targetPoint.x - point.x, targetPoint.y - point.y);
        if (distance <= SNAP_RADIUS && (!nearest || distance < nearest.distance)) nearest = { endpoint: candidate, distance };
      }
    }
    return nearest?.endpoint ?? null;
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag) {
      setDrag({ componentId: drag.componentId, point: eventPoint(event) });
      return;
    }
    if (wiring) {
      const point = eventPoint(event);
      const target = findTargetPort(point, wiring.from);
      const targetComponent = target ? componentById.get(target.componentId) : null;
      setWiring({ from: wiring.from, target, point: target && targetComponent ? portPoint(targetComponent, target.port) : point });
    }
  };

  const finishPointer = () => {
    if (drag) {
      const original = document.components.find((component) => component.id === drag.componentId);
      if (original && (original.x !== drag.point.x || original.y !== drag.point.y)) onMoveComponent(drag.componentId, drag.point.x, drag.point.y);
      setDrag(null);
    }
    if (wiring) {
      if (wiring.target) onCreateWire(wiring.from, wiring.target);
      setWiring(null);
    }
  };

  const beginMove = (event: React.PointerEvent<SVGGElement>, component: CircuitComponent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect(component.id);
    onSelectWire(null);
    svgRef.current?.setPointerCapture(event.pointerId);
    setDrag({ componentId: component.id, point: { x: component.x, y: component.y } });
  };

  const beginWire = (event: React.PointerEvent<SVGCircleElement>, component: CircuitComponent, port: CircuitPortName) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const from = { componentId: component.id, port } as WireEndpoint;
    onSelect(component.id);
    onSelectWire(null);
    svgRef.current?.setPointerCapture(event.pointerId);
    setWiring({ from, point: portPoint(component, port), target: null });
  };

  const handleDrop = (event: React.DragEvent<SVGSVGElement>) => {
    event.preventDefault();
    setIsDropTarget(false);
    const kind = event.dataTransfer.getData("application/x-circuit-kind") as ComponentKind;
    if (["resistor", "voltageSource", "ground"].includes(kind)) {
      const point = eventPoint(event);
      onDropComponent(kind, point.x, point.y);
    }
  };

  return (
    <div className={cn("canvas-stage", isDropTarget && "is-drop-target", wiring && "is-wiring")} aria-label="可编辑分压电路画布">
      <div className="canvas-ruler canvas-ruler-x"><span>0</span><span>200</span><span>400</span><span>600</span><span>800</span></div>
      <div className="canvas-ruler canvas-ruler-y"><span>0</span><span>160</span><span>320</span><span>480</span></div>
      {isDropTarget && <div className="canvas-drop-hint">松开以放置元件</div>}
      {wiring && <div className="canvas-wire-hint">{wiring.target ? "松开以连接端口" : "拖到另一端口以连接"}</div>}
      <div className="canvas-scroll-area">
        <svg
          ref={svgRef}
          className="circuit-svg"
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ transform: `scale(${zoom / 100})` }}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={() => { setDrag(null); setWiring(null); }}
          onPointerDown={() => onSelectWire(null)}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setIsDropTarget(true); }}
          onDragLeave={() => setIsDropTarget(false)}
          onDrop={handleDrop}
          onKeyDown={(event) => { if ((event.key === "Delete" || event.key === "Backspace") && selectedWireId) onDeleteWire(selectedWireId); }}
          tabIndex={0}
        >
          <defs>
            <pattern id="minorGrid" width="25" height="25" patternUnits="userSpaceOnUse">
              <path d="M 25 0 L 0 0 0 25" className="svg-grid-minor" fill="none" />
            </pattern>
            <pattern id="majorGrid" width="125" height="125" patternUnits="userSpaceOnUse">
              <rect width="125" height="125" fill="url(#minorGrid)" />
              <path d="M 125 0 L 0 0 0 125" className="svg-grid-major" fill="none" />
            </pattern>
          </defs>
          <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#majorGrid)" />
          <g className={isLive ? "wire-group wire-live" : "wire-group"}>
            {document.wires.map((wire) => {
              const fromComponent = componentById.get(wire.from.componentId);
              const toComponent = componentById.get(wire.to.componentId);
              if (!fromComponent || !toComponent) return null;
              const from = portPoint(fromComponent, wire.from.port);
              const to = portPoint(toComponent, wire.to.port);
              const selected = selectedWireId === wire.id;
              return <path key={wire.id} d={drawWire(from, to)} className={cn("svg-wire", selected && "svg-wire-selected")} onPointerDown={(event) => { event.stopPropagation(); onSelectWire(wire.id); }} />;
            })}
          </g>

          {wiring && (() => {
            const startComponent = componentById.get(wiring.from.componentId);
            if (!startComponent) return null;
            const start = portPoint(startComponent, wiring.from.port);
            return <path d={drawWire(start, wiring.point)} className="svg-wire svg-wire-preview" />;
          })()}

          {outputNode && (
            <g className="output-branch">
              <path d={`M ${outputNode.x} ${outputNode.y} H 700`} className="svg-wire" />
              <circle className="svg-output-port" cx="700" cy={outputNode.y} r="6" />
              <text className="svg-label" x="720" y={outputNode.y + 6}>Vout</text>
            </g>
          )}

          {components.map((component) => {
            const active = component.id === selectedId;
            return (
              <g
                key={component.id}
                className={cn("circuit-component", drag?.componentId === component.id && "is-dragging")}
                role="button"
                tabIndex={0}
                aria-label={`选择或移动 ${componentLabel(component)}`}
                onPointerDown={(event) => beginMove(event, component)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(component.id); } }}
              >
                {component.kind === "resistor" && <ResistorSymbol component={component} active={active} />}
                {component.kind === "voltageSource" && <VoltageSourceSymbol component={component} active={active} />}
                {component.kind === "ground" && <GroundSymbol component={component} active={active} />}
                {portsFor(component).map((port) => {
                  const point = portPoint(component, port);
                  const isTarget = wiring?.target?.componentId === component.id && wiring?.target?.port === port;
                  return (
                    <g key={port}>
                      <circle className={cn("svg-terminal", active && "svg-terminal-active", isTarget && "svg-terminal-target")} cx={point.x} cy={point.y} r="5" />
                      <circle className="svg-port-hit" cx={point.x} cy={point.y} r="13" onPointerDown={(event) => beginWire(event, component, port)} />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {outputNode && isLive && (
            <g transform={`translate(${outputNode.x + 55} ${outputNode.y - 76})`}>
              <rect className="svg-reading-card" width="148" height="63" rx="7" />
              <circle className="svg-reading-icon" cx="24" cy="25" r="13" />
              <text className="svg-reading-v" x="20" y="30">V</text>
              <text className="svg-reading-title" x="47" y="22">Vout</text>
              <text className="svg-reading-value" x="47" y="43">{simulation.solution.vout.toFixed(3)} V</text>
            </g>
          )}

          <g transform="translate(52 590)">
            <rect className={cn("svg-solver-chip", isLive && "svg-solver-chip-live")} width="130" height="34" rx="5" />
            <circle cx="18" cy="17" r="5" className={cn("svg-solver-dot", isLive && "svg-solver-dot-live")} />
            <text className="svg-solver-text" x="32" y="22">{isLive ? "DC 解已验证" : "等待求解"}</text>
          </g>
        </svg>
      </div>
    </div>
  );
}
