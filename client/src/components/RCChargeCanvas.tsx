/**
 * 精密实验档案：SVG 只绘制 RC 文档与临时指针交互，完成编辑才向页面提交版本化电路事实。
 * 青蓝表示测量结果，萤光石灰表示选择、端口吸附和能量流，错误状态保留为可学习的开放端口。
 */

import type { ComponentKind, CircuitComponent, CircuitDocument, CircuitPortName, WireEndpoint } from "@/lib/circuit-model";
import type { RCChargeResult } from "@/lib/rc-charge-solver";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";

interface RCChargeCanvasProps {
  document: CircuitDocument;
  result: RCChargeResult | null;
  activeIndex: number;
  selectedId: string | null;
  selectedWireId: string | null;
  onSelect: (componentId: string) => void;
  onSelectWire: (wireId: string | null) => void;
  onToggleSwitch: () => void;
  onMoveComponent: (componentId: string, x: number, y: number) => void;
  onDropComponent: (kind: ComponentKind, x: number, y: number) => void;
  onCreateWire: (from: WireEndpoint, to: WireEndpoint) => void;
  onDeleteWire: (wireId: string) => void;
}

type Point = { x: number; y: number };
type ActiveDrag = { componentId: string; point: Point };
type ActiveWire = { from: WireEndpoint; point: Point; target: WireEndpoint | null };

const WIDTH = 1000;
const HEIGHT = 650;
const GRID = 25;
const SNAP_RADIUS = 26;

function clampSnap(point: Point): Point {
  const snap = (value: number) => Math.round(value / GRID) * GRID;
  return { x: Math.max(50, Math.min(WIDTH - 50, snap(point.x))), y: Math.max(50, Math.min(HEIGHT - 50, snap(point.y))) };
}

function portPoint(component: CircuitComponent, port: CircuitPortName): Point {
  if (component.kind === "ground") return { x: component.x, y: component.y - 34 };
  const offset = component.kind === "voltageSource" ? 66 : component.kind === "switch" ? 60 : component.kind === "capacitor" ? 54 : 60;
  return { x: component.x, y: component.y + (port === "top" ? -offset : offset) };
}

function portsFor(component: CircuitComponent): CircuitPortName[] { return component.kind === "ground" ? ["top"] : ["top", "bottom"]; }
function drawWire(from: Point, to: Point) { const middle = Math.round((from.x + to.x) / 2); return `M ${from.x} ${from.y} H ${middle} V ${to.y} H ${to.x}`; }
function sameEndpoint(left: WireEndpoint, right: WireEndpoint) { return left.componentId === right.componentId && left.port === right.port; }
function resistance(value?: number) { return value ? value >= 1000 ? `${(value / 1000).toFixed(1)} kΩ` : `${value} Ω` : "—"; }
function capacitance(value?: number) { return value ? `${(value * 1e6).toFixed(0)} μF` : "—"; }

function Resistor({ component, selected }: { component: CircuitComponent; selected: boolean }) {
  const top = portPoint(component, "top"); const bottom = portPoint(component, "bottom");
  const points = [`${component.x},${top.y}`, `${component.x},${top.y + 16}`, `${component.x - 14},${top.y + 28}`, `${component.x + 14},${top.y + 40}`, `${component.x - 14},${top.y + 52}`, `${component.x + 14},${top.y + 64}`, `${component.x - 14},${top.y + 76}`, `${component.x + 14},${top.y + 88}`, `${component.x},${top.y + 100}`, `${component.x},${bottom.y}`].join(" ");
  return <>{selected && <rect className="svg-selected-box" x={component.x - 33} y={top.y + 10} width="66" height="102" rx="6" />}<polyline className={cn("svg-symbol", selected && "svg-symbol-active")} points={points} /><text className="svg-label" x={component.x + 42} y={component.y - 8}>{component.label}</text><text className="svg-value" x={component.x + 42} y={component.y + 16}>{resistance(component.value)}</text></>;
}

