import { useEffect, useReducer, useRef, useState } from "react";
import { Link } from "wouter";
import type { CircuitProjectV2, ComponentId, Diagnostic } from "../domain/project/project-v2";
import SchematicCanvas from "../features/editor/SchematicCanvas";
import PropertiesPanel from "../features/editor/PropertiesPanel";
import { projectReducer, type ProjectCommand } from "../features/editor/project-reducer";
import { createProjectSaveLane, loadProject, saveProject, type ProjectSaveState } from "../storage/indexeddb";

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

export default function ProjectWorkspace({ projectId }: ProjectWorkspaceProps) {
  const [loadError, setLoadError] = useState<Diagnostic[] | null>(null);
  const [selectedId, setSelectedId] = useState<ComponentId | null>(null);
  const [saveState, setSaveState] = useState<ProjectSaveState | null>(null);
  const [ready, setReady] = useState(false);
  const [editor, dispatch] = useReducer(projectReducer, {
    past: [],
    present: emptyProject(projectId),
    future: [],
    diagnostics: [],
  });
  const laneRef = useRef<ReturnType<typeof createProjectSaveLane> | null>(null);
  const allowEnqueue = useRef(false);

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

  function runCommand(command: ProjectCommand) {
    dispatch({ type: "command", command, changedAt: new Date().toISOString() });
  }

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
        <SchematicCanvas project={editor.present} selectedId={selectedId} onSelect={setSelectedId} onCommand={runCommand} />
        <PropertiesPanel project={editor.present} selectedId={selectedId} onSelect={setSelectedId} onCommand={runCommand} />
      </div>
    </div>
  );
}
