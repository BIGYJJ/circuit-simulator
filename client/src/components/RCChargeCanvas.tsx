/**
 * 精密实验档案：本画布呈现 RC 充电的搭建层和现象层，数值全部来自独立瞬态求解器。
 * 青蓝表示测量读数，萤光石灰表示闭合开关与当前电流方向，避免把装饰动画误作物理结果。
 */

import type { CircuitComponent, CircuitDocument, CircuitPortName } from "@/lib/circuit-model";
import type { RCChargeResult } from "@/lib/rc-charge-solver";
import { cn } from "@/lib/utils";

interface RCChargeCanvasProps {
  document: CircuitDocument;
  result: RCChargeResult | null;
  activeIndex: number;
  selectedId: string;
  onSelect: (componentId: string) => void;
  onToggleSwitch: () => void;
}

type Point = { x: number; y: number };

function portPoint(component: CircuitComponent, port: CircuitPortName): Point {
  if (component.kind === "ground") return { x: component.x, y: component.y - 34 };
  const offset = component.kind === "voltageSource" ? 66 : component.kind === "switch" ? 60 : component.kind === "capacitor" ? 54 : 60;
  return { x: component.x, y: component.y + (port === "top" ? -offset : offset) };
}

function route(from: Point, to: Point) {
  const middle = Math.round((from.x + to.x) / 2);
  return `M ${from.x} ${from.y} H ${middle} V ${to.y} H ${to.x}`;
}

function formatTime(time: number) {
  return time < 1 ? `${(time * 1000).toFixed(0)} ms` : `${time.toFixed(2)} s`;
}

function formatCurrent(current: number) {
  return `${(current * 1000).toFixed(3)} mA`;
}

function Resistor({ component, selected }: { component: CircuitComponent; selected: boolean }) {
  const top = portPoint(component, "top");
  const bottom = portPoint(component, "bottom");
  const points = [
    `${component.x},${top.y}`, `${component.x},${top.y + 16}`, `${component.x - 14},${top.y + 28}`,
    `${component.x + 14},${top.y + 40}`, `${component.x - 14},${top.y + 52}`, `${component.x + 14},${top.y + 64}`,
    `${component.x - 14},${top.y + 76}`, `${component.x + 14},${top.y + 88}`, `${component.x},${top.y + 100}`, `${component.x},${bottom.y}`,
  ].join(" ");
  return <g className="rc-selectable" onClick={() => undefined}>
    {selected && <rect className="svg-selected-box" x={component.x - 33} y={top.y + 10} width="66" height="102" rx="6" />}
    <polyline className={cn("svg-symbol", selected && "svg-symbol-active")} points={points} />
    <text className="svg-label" x={component.x + 42} y={component.y - 8}>R1</text>
    <text className="svg-value" x={component.x + 42} y={component.y + 16}>10.0 kΩ</text>
  </g>;
}

function Capacitor({ component, selected }: { component: CircuitComponent; selected: boolean }) {
  const top = portPoint(component, "top");
  const bottom = portPoint(component, "bottom");
  return <g className="rc-selectable">
    {selected && <rect className="svg-selected-box svg-cyan-selection" x={component.x - 39} y={component.y - 37} width="78" height="74" rx="6" />}
    <line className={cn("svg-symbol", selected && "svg-cyan-symbol")} x1={component.x} y1={top.y} x2={component.x} y2={component.y - 12} />
    <line className={cn("svg-symbol", selected && "svg-cyan-symbol")} x1={component.x - 29} y1={component.y - 12} x2={component.x + 29} y2={component.y - 12} />
    <line className={cn("svg-symbol", selected && "svg-cyan-symbol")} x1={component.x - 29} y1={component.y + 12} x2={component.x + 29} y2={component.y + 12} />
    <line className={cn("svg-symbol", selected && "svg-cyan-symbol")} x1={component.x} y1={component.y + 12} x2={component.x} y2={bottom.y} />
    <text className="svg-label" x={component.x + 43} y={component.y - 8}>C1</text>
    <text className="svg-value" x={component.x + 43} y={component.y + 16}>100 μF</text>
  </g>;
}