function Capacitor({ component, selected }: { component: CircuitComponent; selected: boolean }) {
  const top = portPoint(component, "top"); const bottom = portPoint(component, "bottom");
  return <>{selected && <rect className="svg-selected-box svg-cyan-selection" x={component.x - 39} y={component.y - 37} width="78" height="74" rx="6" />}<line className={cn("svg-symbol", selected && "svg-cyan-symbol")} x1={component.x} y1={top.y} x2={component.x} y2={component.y - 12} /><line className={cn("svg-symbol", selected && "svg-cyan-symbol")} x1={component.x - 29} y1={component.y - 12} x2={component.x + 29} y2={component.y - 12} /><line className={cn("svg-symbol", selected && "svg-cyan-symbol")} x1={component.x - 29} y1={component.y + 12} x2={component.x + 29} y2={component.y + 12} /><line className={cn("svg-symbol", selected && "svg-cyan-symbol")} x1={component.x} y1={component.y + 12} x2={component.x} y2={bottom.y} /><text className="svg-label" x={component.x + 43} y={component.y - 8}>{component.label}</text><text className="svg-value" x={component.x + 43} y={component.y + 16}>{capacitance(component.value)}</text></>;
}

function Source({ component, selected }: { component: CircuitComponent; selected: boolean }) {
  const top = portPoint(component, "top"); const bottom = portPoint(component, "bottom");
  return <>{selected && <circle className="svg-selected-ring" cx={component.x} cy={component.y} r="40" />}<line className={cn("svg-symbol", selected && "svg-symbol-active")} x1={component.x} y1={top.y} x2={component.x} y2={component.y - 28} /><circle className={cn("svg-symbol-fill", selected && "svg-symbol-fill-active")} cx={component.x} cy={component.y} r="28" /><line className={cn("svg-symbol", selected && "svg-symbol-active")} x1={component.x} y1={component.y + 28} x2={component.x} y2={bottom.y} /><path className={cn("svg-symbol", selected && "svg-symbol-active")} d={`M ${component.x - 7} ${component.y - 8} H ${component.x + 7} M ${component.x} ${component.y - 15} V ${component.x} ${component.y - 1} M ${component.x - 7} ${component.y + 13} H ${component.x + 7}`} /><text className="svg-label" x={component.x + 45} y={component.y - 8}>{component.label}</text><text className="svg-value" x={component.x + 45} y={component.y + 16}>{component.value ?? 0} V</text></>;
}

function Switch({ component, selected }: { component: CircuitComponent; selected: boolean }) {
  const top = portPoint(component, "top"); const bottom = portPoint(component, "bottom"); const mode = component.switchMode ?? (component.closed === false ? "hold" : "charge"); const conductive = mode !== "hold";
  return <>{selected && <circle className="svg-selected-ring" cx={component.x} cy={component.y} r="42" />}<line className="svg-symbol" x1={component.x} y1={top.y} x2={component.x} y2={component.y - 18} /><circle className={cn("svg-terminal", conductive && "svg-terminal-active")} cx={component.x} cy={component.y - 18} r="5" /><circle className={cn("svg-terminal", conductive && "svg-terminal-active")} cx={component.x + 26} cy={component.y + 10} r="5" /><path className={cn("svg-symbol", conductive && "svg-symbol-active")} d={conductive ? `M ${component.x} ${component.y - 18} L ${component.x + 26} ${component.y + 10}` : `M ${component.x} ${component.y - 18} L ${component.x + 23} ${component.y - 26}`} /><path className="svg-symbol" d={`M ${component.x + 26} ${component.y + 10} L ${component.x} ${component.y + 40} V ${bottom.y}`} /><text className="svg-label" x={component.x + 48} y={component.y - 4}>{component.label}</text><text className={cn("svg-value", conductive && "svg-lime-value")} x={component.x + 48} y={component.y + 19}>{mode === "charge" ? "充电" : mode === "discharge" ? "放电" : "保持"}</text></>;
}

function Ground({ component, selected }: { component: CircuitComponent; selected: boolean }) {
  const top = portPoint(component, "top");
  return <>{selected && <circle className="svg-selected-ring" cx={component.x} cy={component.y - 3} r="35" />}<line className={cn("svg-symbol", selected && "svg-symbol-active")} x1={component.x} y1={top.y} x2={component.x} y2={component.y - 8} /><path className={cn("svg-symbol", selected && "svg-symbol-active")} d={`M ${component.x - 25} ${component.y - 8} H ${component.x + 25} M ${component.x - 16} ${component.y + 3} H ${component.x + 16} M ${component.x - 7} ${component.y + 14} H ${component.x + 7}`} /></>;
}

