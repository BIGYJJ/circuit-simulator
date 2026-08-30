import { useEffect, useReducer, useRef, useState } from "react";
import { Link } from "wouter";
import { APP_BUILD_ID } from "./build-info";
import type { CircuitProjectV2, ComponentId, Diagnostic } from "../domain/project/project-v2";
import DiagnosticsPanel from "../features/analysis/DiagnosticsPanel";
import ProvenanceInspector from "../features/analysis/ProvenanceInspector";
import RunControls from "../features/analysis/RunControls";
import RunHistory from "../features/analysis/RunHistory";
import ComponentPalette from "../features/editor/ComponentPalette";
import PropertiesPanel from "../features/editor/PropertiesPanel";
import SchematicCanvas from "../features/editor/SchematicCanvas";
import { isElectricalCommand, projectReducer, type ProjectCommand } from "../features/editor/project-reducer";
import type { RunRecord, SuccessfulRunRecord } from "../simulation/contracts";
import { compileNetlist } from "../simulation/compile-netlist";
import { PINNED_ENGINE, SimulationController } from "../simulation/simulation-controller";
import { checkRunFreshness } from "../simulation/run-record";
import {
  createProjectSaveLane,
  listRuns,
  loadProject,
  loadRun,
  recoverInterruptedRuns,
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

export default function ProjectWorkspace({ projectId }: ProjectWorkspaceProps) {
  const [loadError, setLoadError] = useState<Diagnostic[] | null>(null);
  const [selectedId, setSelectedId] = useState<ComponentId | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<ProjectSaveState | null>(null);
  const [ready, setReady] = useState(false);
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<SuccessfulRunRecord | null>(null);
  const [fresh, setFresh] = useState(false);
  const [running, setRunning] = useState(false);
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
  const analysisId = editor.present.analyses.find(item => item.kind === "dc-op")?.id ?? editor.present.analyses[0]?.id ?? null;
  const saveBusy = saveState?.status === "saving" || saveState?.status === "dirty";

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
    let cancelled = false;
    allowEnqueue.current = false;
    setReady(false);
    setLoadError(null);
    void loadProject(projectId).then(result => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.diagnostics);
        return;
      }
      if (!result.value) {
        setLoadError([{ severity: "error", code: "STORAGE_NOT_FOUND", message: "project not found", blocksRun: true }]);
        return;
      }
      dispatch({ type: "load", project: result.value });
      laneRef.current?.dispose();
      const lane = createProjectSaveLane({
        persist: (expected, project) => saveProject(expected, project),
        onState: setSaveState,
        persistedRevision: result.value.revision,
      });
      laneRef.current = lane;
      setSaveState({ status: "saved", latestRevision: result.value.revision, persistedRevision: result.value.revision });
      setReady(true);
    });
    return () => {
      cancelled = true;
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

  async function refreshRuns(preferId?: string) {
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
    setSelectedRun(preferred ?? successes.at(-1) ?? null);
  }

  useEffect(() => {
    if (ready) void refreshRuns();
  }, [ready, projectId]);

  useEffect(() => {
    let cancelled = false;
    const analysis = editor.present.analyses.find(item => item.id === analysisId);
    if (!analysis) {
      setPreviewDiagnostics([]);
      return;
    }
    void compileNetlist({ project: editor.present, analysis }).then(result => {
      if (!cancelled) setPreviewDiagnostics(result.diagnostics);
    });
    return () => {
      cancelled = true;
    };
  }, [editor.present, analysisId]);

  useEffect(() => {
    if (!selectedRun) {
      setFresh(false);
      return;
    }
    let cancelled = false;
    void checkRunFreshness({
      run: selectedRun,
      project: editor.present,
      appBuildId: APP_BUILD_ID,
      engine: PINNED_ENGINE,
    }).then(result => {
      if (!cancelled && result.ok) setFresh(result.value.fresh);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRun, editor.present]);

  async function runCommand(command: ProjectCommand) {
    if (isElectricalCommand(command) && running) {
      await controllerRef.current?.cancel("project-changed");
      setRunning(false);
    }
    dispatch({ type: "command", command, changedAt: new Date().toISOString() });
  }

  async function onRun() {
    if (!analysisId || !controllerRef.current) return;
    setRunning(true);
    setRunDiagnostics([]);
    const result = await controllerRef.current.run({ project: editor.present, analysisId });
    setRunning(false);
    if (result.status === "not-started") {
      setRunDiagnostics(result.diagnostics);
      return;
    }
    await refreshRuns(result.status === "success" ? result.runId : undefined);
  }

  const lastFailed = [...records].reverse().find(item => item.status === "failed");
  const currentEnough = Boolean(selectedRun && fresh && selectedRun.electricalRevision === editor.present.electricalRevision);
  const statusLabel = running
    ? "运行中"
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
        <ComponentPalette project={editor.present} onCommand={command => void runCommand(command)} />
        <SchematicCanvas
          project={editor.present}
          selectedId={selectedId}
          selectedWireId={selectedWireId}
          onSelect={setSelectedId}
          onSelectWire={setSelectedWireId}
          onCommand={command => void runCommand(command)}
        />
        <div className="workspace-rail">
          <RunControls
            project={editor.present}
            analysisId={analysisId}
            statusLabel={statusLabel}
            running={running}
            saveBusy={Boolean(saveBusy)}
            blockers={previewDiagnostics.filter(item => item.blocksRun)}
            onRun={() => void onRun()}
            onCancel={() => {
              void controllerRef.current?.cancel("user").then(() => setRunning(false));
            }}
          />
          <p data-testid="vout-value">{selectedRun ? voltageOf(selectedRun) : "—"}</p>
          <p data-testid="vout-current-value">{selectedRun && currentEnough ? voltageOf(selectedRun) : "尚无当前结果"}</p>
          <p data-testid="current-R1">{selectedRun ? currentOf(selectedRun, "R1") : "—"}</p>
          <p data-testid="current-R2">{selectedRun ? currentOf(selectedRun, "R2") : "—"}</p>
          <p data-testid="current-R3">{selectedRun ? currentOf(selectedRun, "R3") : "—"}</p>
          {lastFailed && lastFailed.status === "failed" ? (
            <p data-testid="run-failure-message">{lastFailed.failure.message}</p>
          ) : null}
          <RunHistory records={records} selectedId={selectedRun?.runId ?? null} onSelect={setSelectedRun} />
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
            onCommand={command => void runCommand(command)}
          />
        </div>
      </div>
    </div>
  );
}
