/**
 * 精密实验档案：LED 实验室让学习者在“电路—读数—证据—挑战”同一工作台中理解非线性近似。
 * 本页明确标注常压降教学模型，不将可视化亮度或安全提示伪装为真实器件的工程认证。
 */

import LEDCanvas from "@/components/LEDCanvas";
import { type CircuitDocument, createLEDDebugDocument, storageKey } from "@/lib/circuit-model";
import { serializeCircuit, serializeLEDSnapshot } from "@/lib/experiment-export";
import { type LEDFaultMode, type LEDSimulationResult, solveLEDSeries } from "@/lib/led-solver";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, CircuitBoard, Download, FileJson, Gauge, Lightbulb, Play, RotateCcw, ShieldCheck, Upload, Zap } from "lucide-react";
import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const labStorageKey = `${storageKey}:led-lab`;
const progressStorageKey = "circuit-simulator:learning-progress";

function readCircuit(): CircuitDocument {
  if (typeof window === "undefined") return createLEDDebugDocument();
  try { return JSON.parse(window.localStorage.getItem(labStorageKey) ?? "") as CircuitDocument; } catch { return createLEDDebugDocument(); }
}
function download(filename: string, content: string, type: string) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
function ma(value: number) { return `${(value * 1000).toFixed(2)} mA`; }
function mw(value: number) { return `${(value * 1000).toFixed(2)} mW`; }

