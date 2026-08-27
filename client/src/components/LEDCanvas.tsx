/**
 * 精密实验档案：LED 实验画布把工作点、探针与故障位置投影为可点击证据。
 * 琥珀色只表达 LED 发光强度与风险，青蓝表示测量，石灰色保留给有效电流路径。
 */

import type { CircuitDocument } from "@/lib/circuit-model";
import type { LEDFaultMode, LEDSimulationResult } from "@/lib/led-solver";
import { cn } from "@/lib/utils";

interface LEDCanvasProps {
  document: CircuitDocument;
  result: LEDSimulationResult | null;
  fault: LEDFaultMode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function LEDCanvas({ document, result, fault, selectedId, onSelect }: LEDCanvasProps) {
  const get = (id: string) => document.components.find((component) => component.id === id);
  const source = get("V1"); const resistor = get("R1"); const led = get("D1"); const ground = get("GND");
  const solution = result?.success ? result.solution : null;
  if (!source || !resistor || !led || !ground) return <div className="led-canvas-empty">导入的项目不包含 LED 实验所需元件。</div>;
  const brightness = solution?.brightness ?? 0;
  const live = Boolean(solution && fault !== "open");
  const ledColor = fault === "short" ? "#ff7f61" : `hsl(48 100% ${Math.max(30, 42 + brightness * 0.36)}%)`;
  return <section className="led-canvas" aria-label="LED 串联实验电路">
    <div className="led-canvas-caption"><span>LED 工作点 · 非线性近似</span><small>点选元件查看证据</small></div>
    <svg viewBox="0 0 1000 560" className="led-circuit-svg" role="img" aria-label="5V LED 限流电路">
      <defs><pattern id="led-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 H 0 V 40" className="svg-grid-minor" fill="none" /></pattern><filter id="led-glow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <rect width="1000" height="560" fill="url(#led-grid)" />
      <g className={cn("led-wire-group", live && "is-live", fault === "open" && "is-open")}><path className="svg-wire" d="M 230 278 V 110 H 540 V 170" /><path className="svg-wire" d="M 540 290 V 350" /><path className="svg-wire" d="M 540 450 V 500" /><path className="svg-wire" d="M 540 500 H 230 V 342" /></g>
      <g className="led-selectable" onClick={() => onSelect("V1")}>{selectedId === "V1" && <circle className="svg-selected-ring" cx="230" cy="310" r="46"/>}<circle className="svg-symbol-fill" cx="230" cy="310" r="32"/><path className="svg-symbol" d="M223 300h14m-7-7v14m-7 23h14"/><text className="svg-label" x="278" y="302">V1</text><text className="svg-value" x="278" y="324">{source.value ?? 5} V</text></g>
      <g className="led-selectable" onClick={() => onSelect("R1")}>{selectedId === "R1" && <rect className="svg-selected-box" x="507" y="171" width="66" height="116" rx="6"/>}<polyline className="svg-symbol" points="540,170 540,186 526,199 554,212 526,225 554,238 526,251 554,264 540,278 540,290"/><text className="svg-label" x="584" y="218">R1</text><text className="svg-value" x="584" y="240">{resistor.value ?? 330} Ω</text></g>
      <g className="led-selectable" onClick={() => onSelect("D1")}>{selectedId === "D1" && <rect className="svg-selected-box led-selection" x="489" y="343" width="102" height="114" rx="6"/>}<circle cx="540" cy="400" r={34 + brightness * 0.17} fill={ledColor} opacity={brightness ? 0.11 + brightness / 800 : 0} filter="url(#led-glow)"/><path d="M 512 382 L 568 400 L 512 418 Z" fill="none" stroke={ledColor} strokeWidth="2.5"/><path d="M 569 375 V 425" stroke={ledColor} strokeWidth="2.5"/><path d="M 550 370 l12 -14 m-2 3 l8 1" stroke={ledColor} strokeWidth="2" fill="none"/><path d="M 565 381 l12 -14 m-2 3 l8 1" stroke={ledColor} strokeWidth="2" fill="none"/><text className="svg-label" x="604" y="392">D1</text><text className="svg-value" x="604" y="414">LED {solution ? `${solution.ledVoltage.toFixed(2)} V` : "—"}</text></g>
      <g className="led-selectable" onClick={() => onSelect("GND")}><path className="svg-symbol" d="M540 500v12m-25 0h50m-40 11h30m-20 11h10"/><text className="svg-muted-label" x="579" y="525">GND · 0 V</text></g>
      <g className="led-selectable probe-group" onClick={() => onSelect("P1")}><circle className="probe-ring" cx="721" cy="400" r="24"/><text className="probe-letter" x="714" y="405">V</text><path className="probe-lead" d="M697 400 H 580"/><text className="svg-reading-title" x="754" y="391">探针 P1</text><text className="svg-reading-value" x="754" y="414">{solution ? `${solution.ledVoltage.toFixed(3)} V` : "—"}</text></g>
      {fault === "open" && <g transform="translate(530 316)"><circle className="fault-ring" cx="10" cy="0" r="21"/><path d="M2 -8 L18 8 M18 -8 L2 8" className="fault-cross"/><rect className="fault-label" x="42" y="-17" width="108" height="34" rx="5"/><text className="fault-label-text" x="52" y="5">注入开路故障</text></g>}
      {fault === "short" && <g transform="translate(468 395)"><path className="fault-short" d="M0 0 H142"/><text className="fault-label-text" x="1" y="-17">LED 被旁路</text></g>}
      {fault === "wrongResistor" && <g transform="translate(588 262)"><rect className="fault-label" width="102" height="31" rx="5"/><text className="fault-label-text" x="11" y="20">错误 68 Ω</text></g>}
    </svg>
  </section>;
}
