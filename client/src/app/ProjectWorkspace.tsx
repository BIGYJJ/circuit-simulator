import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { APP_BUILD_ID } from "./build-info";
import type { AnalysisId, CircuitProjectV2, ComponentId, Diagnostic } from "../domain/project/project-v2";
import AnalysisPanel from "../features/analysis/AnalysisPanel";
import DiagnosticsPanel from "../features/analysis/DiagnosticsPanel";
import ProbePanel from "../features/analysis/ProbePanel";
import ProvenanceInspector from "../features/analysis/ProvenanceInspector";
import RunControls from "../features/analysis/RunControls";
import RunHistory from "../features/analysis/RunHistory";
import ComponentPalette from "../features/editor/ComponentPalette";
import PropertiesPanel from "../features/editor/PropertiesPanel";
import SchematicCanvas from "../features/editor/SchematicCanvas";
import { isElectricalCommand, projectReducer, type ProjectCommand } from "../features/editor/project-reducer";
import ExportMenu from "../features/analysis/ExportMenu";
import ResultDock from "../features/instruments/ResultDock";
import ModelPanel from "../features/models/ModelPanel";
import VerificationPanel from "../features/verification/VerificationPanel";
import { runErc } from "../domain/schematic/diagnostics";
import { buildSchematicGraph } from "../domain/schematic/graph";
import type { RunRecord, SuccessfulRunRecord } from "../simulation/contracts";
import { compileNetlist } from "../simulation/compile-netlist";
import { estimateRunResources } from "../simulation/resource-estimator";
import { PINNED_ENGINE, SimulationController } from "../simulation/simulation-controller";
import { checkRunFreshness } from "../simulation/run-record";
import {
  buildDeliveryGateInput,
  evaluateDeliveryGate,
  listGateRunEvidence,
  planAnalysisRuns,
  reevaluateAssertions,
  runAnalysisSeries,
  type DeliveryGateResult,
} from "../simulation/verification";
import type { LessonAction, LessonViewMode } from "../features/learning/contracts";
import LessonOverlay from "../features/learning/LessonOverlay";
import { canPerformLessonAction, lessonById, restartLessonProject } from "../features/learning/lessons";
import {
  createProjectSaveLane,
  listRuns,
  loadProject,
  loadRun,
  recoverInterruptedRuns,
  saveLastOpenedProject,
  saveProject,
  type ProjectSaveState,
} from "../storage/indexeddb";

interface ProjectWorkspaceProps {
  projectId: string;
}

function saveLabel(state: ProjectSaveState | null) {
  if (!state) return "读取中";
  if (state.status === "saved") return "已保存";
  if (state.status === "error") return "保存失败";
  if (state.status === "saving") return "保存中";
  return "未保存";
}

function emptyProject(projectId: string): CircuitProjectV2 {
  return {
    schemaVersion: 2,
    id: projectId,
    title: "",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    revision: 1,
    electricalRevision: 1,
    schematic: { components: [], wires: [] },
    layout: { components: {}, wireRoutes: {} },
    models: [],
    analyses: [],
    probes: [],
    assertions: [],
    corners: [],
    notes: [],
  };
}

function voltageOf(run: SuccessfulRunRecord) {
  const vector = run.snapshot.vectors.find(
    item => item.quantity === "voltage" && (item.label === "Vout" || item.probeId === "pr-vout")
  );
  const value = vector?.values[0];
  return value === undefined ? "—" : `${value.toFixed(6)} V`;
}

function currentOf(run: SuccessfulRunRecord, refdes: string) {
  const needle = refdes.toLowerCase();
  const vector = run.snapshot.vectors.find(
    item =>
      item.quantity === "current" &&
      (item.label === `I(${refdes})` || item.probeId === `pr-i${needle}` || item.probeId === `pr-i-${needle}` || item.probeId.endsWith(needle))
  );
  const value = vector?.values[0];
  return value === undefined ? "—" : `${(value * 1000).toFixed(6)} mA`;
}

function commandAction(command: ProjectCommand): LessonAction | null {
  if (command.type === "component/add") return "component:add";
  if (command.type === "component/remove") return "component:remove";
  if (command.type === "component/replace") return "component:updateParams";
  if (command.type === "wire/add") return "wire:add";
  if (command.type === "wire/remove") return "wire:remove";
  if (command.type === "probe/upsert") return "probe:add";
  return null;
}

