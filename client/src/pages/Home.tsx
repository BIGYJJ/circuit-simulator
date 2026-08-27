/**
 * 精密实验档案：默认入口为可解释的 RC 充电工作台，沿用深色仪器三翼布局与高对比信号色。
 * 时间游标、画布读数和示波器曲线共享同一瞬态样本，避免视觉状态与计算状态脱节。
 */

import Oscilloscope from "@/components/Oscilloscope";
import RCChargeCanvas from "@/components/RCChargeCanvas";
import { type CircuitDocument, createRCChargeDocument, storageKey, updateDocument } from "@/lib/circuit-model";
import { type RCChargeResult, solveRCCharge } from "@/lib/rc-charge-solver";
import { cn } from "@/lib/utils";
import {
  Activity,
  BookOpen,
  ChevronDown,
  CircuitBoard,
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

function formatTime(time: number) {
  return time < 1 ? `${(time * 1000).toFixed(0)} ms` : `${time.toFixed(2)} s`;
}

function formatCapacitance(value?: number) {
  if (!value) return "—";
  return value < 0.001 ? `${(value * 1e6).toFixed(1)} μF` : `${(value * 1000).toFixed(2)} mF`;
}

export default function Home() {
  const [circuit, setCircuit] = useState(getInitialCircuit);
  const [result, setResult] = useState<RCChargeResult | null>(() => solveRCCharge(getInitialCircuit()));
  const [selectedId, setSelectedId] = useState("C1");
  const [activeIndex, setActiveIndex] = useState(0);
  const [runState, setRunState] = useState<RunState>("idle");
  const [draftValue, setDraftValue] = useState("100");
  const [zoom, setZoom] = useState(100);
  const [saveLabel, setSaveLabel] = useState("本地已保存");

  const selected = useMemo(
    () => circuit.components.find((component) => component.id === selectedId) ?? circuit.components[0],
    [circuit.components, selectedId],
  );
  const solution = result?.success ? result.solution : null;
  const samples = solution?.samples ?? [];
  const sample = samples[Math.min(activeIndex, Math.max(samples.length - 1, 0))];
  const canContinue = Boolean(solution && activeIndex < samples.length - 1);

  useEffect(() => {
    window.localStorage.setItem(rcStorageKey, JSON.stringify(circuit));
    setSaveLabel("本地已保存");
  }, [circuit]);

  useEffect(() => {
    if (selected?.value !== undefined) {
      setDraftValue(selected.kind === "capacitor" ? String(selected.value * 1e6) : String(selected.value));
    }
  }, [selected]);

  useEffect(() => {
    if (runState !== "running" || !solution) return;
    const timer = window.setInterval(() => {
      setActiveIndex((currentIndex) => {
        const nextIndex = Math.min(currentIndex + 4, samples.length - 1);
        if (nextIndex === samples.length - 1) setRunState("complete");
        return nextIndex;
      });
    }, 28);
    return () => window.clearInterval(timer);
  }, [runState, solution, samples.length]);

  const invalidateAnalysis = (nextCircuit: typeof circuit) => {
    setCircuit(nextCircuit);
    setResult(null);
    setActiveIndex(0);
    setRunState("idle");
  };

  const runExperiment = () => {
    setSaveLabel("正在计算瞬态曲线");
    const next = solveRCCharge(circuit);
    setResult(next);
    setActiveIndex(0);
    if (next.success) {
      setRunState("running");
      toast.success(`已生成 ${next.solution.samples.length} 个 RC 充电时间点。`);
    } else {
      setRunState("error");
      toast.error(next.diagnostics[0]);
    }
  };

  const togglePlay = () => {
    if (!solution) {
      runExperiment();
      return;
    }
    if (!canContinue) {
      setActiveIndex(0);
      setRunState("running");
      return;
    }
    setRunState((state) => (state === "running" ? "paused" : "running"));
  };

  const step = () => {
    if (!solution) {
      runExperiment();
      return;
    }
    setRunState("paused");
    setActiveIndex((index) => Math.min(index + 1, samples.length - 1));
  };

  const resetTime = () => {
    setActiveIndex(0);
    setRunState("idle");
  };

  const toggleSwitch = () => {
    const current = circuit.components.find((component) => component.id === "S1");
    if (!current) return;
    invalidateAnalysis(
      updateDocument(circuit, {
        components: circuit.components.map((component) =>
          component.id === "S1" ? { ...component, closed: !component.closed } : component,
        ),
      }),
    );
    toast.message(current.closed === false ? "S1 已闭合。运行实验后电容开始充电。" : "S1 已断开。RC 支路不会继续充电。");
  };

  const applyValue = () => {
    if (!selected || selected.value === undefined) return;
    const rawValue = Number(draftValue);
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      toast.error("请输入大于 0 的有效参数。");
      return;
    }
    const nextValue = selected.kind === "capacitor" ? rawValue / 1e6 : rawValue;
    invalidateAnalysis(
      updateDocument(circuit, {
        components: circuit.components.map((component) =>
          component.id === selected.id ? { ...component, value: nextValue } : component,
        ),
      }),
    );
    toast.success(`${selected.label} 参数已更新；运行实验以生成新曲线。`);
  };

  const resetCircuit = () => {
    const initial = createRCChargeDocument();
    setCircuit(initial);
    setResult(solveRCCharge(initial));
    setSelectedId("C1");
    setActiveIndex(0);
    setRunState("idle");
    toast.message("已恢复默认 RC 充电实验。");
  };

  const selectedKindName = selected?.kind === "capacitor" ? "电容 · 充电" : selected?.kind === "resistor" ? "电阻" : selected?.kind === "switch" ? "开关" : selected?.kind === "voltageSource" ? "直流电压源" : "参考地";
  const fieldLabel = selected?.kind === "capacitor" ? "电容" : selected?.kind === "resistor" ? "阻值" : "源电压";
  const unit = selected?.kind === "capacitor" ? "μF" : selected?.kind === "resistor" ? "Ω" : "V";
  const stepSize = selected?.kind === "capacitor" ? 10 : selected?.kind === "resistor" ? 1000 : 1;

  return (
    <main className="lab-shell rc-lab-shell">
      <header className="lab-topbar">
        <div className="wordmark"><span>FLUX</span><strong>LAB</strong></div>
        <div className="project-path"><span>项目</span><i>/</i><span>RC 充电</span><i>/</i><b>实验 02</b></div>
        <div className="save-status"><span className="status-dot"><span /></span>{saveLabel}</div>
        <div className="top-actions">
          <Link href="/divider" className="compact-nav-link">分压器</Link>
          <button className="icon-button" onClick={() => toast.message("RC 实验的跨快照撤销将在统一命令栈版本开放。")} aria-label="撤销"><Undo2 size={19} /></button>
          <button className="icon-button" onClick={() => toast.message("RC 实验的跨快照重做将在统一命令栈版本开放。")} aria-label="重做"><Redo2 size={19} /></button>
          <span className="top-divider" />
          <button className="icon-button is-active" aria-label="网格视图"><Grid3X3 size={20} /></button>
          <div className="zoom-control">
            <button onClick={() => setZoom((value) => Math.max(75, value - 25))} aria-label="缩小"><Minus size={17} /></button>
            <span>{zoom}%</span>
            <button onClick={() => setZoom((value) => Math.min(125, value + 25))} aria-label="放大"><Plus size={17} /></button>
          </div>
          <button className={cn("run-button", runState === "running" && "is-solving")} onClick={runExperiment}>
            <Play size={17} fill="currentColor" />{runState === "running" ? "仿真运行中" : "运行仿真"}
          </button>
        </div>
      </header>

      <section className="workbench">
        <aside className="nav-rail" aria-label="工作台导航">
          <button className="rail-button is-selected" aria-label="电路编辑器"><CircuitBoard size={23} /></button>
          <button className="rail-button" onClick={() => toast.message("当前已在瞬态实验模式。")} aria-label="瞬态实验"><Activity size={22} /></button>
          <button className="rail-button" onClick={() => toast.message("数字逻辑工作台将在后续阶段开放。")} aria-label="数字逻辑"><span className="rail-code">&lt;/&gt;</span></button>
          <button className="rail-button" onClick={() => toast.message("目标：观察 Vcap 在 1τ 时达到约 63.2% 的源电压。")} aria-label="实验指南"><BookOpen size={22} /></button>
          <span className="rail-spacer" />
          <button className="rail-button" onClick={() => toast.message("设置面板正在规划中。")} aria-label="设置"><Settings2 size={22} /></button>
        </aside>

        <aside className="component-library rc-library">
          <div className="search-box"><Search size={18} /><input placeholder="搜索元件…" aria-label="搜索元件" readOnly /><button aria-label="清除搜索"><X size={16} /></button></div>
          <div className="library-scroll">
            <section className="palette-group">
              <div className="palette-title"><span>无源元件</span><ChevronDown size={15} /></div>
              <button className={cn("component-card", selectedId === "R1" && "is-current")} onClick={() => setSelectedId("R1")}><span className="symbol-preview rc-resistor-icon">⌁</span><span>电阻</span></button>
              <button className={cn("component-card", selectedId === "C1" && "is-current")} onClick={() => setSelectedId("C1")}><span className="symbol-preview capacitor-icon">║</span><span>电容</span></button>
            </section>
            <section className="palette-group">
              <div className="palette-title"><span>电源与控制</span><ChevronDown size={15} /></div>
              <button className={cn("component-card", selectedId === "V1" && "is-current")} onClick={() => setSelectedId("V1")}><span className="symbol-preview source-preview">⊕</span><span>直流电压源</span></button>
              <button className={cn("component-card", selectedId === "S1" && "is-current")} onClick={() => setSelectedId("S1")}><span className="symbol-preview switch-icon">⌁</span><span>开关</span></button>
              <button className={cn("component-card", selectedId === "GND" && "is-current")} onClick={() => setSelectedId("GND")}><span className="symbol-preview ground-preview">⏚</span><span>参考地</span></button>
            </section>
            <section className="palette-group"><div className="palette-title"><span>仪器</span><ChevronDown size={15} /></div><button className="instrument-card is-current" onClick={() => toast.message("示波器正在显示 Vcap(t) 的真实求解样本。")}><span className="scope-preview"><i /><i /><i /></span><span>示波器</span></button></section>
          </div>
          <div className="library-tip"><Info size={15} /><span>点选元件查看参数；双击 S1 可开闭充电回路。</span></div>
        </aside>

        <section className="center-stage rc-center-stage">
          <div className="canvas-toolbar"><div><span className="toolbar-eyebrow">活动实验</span><strong>瞬态 TR · RC 充电</strong></div><div className="canvas-toolbar-actions"><span><Zap size={14} />{solution ? "求解器稳定" : "参数已修改 · 待运行"}</span><button onClick={resetCircuit}><RotateCcw size={14} />恢复实验</button></div></div>
          <div className="rc-zoom-shell" style={{ transform: `scale(${zoom / 100})` }}><RCChargeCanvas document={circuit} result={result} activeIndex={activeIndex} selectedId={selectedId} onSelect={setSelectedId} onToggleSwitch={toggleSwitch} /></div>
          <section className="rc-control-strip" aria-label="RC 时间控制">
            <button className={cn("time-control primary", runState === "running" && "is-live")} onClick={togglePlay}>{runState === "running" ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}{runState === "running" ? "暂停" : canContinue ? "继续" : "播放"}</button>
            <button className="time-control" onClick={step}><StepForward size={17} />单步</button>
            <button className="time-control" onClick={resetTime}><SkipForward size={17} className="flip-icon" />复位时间</button>
            <div className="time-readout"><span>当前时刻</span><b>{sample ? formatTime(sample.time) : "0 ms"}</b><small>{solution ? `/ ${formatTime(solution.duration)}` : "/ 5.00 s"}</small></div>
            <div className="time-progress"><i style={{ width: `${solution ? (activeIndex / Math.max(samples.length - 1, 1)) * 100 : 0}%` }} /></div>
            <span className="time-scale">×1 实时回放</span>
          </section>
          <Oscilloscope result={result} activeIndex={activeIndex} />
        </section>

        <aside className="inspector-panel rc-inspector">
          <div className="inspector-title"><span>{selected?.label ?? "—"}</span><i>/</i><b>{selectedKindName}</b></div>
          <div className="inspector-content">
            {selected?.kind === "switch" ? (
              <div className="switch-inspector"><span className={cn("switch-state-icon", selected.closed !== false && "is-closed")}><i /></span><strong>{selected.closed === false ? "开关已断开" : "开关已闭合"}</strong><p>{selected.closed === false ? "充电回路未闭合，Vcap 将保持初始电压。" : "电源已连接到 RC 支路，可运行瞬态求解。"}</p><button className="apply-button" onClick={toggleSwitch}>{selected.closed === false ? "闭合开关" : "断开开关"}</button></div>
            ) : selected?.kind === "ground" ? (
              <div className="ground-inspector"><span className="ground-large">⏚</span><strong>参考地</strong><p>GND 设为 0 V，Vcap 以它作为测量基准。</p></div>
            ) : (
              <>
                <label className="field-label" htmlFor="rc-value">{fieldLabel}</label>
                <div className="value-stepper"><input id="rc-value" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} inputMode="decimal" /><span>{unit}</span><div><button onClick={() => setDraftValue(String((Number(draftValue) || 0) + stepSize))} aria-label="增加数值"><Plus size={15} /></button><button onClick={() => setDraftValue(String(Math.max(1, (Number(draftValue) || 0) - stepSize)))} aria-label="减少数值"><Minus size={15} /></button></div></div>
                {selected?.kind === "capacitor" && <div className="parameter-note"><span>初始电压</span><b>{selected.initialValue ?? 0} V</b><span>当前容量</span><b>{formatCapacitance(selected.value)}</b></div>}
                {selected?.kind === "resistor" && <div className="parameter-note"><span>额定功耗</span><b>0.25 W</b><span>容差</span><b>5 %</b></div>}
                <button className="apply-button" onClick={applyValue}>应用参数</button>
              </>
            )}
            <div className="rc-formula-card"><span>理想 RC 充电</span><strong>Vcap(t) = Vs · (1 − e⁻ᵗ⁄ᴿᶜ)</strong><div><b>τ = R × C</b><em>{solution ? `${solution.timeConstant.toFixed(3)} s` : "待计算"}</em></div></div>
            <div className="evidence-card"><div className="evidence-header"><Activity size={16} /><span>当前观测</span></div>{sample && solution ? <><div className="evidence-line"><span>Vcap</span><b className="cyan-text">{sample.capacitorVoltage.toFixed(3)} V</b></div><div className="evidence-line"><span>I(R1)</span><b>{(sample.current * 1000).toFixed(3)} mA</b></div><div className="evidence-line"><span>充电比例</span><b>{((sample.capacitorVoltage / solution.sourceVoltage) * 100).toFixed(1)} %</b></div></> : <p>运行仿真后，这里会显示当前时间游标对应的真实样本。</p>}</div>
            <div className="learning-card"><span>为什么 Vcap 上升变慢？</span><strong>电容电压升高会减小电阻两端压差，因此支路电流随时间衰减。</strong><button onClick={() => toast.message("在 t = τ 时，Vcap = Vs × (1 − e⁻¹)，约为最终电压的 63.2%。")}>查看 1τ 推导 <span>→</span></button></div>
          </div>
        </aside>
      </section>

      <footer className="lab-statusbar"><span className={cn("footer-status", runState === "error" && "is-error")}><i />{runState === "error" ? "回路需要检查" : runState === "running" ? "瞬态仿真运行中" : solution ? "瞬态曲线就绪" : "等待运行"}</span><span>5 个元件</span><i className="footer-separator" /><span>5 条导线</span><i className="footer-separator" /><span>{sample ? `t = ${formatTime(sample.time)}` : "Δt = 10 ms"}</span><span className="status-spacer" /><span className="status-model">理想 RC 教学模型 · 请以实物验证为准</span></footer>
    </main>
  );
}