export default function LEDLab() {
  const [circuit, setCircuit] = useState<CircuitDocument>(readCircuit);
  const [fault, setFault] = useState<LEDFaultMode>("none");
  const [result, setResult] = useState<LEDSimulationResult | null>(() => solveLEDSeries(readCircuit()));
  const [selectedId, setSelectedId] = useState<string | null>("D1");
  const [challengeDone, setChallengeDone] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(progressStorageKey) === "led-target-complete");
  const importRef = useRef<HTMLInputElement>(null);
  const solution = result?.success ? result.solution : null;

  useEffect(() => { window.localStorage.setItem(labStorageKey, JSON.stringify(circuit)); }, [circuit]);
  const run = () => { const next = solveLEDSeries(circuit, fault); setResult(next); if (next.success) toast.success("LED 工作点已更新。 "); else toast.error(next.diagnostics[0]); };
  const inject = (nextFault: LEDFaultMode) => { setFault(nextFault); setResult(solveLEDSeries(circuit, nextFault)); toast.message(nextFault === "none" ? "已清除故障并恢复正常工作点。" : "故障已注入；请阅读画布和证据面板。 "); };
  const completeChallenge = () => { if (!solution?.targetMet) { toast.error("目标是让 LED 电流保持在 8–12 mA 的安全范围内。 "); return; } window.localStorage.setItem(progressStorageKey, "led-target-complete"); setChallengeDone(true); toast.success("挑战完成：你已建立合格的 LED 限流工作点。 "); };
  const reset = () => { const initial = createLEDDebugDocument(); setCircuit(initial); setFault("none"); setResult(solveLEDSeries(initial)); setSelectedId("D1"); toast.message("已恢复 LED 亮度实验默认电路。 "); };
  const exportSnapshot = () => { if (!solution) { toast.error("先运行有效工作点，再导出测量快照。 "); return; } download("led-operating-point.csv", serializeLEDSnapshot(solution), "text/csv;charset=utf-8"); };
  const importProject = async (file: File) => { try { const candidate = JSON.parse(await file.text()) as CircuitDocument; if (!candidate.components?.some((component) => component.kind === "led")) throw new Error(); setCircuit(candidate); setFault("none"); setResult(solveLEDSeries(candidate)); toast.success("已导入 LED 实验项目。 "); } catch { toast.error("该文件不是有效的 LED 实验项目 JSON。 "); } };
  const evidence = result?.success ? result.diagnostics[0] : result?.diagnostics[0] ?? "运行仿真后显示 LED 工作点。";

  return <main className="led-lab-shell">
    <header className="led-topbar"><div className="wordmark"><span>FLUX</span><strong>LAB</strong></div><div className="led-breadcrumb"><span>项目</span><i>/</i><b>LED 亮度实验</b><i>/</i><span>非线性 DC</span></div><div className="lab-mode-chip"><Zap size={14}/> 常压降近似</div><div className="led-top-actions"><Link href="/engineering" className="compact-nav-link">工程工作台</Link><Link href="/" className="compact-nav-link">RC 实验</Link><Link href="/divider" className="compact-nav-link">分压器</Link><button className="led-run" onClick={run}><Play size={16} fill="currentColor"/>运行工作点</button></div></header>
    <section className="led-layout"><aside className="led-brief"><div className="brief-kicker">引导实验 · 02 / 04</div><h1>调亮 LED</h1><p>使用限流电阻让 D1 的连续电流稳定在 <b>8–12 mA</b>，再观察故障如何改变证据链。</p><div className="challenge-meter"><span>学习进度</span><b>{challengeDone ? "已完成" : "进行中"}</b><i><em style={{ width: challengeDone ? "100%" : "50%" }} /></i></div><button className={cn("challenge-button", challengeDone && "is-complete")} onClick={completeChallenge}>{challengeDone ? <CheckCircle2 size={17}/> : <Lightbulb size={17}/>} {challengeDone ? "挑战已完成" : "检查目标区间"}</button><div className="fault-section"><div><span>故障注入</span><small>基于教学近似</small></div>{(["open", "short", "wrongResistor"] as LEDFaultMode[]).map((entry) => <button key={entry} className={cn("fault-button", fault === entry && "is-active")} onClick={() => inject(entry)}>{entry === "open" ? "开路" : entry === "short" ? "短路" : "错误阻值"}</button>)}<button className="clear-fault" onClick={() => inject("none")}>清除故障</button></div></aside>
      <section className="led-center"><div className="led-toolbar"><div><CircuitBoard size={16}/><span>串联 LED 工作点</span></div><span className={cn("solver-status", solution?.isSafe ? "is-stable" : "is-risk")}>{solution?.isSafe ? <ShieldCheck size={15}/> : <AlertTriangle size={15}/>} {solution?.isSafe ? "工作点稳定" : "需要检查"}</span><button onClick={reset}><RotateCcw size={15}/>恢复实验</button></div><LEDCanvas document={circuit} result={result} fault={fault} selectedId={selectedId} onSelect={setSelectedId}/><section className="led-measurements"><div className="measurement-heading"><Gauge size={16}/><span>双通道测量</span><small>DC 工作点</small></div><div className="measurement-rail"><div className="channel channel-voltage"><span>CH A · V(D1)</span><b>{solution ? `${solution.ledVoltage.toFixed(3)} V` : "—"}</b><i style={{ width: `${solution ? Math.min(100, solution.ledVoltage / 3 * 100) : 0}%` }} /></div><div className="channel channel-current"><span>CH B · I(R1)</span><b>{solution ? ma(solution.current) : "—"}</b><i style={{ width: `${solution ? Math.min(100, solution.current * 1000 / 20 * 100) : 0}%` }} /></div><div className="channel channel-brightness"><span>发光估计</span><b>{solution ? `${solution.brightness.toFixed(0)} %` : "—"}</b><i style={{ width: `${solution?.brightness ?? 0}%` }} /></div></div></section></section>
      <aside className="led-inspector"><div className="led-inspector-title">证据检查器</div><div className="selected-chip">{selectedId ?? "未选择"} / {selectedId === "D1" ? "LED" : selectedId === "R1" ? "限流电阻" : selectedId === "P1" ? "电压探针" : "电路元件"}</div><section className="evidence-focus"><span>当前证据</span><p>{evidence}</p></section><section className="reading-grid"><div><span>LED 压降</span><b>{solution ? `${solution.ledVoltage.toFixed(3)} V` : "—"}</b></div><div><span>支路电流</span><b>{solution ? ma(solution.current) : "—"}</b></div><div><span>R1 功耗</span><b>{solution ? mw(solution.resistorPower) : "—"}</b></div><div><span>LED 功耗</span><b>{solution ? mw(solution.ledPower) : "—"}</b></div></section><section className="operating-area"><div><span>推荐连续区间</span><b>8–12 mA</b></div><div className="operating-line"><i /><i /><i className={cn(solution?.targetMet && "is-target")} /></div><p>{solution?.targetMet ? "当前设置达到本实验目标区间。" : "在学习模型中，这一区间兼顾清晰亮度与限流余量。"}</p></section><section className="led-export"><button onClick={exportSnapshot}><Download size={16}/>导出读数 CSV</button><button onClick={() => download("led-experiment.json", serializeCircuit(circuit), "application/json;charset=utf-8")}><FileJson size={16}/>导出项目</button><button onClick={() => importRef.current?.click()}><Upload size={16}/>导入项目</button><input ref={importRef} type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProject(file); event.currentTarget.value = ""; }} /></section><div className="model-disclaimer">教学近似模型：LED 用固定正向压降描述，实际器件必须查阅数据手册并进行硬件验证。</div></aside></section>
  </main>;
}
