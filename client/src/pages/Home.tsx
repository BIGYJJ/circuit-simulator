/**
 * 精密实验档案：默认入口是可编辑、可解释的 RC 瞬态工作台。
 * 所有画布编辑经版本化命令提交；时间游标、示波器、诊断与导出读取同一求解快照。
 */

import Oscilloscope from "@/components/Oscilloscope";
import RCChargeCanvas from "@/components/RCChargeCanvas";
import {
  type CircuitDocument,
  type ComponentKind,
  type RCSwitchMode,
  type WireEndpoint,
  cloneDocument,
  componentKinds,
  createRCChargeDocument,
  findOpenEndpoints,
  storageKey,
  updateDocument,
} from "@/lib/circuit-model";
import { serializeCircuit, serializeRCTrace } from "@/lib/experiment-export";
import { type RCChargeResult, solveRCCharge } from "@/lib/rc-charge-solver";
import { createTimeMilestones } from "@/lib/time-microscope";
import { cn } from "@/lib/utils";
import {
  Activity,
  BookOpen,
  ChevronDown,
  CircuitBoard,
  Download,
  FileJson,
  Grid3X3,
  Info,
  Minus,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Settings2,
  SkipForward,
  StepForward,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type RunState = "idle" | "running" | "paused" | "complete" | "error";
const rcStorageKey = `${storageKey}:rc-charge`;

function getInitialCircuit(): CircuitDocument {
  if (typeof window === "undefined") return createRCChargeDocument();
  try {
    const stored = window.localStorage.getItem(rcStorageKey);
    return stored ? (JSON.parse(stored) as CircuitDocument) : createRCChargeDocument();
  } catch {
    return createRCChargeDocument();
  }
}

function formatTime(time: number) { return time < 1 ? `${(time * 1000).toFixed(0)} ms` : `${time.toFixed(2)} s`; }
function formatCapacitance(value?: number) { return value ? `${(value * 1e6).toFixed(1)} μF` : "—"; }
function formatEnergy(value: number) { return value < 0.001 ? `${(value * 1000).toFixed(3)} mJ` : `${value.toFixed(4)} J`; }
function modeLabel(mode: RCSwitchMode) { return mode === "charge" ? "充电" : mode === "discharge" ? "放电" : "保持"; }

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [circuit, setCircuit] = useState(getInitialCircuit);
  const [result, setResult] = useState<RCChargeResult | null>(() => solveRCCharge(getInitialCircuit()));
  const [selectedId, setSelectedId] = useState<string | null>("C1");
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [history, setHistory] = useState<CircuitDocument[]>([]);
  const [future, setFuture] = useState<CircuitDocument[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [runState, setRunState] = useState<RunState>("idle");
  const [draftValue, setDraftValue] = useState("100");
  const [zoom, setZoom] = useState(100);
  const [saveLabel, setSaveLabel] = useState("本地已保存");

  const selected = useMemo(() => circuit.components.find((component) => component.id === selectedId) ?? circuit.components[0], [circuit.components, selectedId]);
  const solution = result?.success ? result.solution : null;
  const samples = solution?.samples ?? [];
  const sample = samples[Math.min(activeIndex, Math.max(samples.length - 1, 0))];
  const openEndpoints = useMemo(() => findOpenEndpoints(circuit), [circuit]);
  const milestones = useMemo(() => solution ? createTimeMilestones(solution) : [], [solution]);
  const canContinue = Boolean(solution && activeIndex < samples.length - 1);
  const mode = solution?.mode ?? circuit.components.find((component) => component.id === "S1")?.switchMode ?? "charge";
  const activePower = sample && solution ? sample.current * sample.current * solution.resistor.value! : 0;
  const safetyMargin = Math.max(0, 1 - activePower / 0.25);

  useEffect(() => { window.localStorage.setItem(rcStorageKey, JSON.stringify(circuit)); setSaveLabel("本地已保存"); }, [circuit]);
  useEffect(() => { if (selected?.value !== undefined) setDraftValue(selected.kind === "capacitor" ? String(selected.value * 1e6) : String(selected.value)); }, [selected]);
  useEffect(() => {
    if (runState !== "running" || !solution) return;
    const timer = window.setInterval(() => setActiveIndex((current) => {
      const next = Math.min(current + 4, samples.length - 1);
      if (next === samples.length - 1) setRunState("complete");
      return next;
    }), 28);
    return () => window.clearInterval(timer);
  }, [runState, solution, samples.length]);

  const setWorkingCircuit = (next: CircuitDocument) => { setCircuit(next); setResult(null); setActiveIndex(0); setRunState("idle"); };
  const commitCircuit = (next: CircuitDocument) => { setHistory((past) => [...past.slice(-19), cloneDocument(circuit)]); setFuture([]); setSelectedWireId(null); setWorkingCircuit(next); };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((next) => [cloneDocument(circuit), ...next].slice(0, 20)); setHistory((past) => past.slice(0, -1)); setSelectedWireId(null); setWorkingCircuit(previous); };
  const redo = () => { const next = future.at(0); if (!next) return; setHistory((past) => [...past.slice(-19), cloneDocument(circuit)]); setFuture((pending) => pending.slice(1)); setSelectedWireId(null); setWorkingCircuit(next); };

  const runExperiment = () => {
    setSaveLabel("正在计算瞬态曲线");
    const next = solveRCCharge(circuit);
    setResult(next); setActiveIndex(0);
    if (next.success) { setRunState("running"); toast.success(`已生成 ${next.solution.samples.length} 个 ${modeLabel(next.solution.mode)}时间点。`); }
    else { setRunState("error"); toast.error(next.diagnostics[0]); }
  };
  const togglePlay = () => { if (!solution) { runExperiment(); return; } if (!canContinue) { setActiveIndex(0); setRunState("running"); return; } setRunState((state) => state === "running" ? "paused" : "running"); };
  const step = () => { if (!solution) { runExperiment(); return; } setRunState("paused"); setActiveIndex((index) => Math.min(index + 1, samples.length - 1)); };
  const resetTime = () => { setActiveIndex(0); setRunState("idle"); };
  const scrubTo = (time: number) => { if (!solution) return; setRunState("paused"); setActiveIndex(Math.round((time / solution.duration) * (samples.length - 1))); };

  const setMode = (nextMode: RCSwitchMode) => {
    const retainedVoltage = sample?.capacitorVoltage ?? circuit.components.find((component) => component.id === "C1")?.initialValue ?? 0;
    commitCircuit(updateDocument(circuit, { components: circuit.components.map((component) => {
      if (component.id === "S1") return { ...component, switchMode: nextMode, closed: nextMode !== "hold" };
      if (component.id === "C1") return { ...component, initialValue: retainedVoltage };
      return component;
    }) }));
    toast.message(`已切换至 ${modeLabel(nextMode)}模式。运行实验可生成新的瞬态轨迹。`);
  };
  const applyValue = () => {
    if (!selected || selected.value === undefined) return;
    const rawValue = Number(draftValue);
    if (!Number.isFinite(rawValue) || rawValue <= 0) { toast.error("请输入大于 0 的有效参数。"); return; }
    const nextValue = selected.kind === "capacitor" ? rawValue / 1e6 : rawValue;
    commitCircuit(updateDocument(circuit, { components: circuit.components.map((component) => component.id === selected.id ? { ...component, value: nextValue } : component) }));
    toast.success(`${selected.label} 参数已更新；运行实验以生成新曲线。`);
  };
  const moveComponent = (componentId: string, x: number, y: number) => commitCircuit(updateDocument(circuit, { components: circuit.components.map((component) => component.id === componentId ? { ...component, x, y } : component) }));
  const dropComponent = (kind: ComponentKind, x: number, y: number) => {
    const existing = circuit.components.filter((component) => component.kind === kind).length;
    const id = kind === "ground" ? `GND${existing + 1}` : `${componentKinds[kind].defaultLabel}${existing + 1}`;
    const newComponent = { id, kind, label: id, x, y, value: componentKinds[kind].defaultValue, ...(kind === "switch" ? { closed: true, switchMode: "charge" as RCSwitchMode } : {}), ...(kind === "capacitor" ? { initialValue: 0 } : {}) };
    commitCircuit(updateDocument(circuit, { components: [...circuit.components, newComponent] }));
    setSelectedId(id); toast.message(`已在画布放置 ${componentKinds[kind].title}。`);
  };
  const createWire = (from: WireEndpoint, to: WireEndpoint) => {
    if (from.componentId === to.componentId && from.port === to.port) return;
    const duplicate = circuit.wires.some((wire) => (wire.from.componentId === from.componentId && wire.from.port === from.port && wire.to.componentId === to.componentId && wire.to.port === to.port) || (wire.to.componentId === from.componentId && wire.to.port === from.port && wire.from.componentId === to.componentId && wire.from.port === to.port));
    if (duplicate) { toast.message("这两个端口已经连接。 "); return; }
    const id = `w-${Date.now().toString(36)}`;
    commitCircuit(updateDocument(circuit, { wires: [...circuit.wires, { id, from, to }] }));
  };
  const deleteWire = (wireId: string) => { commitCircuit(updateDocument(circuit, { wires: circuit.wires.filter((wire) => wire.id !== wireId) })); toast.message("已删除选中的导线。 "); };
  const resetCircuit = () => { const initial = createRCChargeDocument(); setCircuit(initial); setResult(solveRCCharge(initial)); setSelectedId("C1"); setSelectedWireId(null); setHistory([]); setFuture([]); setActiveIndex(0); setRunState("idle"); toast.message("已恢复默认 RC 充电实验。 "); };
  const exportTrace = () => { if (!solution) { toast.error("先运行实验，再导出真实瞬态数据。 "); return; } downloadText(`rc-${solution.mode}-trace.csv`, serializeRCTrace(solution), "text/csv;charset=utf-8"); toast.success("已导出 RC 时间序列 CSV。 "); };
  const exportProject = () => { downloadText("rc-experiment.json", serializeCircuit(circuit), "application/json;charset=utf-8"); toast.success("已导出电路项目 JSON。 "); };
  const onPaletteDrag = (event: React.DragEvent<HTMLButtonElement>, kind: ComponentKind) => { event.dataTransfer.setData("application/x-circuit-kind", kind); event.dataTransfer.effectAllowed = "copy"; };

  const selectedKindName = selected?.kind === "capacitor" ? "电容 · 瞬态" : selected?.kind === "resistor" ? "电阻" : selected?.kind === "switch" ? "三态开关" : selected?.kind === "voltageSource" ? "直流电压源" : "参考地";
  const fieldLabel = selected?.kind === "capacitor" ? "电容" : selected?.kind === "resistor" ? "阻值" : "源电压";
  const unit = selected?.kind === "capacitor" ? "μF" : selected?.kind === "resistor" ? "Ω" : "V";
  const stepSize = selected?.kind === "capacitor" ? 10 : selected?.kind === "resistor" ? 1000 : 1;

  return <main className="lab-shell rc-lab-shell">
    <header className="lab-topbar"><div className="wordmark"><span>FLUX</span><strong>LAB</strong></div><div className="project-path"><span>项目</span><i>/</i><span>RC {modeLabel(mode)}</span><i>/</i><b>实验 02</b></div><div className="save-status"><span className="status-dot"><span /></span>{saveLabel}</div><div className="top-actions"><Link href="/led" className="compact-nav-link">LED 实验</Link><Link href="/divider" className="compact-nav-link">分压器</Link><button className="icon-button" onClick={undo} disabled={!history.length} aria-label="撤销"><Undo2 size={19} /></button><button className="icon-button" onClick={redo} disabled={!future.length} aria-label="重做"><Redo2 size={19} /></button><span className="top-divider" /><button className="icon-button is-active" aria-label="网格视图"><Grid3X3 size={20} /></button><div className="zoom-control"><button onClick={() => setZoom((value) => Math.max(75, value - 25))}><Minus size={17} /></button><span>{zoom}%</span><button onClick={() => setZoom((value) => Math.min(125, value + 25))}><Plus size={17} /></button></div><button className={cn("run-button", runState === "running" && "is-solving")} onClick={runExperiment}><Play size={17} fill="currentColor" />{runState === "running" ? "仿真运行中" : "运行仿真"}</button></div></header>
    <section className="workbench"><aside className="nav-rail"><button className="rail-button is-selected"><CircuitBoard size={23} /></button><button className="rail-button" onClick={() => toast.message("当前已在瞬态实验模式。 ")}><Activity size={22} /></button><button className="rail-button" onClick={() => toast.message("数字逻辑工作台将在后续阶段开放。 ")}><span className="rail-code">&lt;/&gt;</span></button><button className="rail-button" onClick={() => toast.message("尝试切换充电、保持、放电并比较 1τ 时的曲线和能量。 ")}><BookOpen size={22} /></button><span className="rail-spacer" /><button className="rail-button" onClick={() => toast.message("设置面板正在规划中。 ")}><Settings2 size={22} /></button></aside>
      <aside className="component-library rc-library"><div className="search-box"><Search size={18} /><input placeholder="拖拽元件到画布…" aria-label="元件库" readOnly /><button aria-label="清除搜索"><X size={16} /></button></div><div className="library-scroll"><section className="palette-group"><div className="palette-title"><span>无源元件</span><ChevronDown size={15} /></div>{(["resistor", "capacitor"] as ComponentKind[]).map((kind) => <button key={kind} draggable className={cn("component-card", selected?.kind === kind && "is-current")} onDragStart={(event) => onPaletteDrag(event, kind)} onClick={() => setSelectedId(circuit.components.find((component) => component.kind === kind)?.id ?? null)}><span className={cn("symbol-preview", kind === "resistor" ? "rc-resistor-icon" : "capacitor-icon")}>{kind === "resistor" ? "⌁" : "║"}</span><span>{componentKinds[kind].title}</span></button>)}</section><section className="palette-group"><div className="palette-title"><span>电源与控制</span><ChevronDown size={15} /></div>{(["voltageSource", "switch", "ground"] as ComponentKind[]).map((kind) => <button key={kind} draggable className={cn("component-card", selected?.kind === kind && "is-current")} onDragStart={(event) => onPaletteDrag(event, kind)} onClick={() => setSelectedId(circuit.components.find((component) => component.kind === kind)?.id ?? null)}><span className={cn("symbol-preview", kind === "voltageSource" ? "source-preview" : kind === "switch" ? "switch-icon" : "ground-preview")}>{kind === "voltageSource" ? "⊕" : kind === "switch" ? "⌁" : "⏚"}</span><span>{componentKinds[kind].title}</span></button>)}</section><section className="palette-group"><div className="palette-title"><span>仪器</span><ChevronDown size={15} /></div><button className="instrument-card is-current" onClick={() => toast.message("示波器绘制当前求解器返回的真实时间样本。 ")}><span className="scope-preview"><i /><i /><i /></span><span>示波器</span></button></section></div><div className="library-tip"><Info size={15} /><span>{openEndpoints.length ? `${openEndpoints.length} 个端口未连接；可继续编辑。` : "拖动元件；由端口拖向端口以连接。"}</span></div></aside>
      <section className="center-stage rc-center-stage"><div className="canvas-toolbar"><div><span className="toolbar-eyebrow">活动实验</span><strong>瞬态 TR · RC {modeLabel(mode)}</strong></div><div className="canvas-toolbar-actions"><span className={cn(openEndpoints.length && "is-incomplete")}><Zap size={14} />{openEndpoints.length ? `${openEndpoints.length} 个端口未连接` : solution ? "求解器稳定" : "参数已修改 · 待运行"}</span><button onClick={resetCircuit}><RotateCcw size={14} />恢复实验</button></div></div><div className="rc-zoom-shell" style={{ transform: `scale(${zoom / 100})` }}><RCChargeCanvas document={circuit} result={result} activeIndex={activeIndex} selectedId={selectedId} selectedWireId={selectedWireId} onSelect={setSelectedId} onSelectWire={setSelectedWireId} onToggleSwitch={() => setMode(mode === "charge" ? "hold" : mode === "hold" ? "discharge" : "charge")} onMoveComponent={moveComponent} onDropComponent={dropComponent} onCreateWire={createWire} onDeleteWire={deleteWire} /></div><section className="rc-control-strip"><button className={cn("time-control primary", runState === "running" && "is-live")} onClick={togglePlay}>{runState === "running" ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}{runState === "running" ? "暂停" : canContinue ? "继续" : "播放"}</button><button className="time-control" onClick={step}><StepForward size={17} />单步</button><button className="time-control" onClick={resetTime}><SkipForward size={17} className="flip-icon" />复位时间</button><div className="time-readout"><span>当前时刻</span><b>{sample ? formatTime(sample.time) : "0 ms"}</b><small>{solution ? `/ ${formatTime(solution.duration)}` : "/ 5.00 s"}</small></div><div className="time-progress"><i style={{ width: `${solution ? (activeIndex / Math.max(samples.length - 1, 1)) * 100 : 0}%` }} /></div><button className="icon-export" onClick={exportTrace} aria-label="导出 CSV"><Download size={16} /></button><button className="icon-export" onClick={exportProject} aria-label="导出 JSON"><FileJson size={16} /></button></section><Oscilloscope result={result} activeIndex={activeIndex} /><section className="time-microscope"><div className="microscope-heading"><span>时间显微镜</span><small>点击节点跳转并暂停</small></div>{milestones.map((milestone) => <button key={milestone.id} className={cn("milestone-card", sample && Math.abs(sample.time - milestone.time) <= (solution?.timeConstant ?? 0) * 0.13 && "is-active")} onClick={() => scrubTo(milestone.time)}><b>{formatTime(milestone.time)}</b><strong>{milestone.title}</strong><span>{milestone.description}</span></button>)}</section></section>
      <aside className="inspector-panel rc-inspector"><div className="inspector-title"><span>{selected?.label ?? "—"}</span><i>/</i><b>{selectedKindName}</b></div><div className="inspector-content">{selected?.kind === "switch" ? <div className="switch-inspector"><span className={cn("switch-state-icon", mode !== "hold" && "is-closed")}><i /></span><strong>{modeLabel(mode)}回路</strong><p>{mode === "charge" ? "源电压经电阻向电容储能。" : mode === "discharge" ? "电容经电阻向参考地释放已储存的能量。" : "理想模型中，电容电压保持在当前初始值。"}</p><div className="mode-selector">{(["charge", "hold", "discharge"] as RCSwitchMode[]).map((choice) => <button key={choice} className={cn(mode === choice && "is-active")} onClick={() => setMode(choice)}>{modeLabel(choice)}</button>)}</div></div> : selected?.kind === "ground" ? <div className="ground-inspector"><span className="ground-large">⏚</span><strong>参考地</strong><p>GND 设为 0 V，Vcap 以它作为测量基准。</p></div> : <><label className="field-label" htmlFor="rc-value">{fieldLabel}</label><div className="value-stepper"><input id="rc-value" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} inputMode="decimal" /><span>{unit}</span><div><button onClick={() => setDraftValue(String((Number(draftValue) || 0) + stepSize))}><Plus size={15} /></button><button onClick={() => setDraftValue(String(Math.max(1, (Number(draftValue) || 0) - stepSize)))}><Minus size={15} /></button></div></div>{selected?.kind === "capacitor" && <div className="parameter-note"><span>初始电压</span><b>{(selected.initialValue ?? 0).toFixed(3)} V</b><span>当前容量</span><b>{formatCapacitance(selected.value)}</b></div>}{selected?.kind === "resistor" && <div className="parameter-note"><span>额定功耗</span><b>0.25 W</b><span>容差</span><b>5 %</b></div>}<button className="apply-button" onClick={applyValue}>应用参数</button></>}<div className="rc-formula-card"><span>理想 RC {modeLabel(mode)}</span><strong>{mode === "charge" ? "Vcap(t) = Vs · (1 − e⁻ᵗ⁄ᴿᶜ)" : mode === "discharge" ? "Vcap(t) = V₀ · e⁻ᵗ⁄ᴿᶜ" : "Vcap(t) = V₀"}</strong><div><b>τ = R × C</b><em>{solution ? `${solution.timeConstant.toFixed(3)} s` : "待计算"}</em></div></div><div className="evidence-card"><div className="evidence-header"><Activity size={16} /><span>当前观测</span></div>{sample && solution ? <><div className="evidence-line"><span>Vcap</span><b className="cyan-text">{sample.capacitorVoltage.toFixed(3)} V</b></div><div className="evidence-line"><span>I(R1)</span><b>{(sample.current * 1000).toFixed(3)} mA</b></div><div className="evidence-line"><span>电容能量</span><b>{formatEnergy(sample.capacitorEnergy)}</b></div><div className="evidence-line"><span>R1 功耗</span><b>{(activePower * 1000).toFixed(3)} mW</b></div><div className="safety-meter"><span>额定功耗裕量</span><b>{(safetyMargin * 100).toFixed(1)} %</b><i><em style={{ width: `${safetyMargin * 100}%` }} /></i></div></> : <p>运行仿真后，此处显示当前样本、能量和功耗证据。</p>}</div><div className="learning-card"><span>{mode === "discharge" ? "为什么能量会消失？" : "为什么 Vcap 上升变慢？"}</span><strong>{mode === "discharge" ? "电容储存的能量以电阻发热形式耗散，电压与电流都指数衰减。" : "电容电压升高会减小电阻两端压差，因此支路电流随时间衰减。"}</strong><button onClick={() => toast.message("在 t = τ 时，充电达到约 63.2% 的总变化；放电仅剩约 36.8% 的初始电压。")}>查看 1τ 推导 <span>→</span></button></div></div></aside></section>
    <footer className="lab-statusbar"><span className={cn("footer-status", runState === "error" && "is-error", openEndpoints.length && "is-warning")}><i />{runState === "error" ? "回路需要检查" : openEndpoints.length ? "连接未完成" : runState === "running" ? "瞬态仿真运行中" : solution ? "瞬态曲线就绪" : "等待运行"}</span><span>{circuit.components.length} 个元件</span><i className="footer-separator" /><span>{circuit.wires.length} 条导线</span><i className="footer-separator" /><span>{sample ? `t = ${formatTime(sample.time)}` : "Δt = 10 ms"}</span><span className="status-spacer" /><span className="status-model">理想 RC 教学模型 · 请以实物验证为准</span></footer>
  </main>;
}
