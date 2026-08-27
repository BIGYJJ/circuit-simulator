/**
 * 精密实验档案：深色网格是搭建层，白色符号是电路事实，黄绿色只表示选择、运行与活动路径。
 * 画布只绘制模型和仿真快照；属性输入与求解逻辑保留在独立模块中。
 */

import type { CircuitComponent, CircuitDocument, CircuitPortName } from "@/lib/circuit-model";
import type { SimulationResult } from "@/lib/circuit-solver";
import { cn } from "@/lib/utils";

interface CircuitCanvasProps {
  document: CircuitDocument;
  selectedId: string | null;
  simulation: SimulationResult | null;
  zoom: number;
  onSelect: (componentId: string) => void;
}

type Point = { x: number; y: number };

function portPoint(component: CircuitComponent, port: CircuitPortName): Point {
  if (component.kind === "ground") return { x: component.x, y: component.y - 34 };
  const offset = component.kind === "voltageSource" ? 66 : 60;
  return { x: component.x, y: component.y + (port === "top" ? -offset : offset) };
}

function formatResistance(value?: number) {
  if (value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 1 : 2)} kΩ` : `${value} Ω`;
}

function componentLabel(component: CircuitComponent) {
  const title = component.kind === "voltageSource" ? `${component.value ?? 0}V` : formatResistance(component.value);
  return `${component.label}  ${title}`;
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

export default function CircuitCanvas({ document, selectedId, simulation, zoom, onSelect }: CircuitCanvasProps) {
  const componentById = new Map(document.components.map((component) => [component.id, component]));
  const isLive = simulation?.success === true;
  const outputResistorId = isLive ? simulation.solution.rLow.id : null;
  const outputResistor = outputResistorId ? componentById.get(outputResistorId) : undefined;
  const outputNode = outputResistor ? portPoint(outputResistor, "top") : null;

  return (
    <div className="canvas-stage" aria-label="分压电路画布">
      <div className="canvas-ruler canvas-ruler-x"><span>0</span><span>200</span><span>400</span><span>600</span><span>800</span></div>
      <div className="canvas-ruler canvas-ruler-y"><span>0</span><span>160</span><span>320</span><span>480</span></div>
      <div className="canvas-scroll-area">
        <svg
          className="circuit-svg"
          viewBox="0 0 1000 650"
          preserveAspectRatio="xMidYMid meet"
          style={{ transform: `scale(${zoom / 100})` }}
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
          <rect width="1000" height="650" fill="url(#majorGrid)" />
          <g className={isLive ? "wire-group wire-live" : "wire-group"}>
            {document.wires.map((wire) => {
              const fromComponent = componentById.get(wire.from.componentId);
              const toComponent = componentById.get(wire.to.componentId);
              if (!fromComponent || !toComponent) return null;
              const from = portPoint(fromComponent, wire.from.port);
              const to = portPoint(toComponent, wire.to.port);
              const middle = Math.round((from.x + to.x) / 2);
              return <path key={wire.id} d={`M ${from.x} ${from.y} H ${middle} V ${to.y} H ${to.x}`} className="svg-wire" />;
            })}
          </g>

          {outputNode && (
            <g className="output-branch">
              <path d={`M ${outputNode.x} ${outputNode.y} H 700`} className="svg-wire" />
              <circle className="svg-output-port" cx="700" cy={outputNode.y} r="6" />
              <text className="svg-label" x="720" y={outputNode.y + 6}>Vout</text>
            </g>
          )}

          {document.components.map((component) => {
            const active = component.id === selectedId;
            const handleKeyDown = (event: React.KeyboardEvent<SVGGElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(component.id);
              }
            };
            return (
              <g
                key={component.id}
                className="circuit-component"
                role="button"
                tabIndex={0}
                aria-label={`选择 ${componentLabel(component)}`}
                onClick={() => onSelect(component.id)}
                onKeyDown={handleKeyDown}
              >
                {component.kind === "resistor" && <ResistorSymbol component={component} active={active} />}
                {component.kind === "voltageSource" && <VoltageSourceSymbol component={component} active={active} />}
                {component.kind === "ground" && <GroundSymbol component={component} active={active} />}
                {component.kind !== "ground" && (
                  <>
                    <circle className={cn("svg-terminal", active && "svg-terminal-active")} cx={portPoint(component, "top").x} cy={portPoint(component, "top").y} r="5" />
                    <circle className={cn("svg-terminal", active && "svg-terminal-active")} cx={portPoint(component, "bottom").x} cy={portPoint(component, "bottom").y} r="5" />
                  </>
                )}
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