export default function RCChargeCanvas({ document, result, activeIndex, selectedId, selectedWireId, onSelect, onSelectWire, onToggleSwitch, onMoveComponent, onDropComponent, onCreateWire, onDeleteWire }: RCChargeCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<ActiveDrag | null>(null);
  const [wiring, setWiring] = useState<ActiveWire | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const components = document.components.map((component) => drag?.componentId === component.id ? { ...component, ...drag.point } : component);
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const solution = result?.success ? result.solution : null;
  const sample = solution?.samples[Math.min(activeIndex, Math.max(solution.samples.length - 1, 0))];
  const cap = componentMap.get("C1");

  const eventPoint = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return clampSnap({ x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT });
  };
  const targetPort = (point: Point, origin: WireEndpoint) => {
    let nearest: { endpoint: WireEndpoint; distance: number } | null = null;
    for (const component of components) for (const port of portsFor(component)) {
      const candidate = { componentId: component.id, port } as WireEndpoint;
      if (sameEndpoint(candidate, origin)) continue;
      const location = portPoint(component, port); const distance = Math.hypot(location.x - point.x, location.y - point.y);
      if (distance <= SNAP_RADIUS && (!nearest || distance < nearest.distance)) nearest = { endpoint: candidate, distance };
    }
    return nearest?.endpoint ?? null;
  };
  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag) { setDrag({ componentId: drag.componentId, point: eventPoint(event) }); return; }
    if (wiring) { const raw = eventPoint(event); const target = targetPort(raw, wiring.from); const targetComponent = target ? componentMap.get(target.componentId) : null; setWiring({ from: wiring.from, target, point: target && targetComponent ? portPoint(targetComponent, target.port) : raw }); }
  };
  const finish = () => {
    if (drag) { const original = document.components.find((component) => component.id === drag.componentId); if (original && (original.x !== drag.point.x || original.y !== drag.point.y)) onMoveComponent(drag.componentId, drag.point.x, drag.point.y); setDrag(null); }
    if (wiring) { if (wiring.target) onCreateWire(wiring.from, wiring.target); setWiring(null); }
  };
  const beginMove = (event: React.PointerEvent<SVGGElement>, component: CircuitComponent) => { if (event.button !== 0) return; event.stopPropagation(); onSelect(component.id); onSelectWire(null); svgRef.current?.setPointerCapture(event.pointerId); setDrag({ componentId: component.id, point: { x: component.x, y: component.y } }); };
  const beginWire = (event: React.PointerEvent<SVGCircleElement>, component: CircuitComponent, port: CircuitPortName) => { if (event.button !== 0) return; event.stopPropagation(); onSelect(component.id); onSelectWire(null); svgRef.current?.setPointerCapture(event.pointerId); setWiring({ from: { componentId: component.id, port }, point: portPoint(component, port), target: null }); };

  return <div className={cn("rc-canvas-stage", isDropTarget && "is-drop-target", wiring && "is-wiring")} aria-label="可编辑 RC 实验画布">
    <div className="rc-canvas-title"><span>RC {solution?.mode === "discharge" ? "放电" : solution?.mode === "hold" ? "保持" : "充电"} · 瞬态实验</span><small>拖动元件；由端口拖向端口以连线</small></div>
    {isDropTarget && <div className="canvas-drop-hint">松开以放置元件</div>}{wiring && <div className="canvas-wire-hint">{wiring.target ? "松开以连接端口" : "拖到另一端口以连接"}</div>}
    <svg ref={svgRef} className="rc-circuit-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="可编辑的 RC 实验电路" tabIndex={0} onPointerMove={handleMove} onPointerUp={finish} onPointerCancel={() => { setDrag(null); setWiring(null); }} onPointerDown={() => onSelectWire(null)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setIsDropTarget(true); }} onDragLeave={() => setIsDropTarget(false)} onDrop={(event) => { event.preventDefault(); setIsDropTarget(false); const kind = event.dataTransfer.getData("application/x-circuit-kind") as ComponentKind; if (["resistor", "capacitor", "voltageSource", "switch", "ground"].includes(kind)) { const point = eventPoint(event); onDropComponent(kind, point.x, point.y); } }} onKeyDown={(event) => { if ((event.key === "Delete" || event.key === "Backspace") && selectedWireId) onDeleteWire(selectedWireId); }}>
      <defs><pattern id="rcMinorGrid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" className="svg-grid-minor" fill="none" /></pattern><pattern id="rcMajorGrid" width="125" height="125" patternUnits="userSpaceOnUse"><rect width="125" height="125" fill="url(#rcMinorGrid)" /><path d="M 125 0 L 0 0 0 125" className="svg-grid-major" fill="none" /></pattern></defs>
      <rect width={WIDTH} height={HEIGHT} fill="url(#rcMajorGrid)" />
      {document.wires.map((wire) => { const from = componentMap.get(wire.from.componentId); const to = componentMap.get(wire.to.componentId); if (!from || !to) return null; return <path key={wire.id} className={cn("svg-wire", solution && "rc-wire-live", selectedWireId === wire.id && "svg-wire-selected")} d={drawWire(portPoint(from, wire.from.port), portPoint(to, wire.to.port))} onPointerDown={(event) => { event.stopPropagation(); onSelectWire(wire.id); }} />; })}
      {wiring && (() => { const origin = componentMap.get(wiring.from.componentId); return origin ? <path d={drawWire(portPoint(origin, wiring.from.port), wiring.point)} className="svg-wire svg-wire-preview" /> : null; })()}
      {cap && <><path className="svg-wire" d={`M ${cap.x} ${portPoint(cap, "top").y} H 760`} /><circle className="svg-output-port" cx="760" cy={portPoint(cap, "top").y} r="6" /><text className="svg-label" x="780" y={portPoint(cap, "top").y + 6}>Vcap</text></>}
      {components.map((component) => <g key={component.id} className={cn("rc-selectable", drag?.componentId === component.id && "is-dragging")} onPointerDown={(event) => beginMove(event, component)} onDoubleClick={() => component.kind === "switch" && onToggleSwitch()}>{component.kind === "resistor" && <Resistor component={component} selected={selectedId === component.id} />}{component.kind === "capacitor" && <Capacitor component={component} selected={selectedId === component.id} />}{component.kind === "voltageSource" && <Source component={component} selected={selectedId === component.id} />}{component.kind === "switch" && <Switch component={component} selected={selectedId === component.id} />}{component.kind === "ground" && <Ground component={component} selected={selectedId === component.id} />}{portsFor(component).map((port) => { const location = portPoint(component, port); const isTarget = wiring?.target?.componentId === component.id && wiring?.target?.port === port; return <g key={port}><circle className={cn("svg-terminal", selectedId === component.id && "svg-terminal-active", isTarget && "svg-terminal-target")} cx={location.x} cy={location.y} r="5" /><circle className="svg-port-hit" cx={location.x} cy={location.y} r="13" onPointerDown={(event) => beginWire(event, component, port)} /></g>; })}</g>)}
      {sample && cap && <><g transform={`translate(${cap.x + 57} ${cap.y - 58})`}><rect className="svg-reading-card" width="150" height="64" rx="7" /><circle className="svg-reading-icon" cx="24" cy="25" r="13" /><text className="svg-reading-v" x="19" y="30">V</text><text className="svg-reading-title" x="47" y="22">Vcap</text><text className="svg-reading-value" x="47" y="44">{sample.capacitorVoltage.toFixed(3)} V</text></g><g transform="translate(665 188)"><rect className="svg-current-chip" width="128" height="52" rx="6" /><text className="svg-reading-title" x="16" y="20">I(R1)</text><text className="svg-reading-value" x="16" y="39">{(sample.current * 1000).toFixed(3)} mA</text></g><g transform="translate(96 563)"><rect className="svg-solver-chip svg-solver-chip-live" width="156" height="34" rx="5" /><circle cx="18" cy="17" r="5" className="svg-solver-dot svg-solver-dot-live" /><text className="svg-solver-text" x="32" y="22">t = {(sample.time < 1 ? sample.time * 1000 : sample.time).toFixed(sample.time < 1 ? 0 : 2)} {sample.time < 1 ? "ms" : "s"}</text></g></>}
    </svg>
  </div>;
}
