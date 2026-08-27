/**
 * 精密实验档案：以深色仪器工作台组织“搭建—现象—解释”，忠实遵循用户提供的 FLUXLAB 参考布局。
 * 页面只编排工具、画布与读数；电路事实和线性 DC 求解分别来自独立领域模块。
 */

import CircuitCanvas from "@/components/CircuitCanvas";
import {
  type CircuitComponent,
  type ComponentKind,
  cloneDocument,
  componentKinds,
  createVoltageDividerDocument,
  parseStoredDocument,
  storageKey,
  updateDocument,
} from "@/lib/circuit-model";
import { type SimulationResult, solveVoltageDivider } from "@/lib/circuit-solver";
import { cn } from "@/lib/utils";
import {
  Activity,
  BookOpen,
  ChevronDown,
  CircuitBoard,
  Grid3X3,
  History,
  Info,
  Minus,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type RunState = "idle" | "solving" | "complete" | "error";

const paletteGroups: Array<{ title: string; kinds: ComponentKind[] }> = [
  { title: "无源元件", kinds: ["resistor"] },
  { title: "电源", kinds: ["voltageSource", "ground"] },
  { title: "仪器", kinds: [] },
];

function formatResistance(value?: number) {
  if (value === undefined) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 1 : 2)} kΩ`;
  return `${value} Ω`;
}

function formatCurrent(current: number) {
  return Math.abs(current) < 0.001 ? `${(current * 1000000).toFixed(1)} μA` : `${(current * 1000).toFixed(3)} mA`;
}

function formatPower(power: number) {
  return power < 0.001 ? `${(power * 1000).toFixed(2)} mW` : `${power.toFixed(3)} W`;
}

function kindIcon(kind: ComponentKind, size = 26) {
  if (kind === "resistor") {
    return <svg className="symbol-preview" width={size + 28} height={size} viewBox="0 0 64 32" aria-hidden="true"><polyline className="palette-symbol-line" points="2,16 10,16 14,6 20,26 26,6 32,26 38,6 44,26 50,6 54,16 62,16" /></svg>;
  }
  if (kind === "voltageSource") {
    return <svg className="symbol-preview" width={size + 12} height={size + 12} viewBox="0 0 42 42" aria-hidden="true"><circle className="palette-symbol-line" cx="21" cy="21" r="16" /><path className="palette-symbol-line" d="M14 16h14M21 9v14M15 29h12" /></svg>;
  }
  return <svg className="symbol-preview" width={size + 15} height={size + 10} viewBox="0 0 46 36" aria-hidden="true"><path className="palette-symbol-line" d="M23 2v17M4 19h38M10 26h26M17 33h12" /></svg>;
}

function getInitialDocument() {
  if (typeof window === "undefined") return createVoltageDividerDocument();
  return parseStoredDocument(window.localStorage.getItem(storageKey)) ?? createVoltageDividerDocument();
}

export default function Home() {
  const [document, setDocument] = useState(getInitialDocument);
  const [selectedId, setSelectedId] = useState<string | null>("R2");
  const [history, setHistory] = useState<typeof document[]>([]);
  const [draftValue, setDraftValue] = useState("2000");
  const [simulation, setSimulation] = useState<SimulationResult | null>(() => solveVoltageDivider(getInitialDocument()));
  const [runState, setRunState] = useState<RunState>("idle");
  const [zoom, setZoom] = useState(100);
  const [search, setSearch] = useState("");
  const [saveLabel, setSaveLabel] = useState("本地已保存");

  const selectedComponent = useMemo(
    () => document.components.find((component) => component.id === selectedId) ?? document.components[0],
    [document.components, selectedId],
  );

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(document));
    setSaveLabel("本地已保存");
  }, [document]);

  useEffect(() => {
    if (selectedComponent?.value !== undefined) setDraftValue(String(selectedComponent.value));
  }, [selectedComponent]);

  const saveSnapshot = () => setHistory((currentHistory) => [...currentHistory.slice(-19), cloneDocument(document)]);

  const selectComponent = (componentId: string) => {
    setSelectedId(componentId);
    const component = document.components.find((item) => item.id === componentId);
    if (component?.value !== undefined) setDraftValue(String(component.value));
  };

  const applyValue = () => {
    if (!selectedComponent || selectedComponent.value === undefined) return;
    const value = Number(draftValue);
    if (!Number.isFinite(value) || (selectedComponent.kind === "resistor" && value <= 0)) {
      toast.error(selectedComponent.kind === "resistor" ? "阻值必须大于 0 Ω。" : "请输入有效的电压数值。");
      return;
    }
    saveSnapshot();
    setDocument((current) =>
      updateDocument(current, {
        components: current.components.map((component) =>
          component.id === selectedComponent.id ? { ...component, value } : component,
        ),
      }),
    );
    setSimulation(null);
    setRunState("idle");
    toast.success(`${selectedComponent.label} 参数已应用；请重新运行仿真。`);
  };

  const adjustDraft = (direction: 1 | -1) => {
    if (!selectedComponent || selectedComponent.value === undefined) return;
    const current = Number(draftValue) || selectedComponent.value;
    const step = selectedComponent.kind === "resistor" ? Math.max(10, Math.round(current * 0.1)) : 0.5;
    const next = selectedComponent.kind === "resistor" ? Math.max(1, current + direction * step) : current + direction * step;
    setDraftValue(String(next));
  };

  const addComponent = (kind: ComponentKind) => {
    const existing = document.components.filter((component) => component.kind === kind).length;
    const defaults = componentKinds[kind];
    const labelBase = kind === "resistor" ? "R" : kind === "voltageSource" ? "V" : "GND";
    const id = kind === "ground" ? `GND${existing + 1}` : `${labelBase}${existing + 1}`;
    const component: CircuitComponent = {
      id,
      kind,
      label: kind === "ground" ? id : id,
      x: 755 + (existing % 2) * 100,
      y: 205 + (existing % 3) * 110,
      value: defaults.defaultValue,
    };
    saveSnapshot();
    setDocument((current) => updateDocument(current, { components: [...current.components, component] }));
    setSelectedId(id);
    setSimulation(null);
    setRunState("idle");
    toast.message(`已加入 ${defaults.title}。首期请先检视其参数；布线编辑将在下一增量开放。`);
  };

  const runSimulation = () => {
    setRunState("solving");
    setSaveLabel("正在校验电路");
    window.setTimeout(() => {
      const result = solveVoltageDivider(document);
      setSimulation(result);
      setRunState(result.success ? "complete" : "error");
      setSaveLabel(result.success ? "本地已保存" : "需要检查连接");
      if (result.success) toast.success(`DC 工作点已求解：Vout = ${result.solution.vout.toFixed(3)} V。`);
    }, 360);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setDocument(previous);
    setHistory((current) => current.slice(0, -1));
    setSimulation(null);
    setRunState("idle");
    toast.message("已撤销上一次参数或元件修改。");
  };

  const resetExperiment = () => {
    saveSnapshot();
    const reset = createVoltageDividerDocument();
    setDocument(reset);
    setSelectedId("R2");
    setSimulation(solveVoltageDivider(reset));
    setRunState("idle");
    toast.message("已恢复 9V 分压器默认实验。");
  };

  const requestFullscreen = () => {
    globalThis.document.documentElement.requestFullscreen?.().catch(() => toast.message("当前浏览器未允许全屏预览。"));
  };

  const visibleGroups = paletteGroups.map((group) => ({
    ...group,
    kinds: group.kinds.filter((kind) => componentKinds[kind].title.includes(search) || kind.includes(search.toLowerCase())),
  }));

  const inspectionTitle = selectedComponent ? `${selectedComponent.label} / ${componentKinds[selectedComponent.kind].title}` : "检查器";
  const hasSolution = simulation?.success === true;
  const selectedValueLabel = selectedComponent?.kind === "resistor" ? "阻值" : "直流电压";

  return (
    <main className="lab-shell">
      <header className="lab-topbar">
        <div className="wordmark" aria-label="Fluxlab 电路模拟器">
          <span>FLUX</span><strong>LAB</strong>
        </div>
        <div className="project-path">
          <span>项目</span><i>/</i><span>电压分压器</span><i>/</i><b>实验 01</b>
        </div>
        <div className="save-status"><span className="status-dot"><span /></span>{saveLabel}</div>
        <div className="top-actions">
          <button className="icon-button" onClick={undo} disabled={!history.length} aria-label="撤销"><Undo2 size={19} /></button>
          <button className="icon-button is-muted" aria-label="重做（即将推出）" onClick={() => toast.message("重做栈将在命令式编辑器增量中开放。")}><Redo2 size={19} /></button>
          <span className="top-divider" />
          <button className="icon-button is-active" aria-label="网格视图"><Grid3X3 size={20} /></button>
          <button className="icon-button" aria-label="对齐辅助（即将推出）" onClick={() => toast.message("对齐辅助会随拖放布线功能一起上线。")}><MousePointer2 size={19} /></button>
          <div className="zoom-control" aria-label="画布缩放">
            <button onClick={() => setZoom((value) => Math.max(75, value - 25))} aria-label="缩小"><Minus size={17} /></button>
            <span>{zoom}%</span>
            <button onClick={() => setZoom((value) => Math.min(125, value + 25))} aria-label="放大"><Plus size={17} /></button>
          </div>
          <button className="icon-button" onClick={requestFullscreen} aria-label="全屏画布"><span className="fullscreen-corners" /></button>
          <button className={cn("run-button", runState === "solving" && "is-solving")} onClick={runSimulation} disabled={runState === "solving"}>
            <Play size={17} fill="currentColor" />
            {runState === "solving" ? "正在求解" : "运行仿真"}
          </button>
        </div>
      </header>

      <section className="workbench">
        <aside className="nav-rail" aria-label="工作台导航">
          <button className="rail-button is-selected" aria-label="电路编辑器"><CircuitBoard size={23} /></button>
          <button className="rail-button" aria-label="波形实验室（即将推出）" onClick={() => toast.message("波形实验室将在 RC 瞬态分析实现后启用。")}><Activity size={22} /></button>
          <button className="rail-button" aria-label="数字逻辑（即将推出）" onClick={() => toast.message("数字逻辑工作台已在学习路线中规划，尚未进入首期范围。")}><span className="rail-code">&lt;/&gt;</span></button>
          <button className="rail-button" aria-label="实验指南" onClick={() => toast.message("当前实验：改变 R2，比较测得输出与 Vout = Vs × R2 / (R1 + R2)。")}><BookOpen size={22} /></button>
          <span className="rail-spacer" />
          <button className="rail-button" aria-label="设置（即将推出）" onClick={() => toast.message("设置面板将在项目格式与快捷键方案稳定后开放。")}><Settings2 size={22} /></button>
        </aside>

        <aside className="component-library">
          <div className="search-box">
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索元件…" aria-label="搜索元件" />
            {search && <button onClick={() => setSearch("")} aria-label="清除搜索"><X size={16} /></button>}
          </div>
          <div className="library-scroll">
            {visibleGroups.map((group) => (
              <section className="palette-group" key={group.title}>
                <div className="palette-title"><span>{group.title}</span><ChevronDown size={15} /></div>
                {group.kinds.length ? (
                  <div className="palette-grid">
                    {group.kinds.map((kind) => (
                      <button className="component-card" key={kind} onClick={() => addComponent(kind)}>
                        {kindIcon(kind, 34)}
                        <span>{componentKinds[kind].title}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <button className="instrument-card" onClick={() => toast.message("示波器界面已预留；将在 RC 瞬态分析版本中接入真实波形。")}> 
                    <span className="scope-preview"><i /><i /><i /></span>
                    <span>示波器</span>
                  </button>
                )}
              </section>
            ))}
            {!visibleGroups.some((group) => group.kinds.length) && search && <p className="empty-search">未找到匹配元件。</p>}
          </div>
          <div className="library-tip"><Info size={15} /><span>点选画布元件以检视和修改参数。</span></div>
        </aside>

        <section className="center-stage">
          <div className="canvas-toolbar">
            <div><span className="toolbar-eyebrow">活动实验</span><strong>线性 DC · 分压器</strong></div>
            <div className="canvas-toolbar-actions"><span><Zap size={14} />{hasSolution ? "工作点已验证" : "未运行"}</span><button onClick={resetExperiment}><RotateCcw size={14} />恢复实验</button></div>
          </div>
          <CircuitCanvas document={document} selectedId={selectedId} simulation={simulation} zoom={zoom} onSelect={selectComponent} />
          <section className="measurement-drawer" aria-label="直流测量结果">
            <div className="drawer-header"><div><Activity size={16} /><span>测量台</span></div><span className="drawer-mode">DC 工作点</span><span className="drawer-spacer" /><button onClick={() => toast.message("RC 瞬态与示波器将在下一阶段启用。")}>波形模式 <ChevronDown size={14} /></button></div>
            {hasSolution ? (
              <div className="measurement-content">
                <div className="measurement-main"><span>输出节点</span><strong>Vout <em>{simulation.solution.vout.toFixed(3)} V</em></strong><small>基准：GND = 0 V</small></div>
                <div className="measurement-stat"><span>支路电流</span><b>{formatCurrent(simulation.solution.current)}</b><small>I = Vs / (R1 + R2)</small></div>
                <div className="measurement-stat"><span>R2 功耗</span><b>{formatPower(simulation.solution.rLowPower)}</b><small>额定 0.25 W</small></div>
                <div className="equation-chip">Vout = Vs × R2 / (R1 + R2)</div>
              </div>
            ) : (
              <div className="measurement-empty"><History size={20} /><span>运行仿真后，节点读数与功耗证据会显示在这里。</span></div>
            )}
          </section>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-title"><span>{selectedComponent?.label ?? "—"}</span><i>/</i><b>{selectedComponent ? componentKinds[selectedComponent.kind].title : "未选择元件"}</b></div>
          <div className="inspector-content">
            {selectedComponent?.value !== undefined ? (
              <>
                <label className="field-label" htmlFor="component-value">{selectedValueLabel}</label>
                <div className="value-stepper">
                  <input id="component-value" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} inputMode="decimal" aria-label={selectedValueLabel} />
                  <span>{selectedComponent.kind === "resistor" ? "Ω" : "V"}</span>
                  <div><button onClick={() => adjustDraft(1)} aria-label="增加数值"><Plus size={15} /></button><button onClick={() => adjustDraft(-1)} aria-label="减少数值"><Minus size={15} /></button></div>
                </div>
                <div className="knob-row"><div className="knob-scale"><span>100</span><span>1k</span><span>10k</span></div><div className="knob"><i /></div><span className="knob-value">{selectedComponent.kind === "resistor" ? formatResistance(Number(draftValue) || 0) : `${Number(draftValue) || 0} V`}</span></div>
                <label className="field-label">容差</label>
                <button className="select-field">5 % <ChevronDown size={18} /></button>
                <label className="field-label">额定功耗</label>
                <button className="select-field">0.25 W <ChevronDown size={18} /></button>
                <button className="apply-button" onClick={applyValue}>应用参数</button>
              </>
            ) : (
              <div className="ground-inspector"><span className="ground-large">⏚</span><strong>参考地</strong><p>该节点定义为 0 V，是所有测量读数的共同基准。</p></div>
            )}

            <div className="evidence-card">
              <div className="evidence-header"><SlidersHorizontal size={16} /><span>求解证据</span></div>
              {hasSolution ? (
                <>
                  <div className="evidence-line"><span>状态</span><b className="ok-text">线性 DC 收敛</b></div>
                  <div className="evidence-line"><span>Vout</span><b>{simulation.solution.vout.toFixed(3)} V</b></div>
                  <div className="evidence-line"><span>中点关系</span><b>{simulation.solution.rHigh.label} → {simulation.solution.rLow.label}</b></div>
                </>
              ) : simulation && !simulation.success ? (
                <div className="diagnostic"><Info size={17} /><span>{simulation.diagnostics[0]}</span></div>
              ) : (
                <p>更改参数后点击“运行仿真”，此处将显示计算状态与可核对读数。</p>
              )}
            </div>

            <div className="learning-card">
              <span>为什么输出是这个数值？</span>
              <strong>分压器把源电压按两段电阻的比例分配。</strong>
              <button onClick={() => toast.message("推导：串联支路电流 I = Vs/(R1+R2)，因此 Vout = I×R2。")}>查看推导 <span>→</span></button>
            </div>
          </div>
        </aside>
      </section>

      <footer className="lab-statusbar">
        <span className={cn("footer-status", runState === "error" && "is-error")}><i />{runState === "error" ? "电路需要检查" : hasSolution ? "电路有效" : "等待仿真"}</span>
        <span>{document.components.length} 个元件</span><i className="footer-separator" /><span>{document.wires.length} 个网络</span><i className="footer-separator" /><span>{hasSolution ? "DC 工作点就绪" : "准备求解"}</span>
        <span className="status-spacer" /><span className="status-model">教学模型 · 请以实物验证为准</span>
      </footer>
    </main>
  );
}