function VoltageSource({ component, selected }: { component: CircuitComponent; selected: boolean }) {
  const top = portPoint(component, "top");
  const bottom = portPoint(component, "bottom");
  return <g className="rc-selectable">
    {selected && <circle className="svg-selected-ring" cx={component.x} cy={component.y} r="40" />}
    <line className={cn("svg-symbol", selected && "svg-symbol-active")} x1={component.x} y1={top.y} x2={component.x} y2={component.y - 28} />
    <circle className={cn("svg-symbol-fill", selected && "svg-symbol-fill-active")} cx={component.x} cy={component.y} r="28" />
    <line className={cn("svg-symbol", selected && "svg-symbol-active")} x1={component.x} y1={component.y + 28} x2={component.x} y2={bottom.y} />
    <path className={cn("svg-symbol", selected && "svg-symbol-active")} d={`M ${component.x - 7} ${component.y - 8} H ${component.x + 7} M ${component.x} ${component.y - 15} V ${component.x} ${component.y - 1} M ${component.x - 7} ${component.y + 13} H ${component.x + 7}`} />
    <text className="svg-label" x={component.x + 45} y={component.y - 8}>V1</text>
    <text className="svg-value" x={component.x + 45} y={component.y + 16}>5 V</text>
  </g>;
}

function Switch({ component, selected, onToggle }: { component: CircuitComponent; selected: boolean; onToggle: () => void }) {
  const top = portPoint(component, "top");
  const bottom = portPoint(component, "bottom");
  const closed = component.closed !== false;
  return <g className="rc-selectable" onDoubleClick={onToggle}>
    {selected && <circle className="svg-selected-ring" cx={component.x} cy={component.y} r="42" />}
    <line className="svg-symbol" x1={component.x} y1={top.y} x2={component.x} y2={component.y - 18} />
    <circle className={cn("svg-terminal", closed && "svg-terminal-active")} cx={component.x} cy={component.y - 18} r="5" />
    <circle className={cn("svg-terminal", closed && "svg-terminal-active")} cx={component.x + 26} cy={component.y + 10} r="5" />
    <path className={cn("svg-symbol", closed && "svg-symbol-active")} d={closed ? `M ${component.x} ${component.y - 18} L ${component.x + 26} ${component.y + 10}` : `M ${component.x} ${component.y - 18} L ${component.x + 23} ${component.y - 26}`} />
    <path className="svg-symbol" d={`M ${component.x + 26} ${component.y + 10} L ${component.x} ${component.y + 40} V ${bottom.y}`} />
    <text className="svg-label" x={component.x + 48} y={component.y - 4}>S1</text>
    <text className={cn("svg-value", closed && "svg-lime-value")} x={component.x + 48} y={component.y + 19}>{closed ? "已闭合" : "已断开"}</text>
  </g>;
}

function Ground({ component, selected }: { component: CircuitComponent; selected: boolean }) {
  const top = portPoint(component, "top");
  return <g className="rc-selectable">
    {selected && <circle className="svg-selected-ring" cx={component.x} cy={component.y - 3} r="35" />}
    <line className={cn("svg-symbol", selected && "svg-symbol-active")} x1={component.x} y1={top.y} x2={component.x} y2={component.y - 8} />
    <path className={cn("svg-symbol", selected && "svg-symbol-active")} d={`M ${component.x - 25} ${component.y - 8} H ${component.x + 25} M ${component.x - 16} ${component.y + 3} H ${component.x + 16} M ${component.x - 7} ${component.y + 14} H ${component.x + 7}`} />
  </g>;
}