function runLabelOf(kind: string | undefined) {
  if (kind === "dc-op") return "运行 DC 工作点";
  if (kind === "dc-sweep") return "运行 DC 扫描";
  if (kind === "transient") return "运行暂态";
  if (kind === "ac") return "运行交流";
  return "运行分析";
}

export default function ProjectWorkspace({ projectId }: ProjectWorkspaceProps) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const lesson = lessonById(searchParams.get("lesson") ?? "");
  const view = (searchParams.get("view") as LessonViewMode | null) ?? (lesson ? "guided" : "standard");
  const [guidedStepId, setGuidedStepId] = useState(lesson?.steps[0]?.id ?? "");
  const currentStep = lesson?.steps.find(item => item.id === guidedStepId) ?? lesson?.steps[0];
  const [loadError, setLoadError] = useState<Diagnostic[] | null>(null);
  const [selectedId, setSelectedId] = useState<ComponentId | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<AnalysisId | null>(null);
  const [saveState, setSaveState] = useState<ProjectSaveState | null>(null);
  const [ready, setReady] = useState(false);
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<SuccessfulRunRecord | null>(null);
  const [compareRun, setCompareRun] = useState<SuccessfulRunRecord | null>(null);
  const [fresh, setFresh] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [gate, setGate] = useState<DeliveryGateResult | null>(null);
  const stopSeries = useRef(false);
  const [estimateText, setEstimateText] = useState("—");
  const [runDiagnostics, setRunDiagnostics] = useState<Diagnostic[]>([]);
  const [previewDiagnostics, setPreviewDiagnostics] = useState<Diagnostic[]>([]);
  const [loadErrors, setLoadErrors] = useState<Diagnostic[]>([]);
  const [editor, dispatch] = useReducer(projectReducer, {
    past: [],
    present: emptyProject(projectId),
    future: [],
    diagnostics: [],
  });
  const laneRef = useRef<ReturnType<typeof createProjectSaveLane> | null>(null);
  const allowEnqueue = useRef(false);
  const controllerRef = useRef<SimulationController | null>(null);
  const saveBusy = saveState?.status === "saving" || saveState?.status === "dirty";
  const selectedAnalysis = editor.present.analyses.find(item => item.id === analysisId);

  useEffect(() => {
    const controller = new SimulationController();
    controllerRef.current = controller;
    void recoverInterruptedRuns();
    return () => {
      void controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelledLoad = false;
    allowEnqueue.current = false;
    setReady(false);
    setLoadError(null);
    void loadProject(projectId).then(result => {
      if (cancelledLoad) return;
      if (!result.ok) {
        setLoadError(result.diagnostics);
        return;
      }
      if (!result.value) {
        setLoadError([{ severity: "error", code: "STORAGE_NOT_FOUND", message: "project not found", blocksRun: true }]);
        return;
      }
      dispatch({ type: "load", project: result.value });
      setAnalysisId(result.value.analyses[0]?.id ?? null);
      laneRef.current?.dispose();
      const lane = createProjectSaveLane({
        persist: (expected, project) => saveProject(expected, project),
        onState: setSaveState,
        persistedRevision: result.value.revision,
      });
      laneRef.current = lane;
      setSaveState({ status: "saved", latestRevision: result.value.revision, persistedRevision: result.value.revision });
      setReady(true);
      void saveLastOpenedProject(result.value.id);
    });
    return () => {
      cancelledLoad = true;
      laneRef.current?.dispose();
      laneRef.current = null;
    };
  }, [projectId]);

  useEffect(() => {
    if (!ready) return;
    if (!allowEnqueue.current) {
      allowEnqueue.current = true;
      return;
    }
    laneRef.current?.enqueue(editor.present);
  }, [editor.present, ready]);

  useEffect(() => {
    if (analysisId && editor.present.analyses.some(item => item.id === analysisId)) return;
    setAnalysisId(editor.present.analyses[0]?.id ?? null);
  }, [analysisId, editor.present.analyses]);

  async function refreshRuns(preferId?: string, forAnalysis = analysisId) {
    const listed = await listRuns(projectId);
    if (!listed.ok) {
      setLoadErrors(listed.diagnostics);
      return;
    }
    const loaded: RunRecord[] = [];
    const errors: Diagnostic[] = [];
    for (const summary of listed.value) {
      const row = await loadRun(summary.runId);
      if (!row.ok) {
        errors.push(...row.diagnostics);
        continue;
      }
      if (row.value) loaded.push(row.value.record);
    }
    setRecords(loaded);
    setLoadErrors(errors);
    const successes = loaded.filter((item): item is SuccessfulRunRecord => item.status === "success");
    const preferred = preferId ? successes.find(item => item.runId === preferId) : undefined;
    const matching = successes.filter(item => !forAnalysis || item.analysisId === forAnalysis);
    setSelectedRun(preferred ?? matching.at(-1) ?? null);
  }

  useEffect(() => {
    if (ready) void refreshRuns(undefined, analysisId);
  }, [ready, projectId, analysisId]);

  useEffect(() => {
    if (ready) void refreshGate();
  }, [ready, editor.present, analysisId, records]);

  useEffect(() => {
    let cancelledEstimate = false;
    const analysis = editor.present.analyses.find(item => item.id === analysisId);
    if (!analysis) {
      setPreviewDiagnostics([]);
      setEstimateText("—");
      return;
    }
    void compileNetlist({ project: editor.present, analysis }).then(result => {
      if (cancelledEstimate) return;
      setPreviewDiagnostics(result.diagnostics);
      if (!result.ok) {
        setEstimateText("—");
        return;
      }
      const estimate = estimateRunResources({
        project: editor.present,
        analysis,
        compiled: result.value,
        resultTransport: "binary-rawfile",
      });
      if (!estimate.ok) {
        setEstimateText(estimate.diagnostics.map(item => item.code).join(" "));
        return;
      }
      setEstimateText(`${estimate.value.axisPoints} 点 · ${estimate.value.snapshotTransferBytes} 字节`);
    });
    return () => {
      cancelledEstimate = true;
    };
  }, [editor.present, analysisId]);

  useEffect(() => {
    if (!selectedRun) {
      setFresh(false);
      return;
    }
    let cancelledFresh = false;
    void checkRunFreshness({
      run: selectedRun,
      project: editor.present,
      appBuildId: APP_BUILD_ID,
      engine: PINNED_ENGINE,
    }).then(result => {
      if (!cancelledFresh && result.ok) setFresh(result.value.fresh);
    });
    return () => {
      cancelledFresh = true;
    };
  }, [selectedRun, editor.present]);

  function actionAllowed(action: LessonAction) {
    if (!lesson || view !== "guided" || !currentStep) return true;
    return canPerformLessonAction(currentStep, action);
  }

  function setLessonView(next: LessonViewMode) {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    if (lesson) params.set("lesson", lesson.id);
    params.set("view", next);
    navigate(`/project/${projectId}?${params.toString()}`, { replace: true });
  }

  async function runCommand(command: ProjectCommand) {
    const mapped = commandAction(command);
    if (mapped && !actionAllowed(mapped)) {
      setRunDiagnostics([{ severity: "error", code: "LESSON_ACTION_BLOCKED", message: "this action is outside the current guided step", blocksRun: false }]);
      return;
    }
    if (isElectricalCommand(command) && running) {
      await controllerRef.current?.cancel("project-changed");
      setRunning(false);
    }
    dispatch({ type: "command", command, changedAt: new Date().toISOString() });
  }

  async function onRun() {
    if (!actionAllowed("analysis:run")) {
      setRunDiagnostics([{ severity: "error", code: "LESSON_ACTION_BLOCKED", message: "running is outside the current guided step", blocksRun: false }]);
      return;
    }
    if (!analysisId || !controllerRef.current) return;
    setRunning(true);
    setCancelled(false);
    setRunDiagnostics([]);
    const result = await controllerRef.current.run({ project: editor.present, analysisId });
    setRunning(false);
    if (result.status === "not-started") {
      setRunDiagnostics(result.diagnostics);
      return;
    }
    if (result.status === "cancelled") {
      setCancelled(true);
      setSelectedRun(null);
      await refreshRuns(undefined, analysisId);
      return;
    }
    await refreshRuns(result.status === "success" ? result.runId : undefined, analysisId);
  }

  async function refreshGate() {
    const analysis = editor.present.analyses.find(item => item.id === analysisId);
    if (!analysis) {
      setGate(null);
      return;
    }
    const evidence = await listGateRunEvidence(projectId);
    const graph = buildSchematicGraph(editor.present);
    const erc = graph.ok ? runErc(editor.present, graph.value) : graph.diagnostics;
    const input = await buildDeliveryGateInput(editor.present, analysis, PINNED_ENGINE, evidence.ok ? evidence.value : [], erc);
    if (input.ok) setGate(evaluateDeliveryGate(input.value));
  }

  async function onRunSeries() {
    if (!analysisId || !controllerRef.current) return;
    const planned = planAnalysisRuns(editor.present, analysisId);
    if (!planned.ok) {
      setRunDiagnostics(planned.diagnostics);
      return;
    }
    stopSeries.current = false;
    setSeriesBusy(true);
    setRunning(true);
    setCancelled(false);
    const result = await runAnalysisSeries(controllerRef.current, planned.value, () => stopSeries.current);
    setSeriesBusy(false);
    setRunning(false);
    if (result.status === "stopped" && result.records.some(item => item.status === "cancelled")) setCancelled(true);
    setRunDiagnostics(result.diagnostics);
    await refreshRuns(result.records.find(item => item.status === "success")?.runId, analysisId);
    await refreshGate();
  }

  const lastFailed = [...records].reverse().find(item => item.status === "failed");
  const currentEnough = Boolean(selectedRun && fresh && selectedRun.electricalRevision === editor.present.electricalRevision);
  const statusLabel = running
    ? "运行中"
    : cancelled && !selectedRun
      ? "已取消"
      : selectedRun && currentEnough
        ? "成功 · 当前"
        : selectedRun
          ? "成功 · 历史结果"
          : records[0]
            ? records[0].status
            : "尚未运行";

  if (loadError) {
    return (
      <main className="workspace-error">
        <p>
          <Link href="/">项目库</Link>
        </p>
        {[...new Set(loadError.map(item => item.code))].map(code => (
          <p key={code}>{code}</p>
        ))}
      </main>
    );
  }

  if (!ready) {
    return <main className="workspace-error">正在打开项目…</main>;
  }

  return (
    <div className="workspace-shell">
      {lesson ? (
        <LessonOverlay
          lesson={lesson}
          project={editor.present}
          selectedRun={selectedRun && currentEnough ? selectedRun : selectedRun}
          view={view}
          onView={setLessonView}
          onStep={setGuidedStepId}
          onRestart={() => {
            void restartLessonProject(lesson).then(result => {
              if (result.ok) navigate(`/project/${result.value.projectId}?lesson=${lesson.id}&view=guided`, { replace: true });
            });
          }}
        />
      ) : null}
      <header className="workspace-topbar">
        <Link href="/">项目库</Link>
        <h1>{editor.present.title}</h1>
        <p data-testid="project-revision">{`修订 ${editor.present.revision} / 电气 ${editor.present.electricalRevision}`}</p>
        <p data-testid="project-save-state">{saveLabel(saveState)}</p>
        {saveState?.status === "error" ? (
          <button type="button" onClick={() => laneRef.current?.retry()}>
            重试
          </button>
        ) : null}
        <button type="button" onClick={() => dispatch({ type: "undo", changedAt: new Date().toISOString() })}>
          撤销
        </button>
        <button type="button" onClick={() => dispatch({ type: "redo", changedAt: new Date().toISOString() })}>
          重做
        </button>
        <Link href="/settings">设置</Link>
      </header>
      {editor.diagnostics.map(item => (
        <p key={`${item.code}-${item.message}`}>{item.code}</p>
      ))}
      <div className="workspace-body">
        <ComponentPalette
          project={editor.present}
          allowAdd={actionAllowed("component:add")}
          onCommand={command => void runCommand(command)}
        />
        <SchematicCanvas
          project={editor.present}
          selectedId={selectedId}
          selectedWireId={selectedWireId}
          onSelect={setSelectedId}
          onSelectWire={setSelectedWireId}
          onCommand={command => void runCommand(command)}
        />
        <div className="workspace-rail">
          <AnalysisPanel
            project={editor.present}
            analysisId={analysisId}
            estimateText={estimateText}
            onSelect={setAnalysisId}
            onCommand={command => void runCommand(command)}
          />
          <RunControls
            project={editor.present}
            analysisId={analysisId}
            statusLabel={statusLabel}
            running={running}
            saveBusy={Boolean(saveBusy)}
            blockers={previewDiagnostics.filter(item => item.blocksRun)}
            runLabel={runLabelOf(selectedAnalysis?.kind)}
            allowRun={actionAllowed("analysis:run")}
            onRun={() => void onRun()}
            onCancel={() => {
              void controllerRef.current?.cancel("user").then(() => {
                setRunning(false);
                setCancelled(true);
                setSelectedRun(null);
              });
            }}
          />
          <p data-testid="vout-value">{selectedRun ? voltageOf(selectedRun) : "—"}</p>
          <p data-testid="vout-current-value">{selectedRun && currentEnough ? voltageOf(selectedRun) : "尚无当前结果"}</p>
          <p data-testid="current-R1">{selectedRun ? currentOf(selectedRun, "R1") : "—"}</p>
          <p data-testid="current-R2">{selectedRun ? currentOf(selectedRun, "R2") : "—"}</p>
          <p data-testid="current-R3">{selectedRun ? currentOf(selectedRun, "R3") : "—"}</p>
          <p data-testid="run-count">{String(records.length)}</p>
          <p data-testid="assertion-eval-hash">{selectedRun?.assertionEvaluations.at(-1)?.assertionSetHash ?? ""}</p>
          {lastFailed && lastFailed.status === "failed" ? (
            <p data-testid="run-failure-message">{lastFailed.failure.message}</p>
          ) : null}
          <ProbePanel project={editor.present} analysis={selectedAnalysis} onCommand={command => void runCommand(command)} />
          <ModelPanel project={editor.present} onCommand={command => void runCommand(command)} />
          <VerificationPanel
            project={editor.present}
            analysis={selectedAnalysis}
            gate={gate}
            seriesBusy={seriesBusy}
            onCommand={command => void runCommand(command)}
            onRunSeries={() => void onRunSeries()}
            onCancelSeries={() => {
              stopSeries.current = true;
              void controllerRef.current?.cancel("user").then(() => {
                setRunning(false);
                setSeriesBusy(false);
                setCancelled(true);
              });
            }}
            onReevaluate={() => {
              void (async () => {
                const successes = records.filter((item): item is SuccessfulRunRecord => item.status === "success" && item.analysisId === analysisId);
                for (const run of successes) {
                  await reevaluateAssertions(editor.present, run, PINNED_ENGINE);
                }
                await refreshRuns(selectedRun?.runId, analysisId);
                await refreshGate();
              })();
            }}
          />
          <ExportMenu
            project={editor.present}
            selectedRun={selectedRun}
            records={records.filter((item): item is Exclude<(typeof records)[number], { status: "running" }> => item.status !== "running")}
            onImported={() => void refreshRuns(undefined, analysisId)}
          />
          <ResultDock run={selectedRun} compare={compareRun} />
          <RunHistory
            records={records}
            selectedId={selectedRun?.runId ?? null}
            compareId={compareRun?.runId ?? null}
            onSelect={setSelectedRun}
            onCompare={setCompareRun}
          />
          <DiagnosticsPanel
            diagnostics={[
              ...previewDiagnostics,
              ...runDiagnostics,
              ...loadErrors,
              ...(lastFailed && lastFailed.status === "failed"
                ? [
                    {
                      severity: "error" as const,
                      code: lastFailed.failure.code,
                      message: lastFailed.failure.message,
                      blocksRun: true,
                    },
                    ...lastFailed.failure.diagnostics,
                    ...lastFailed.failure.log.slice(0, 8).map((line, index) => ({
                      severity: "error" as const,
                      code: `ENGINE_LOG_${index}`,
                      message: line,
                      blocksRun: false,
                    })),
                  ]
                : []),
            ]}
            preview
          />
          <ProvenanceInspector record={selectedRun} />
          <PropertiesPanel
            project={editor.present}
            selectedId={selectedId}
            selectedWireId={selectedWireId}
            onSelect={setSelectedId}
            onSelectWire={setSelectedWireId}
            allowUpdateParams={actionAllowed("component:updateParams")}
            onCommand={command => void runCommand(command)}
          />
        </div>
      </div>
    </div>
  );
}