export default function RCChargeCanvas({ document, result, activeIndex, selectedId, onSelect, onToggleSwitch }: RCChargeCanvasProps) {
  const components = new Map(document.components.map((component) => [component.id, component]));
  const isSolved = result?.success === true;
  const sample = isSolved ? result.solution.samples[Math.min(activeIndex, result.solution.samples.length - 1)] : null;
  const cap = components.get("C1");

  return <div className="rc-canvas-stage" aria-label="RC 充电电路画布">
    <div className="rc-canvas-title"><span>RC 充电 · 瞬态实验</span><small>双击 S1 可切换开关状态</small></div>
    <svg className="rc-circuit-svg" viewBox="0 0 1000 650" role="img" aria-label="理想串联 RC 充电电路">
      <defs>
        <pattern id="rcMinorGrid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" className="svg-grid-minor" fill="none" /></pattern>
        <pattern id="rcMajorGrid" width="125" height="125" patternUnits="userSpaceOnUse"><rect width="125" height="125" fill="url(#rcMinorGrid)" /><path d="M 125 0 L 0 0 0 125" className="svg-grid-major" fill="none" /></pattern>
      </defs>
      <rect width="1000" height="650" fill="url(#rcMajorGrid)" />
      {document.wires.map((wire) => {
        const fromComponent = components.get(wire.from.componentId);
        const toComponent = components.get(wire.to.componentId);
        if (!fromComponent || !toComponent) return null;
        return <path key={wire.id} className={cn("svg-wire", isSolved && "rc-wire-live")} d={route(portPoint(fromComponent, wire.from.port), portPoint(toComponent, wire.to.port))} />;
      })}
      {cap && <path className="svg-wire" d={`M ${cap.x} ${portPoint(cap, "top").y} H 760`} />}
      {cap && <circle className="svg-output-port" cx="760" cy={portPoint(cap, "top").y} r="6" />}
      {cap && <text className="svg-label" x="780" y={portPoint(cap, "top").y + 6}>Vcap</text>}
      {document.components.map((component) => {
        const select = () => onSelect(component.id);
        if (component.kind === "resistor") return <g key={component.id} onClick={select}><Resistor component={component} selected={selectedId === component.id} /></g>;
        if (component.kind === "capacitor") return <g key={component.id} onClick={select}><Capacitor component={component} selected={selectedId === component.id} /></g>;
        if (component.kind === "voltageSource") return <g key={component.id} onClick={select}><VoltageSource component={component} selected={selectedId === component.id} /></g>;
        if (component.kind === "switch") return <g key={component.id} onClick={select}><Switch component={component} selected={selectedId === component.id} onToggle={onToggleSwitch} /></g>;
        return <g key={component.id} onClick={select}><Ground component={component} selected={selectedId === component.id} /></g>;
      })}
      {isSolved && sample && cap && <>
        <g transform={`translate(${cap.x + 57} ${cap.y - 58})`}><rect className="svg-reading-card" width="150" height="64" rx="7" /><circle className="svg-reading-icon" cx="24" cy="25" r="13" /><text className="svg-reading-v" x="19" y="30">V</text><text className="svg-reading-title" x="47" y="22">Vcap</text><text className="svg-reading-value" x="47" y="44">{sample.capacitorVoltage.toFixed(3)} V</text></g>
        <g transform="translate(665 188)"><rect className="svg-current-chip" width="116" height="52" rx="6" /><text className="svg-reading-title" x="16" y="20">I(R1)</text><text className="svg-reading-value" x="16" y="39">{formatCurrent(sample.current)}</text></g>
        <g transform="translate(96 563)"><rect className="svg-solver-chip svg-solver-chip-live" width="151" height="34" rx="5" /><circle cx="18" cy="17" r="5" className="svg-solver-dot svg-solver-dot-live" /><text className="svg-solver-text" x="32" y="22">t = {formatTime(sample.time)}</text></g>
      </>}
    </svg>
  </div>;
}
