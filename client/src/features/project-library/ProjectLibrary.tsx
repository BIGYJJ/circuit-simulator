import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { LegacyMigrationNotice, peekLegacyNoticeSession, type LegacyPath } from "../../app/legacy-notice";
import type { CircuitProjectV2, Diagnostic, DomainResult, ProjectId } from "../../domain/project/project-v2";
import { deleteProject, listProjects, saveProject, type ProjectSummary } from "../../storage/indexeddb";

const LessonCatalog = lazy(() => import("../learning/LessonCatalog"));
const ImportProjectDialog = lazy(() => import("./ImportProjectDialog"));
const LegacyMigrationCard = lazy(() => import("./LegacyMigrationCard"));

type TemplateFactory = (projectId: string, createdAt: string) => Promise<DomainResult<CircuitProjectV2>>;

export default function ProjectLibrary() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const needProject = searchParams.get("needProject") === "1";
  const [legacyNotice, setLegacyNotice] = useState<LegacyPath | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProjectId | null>(null);

  async function refresh() {
    const result = await listProjects();
    if (result.ok) setProjects(result.value);
    else setDiagnostics(result.diagnostics);
  }

  useEffect(() => {
    setLegacyNotice(peekLegacyNoticeSession());
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void listProjects().then(result => {
      if (cancelled) return;
      if (result.ok) setProjects(result.value);
      else setDiagnostics(result.diagnostics);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createFrom(name: "divider" | "diode" | "rc" | "lowpass") {
    setBusy(true);
    const createdAt = new Date().toISOString();
    const templates = await import("../../domain/project/templates");
    const factory: TemplateFactory =
      name === "divider"
        ? templates.createDividerTemplate
        : name === "diode"
          ? templates.createDiodeSweepTemplate
          : name === "rc"
            ? templates.createRcTemplate
            : templates.createLowpassAcTemplate;
    const template = await factory(crypto.randomUUID(), createdAt);
    if (!template.ok) {
      setDiagnostics(template.diagnostics);
      setBusy(false);
      return;
    }
    const saved = await saveProject(null, template.value);
    if (!saved.ok) {
      setDiagnostics(saved.diagnostics);
      setBusy(false);
      return;
    }
    navigate(`/project/${saved.value.id}`);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setBusy(true);
    const result = await deleteProject(target);
    if (!result.ok) {
      setDiagnostics(result.diagnostics);
      setBusy(false);
      return;
    }
    setPendingDelete(null);
    await refresh();
    setBusy(false);
  }

  return (
    <main className="library-page">
      <header className="library-header">
        <p className="library-brand">
          FLUX<strong>LAB</strong>
        </p>
        <nav>
          <Link href="/settings">设置</Link>
        </nav>
      </header>
      <section>
        <h1>项目库</h1>
        <LegacyMigrationNotice path={legacyNotice} />
        {needProject ? <p data-testid="legacy-need-project">请先选择项目</p> : null}
        <button type="button" onClick={() => void createFrom("divider")} disabled={busy}>
          新建分压项目
        </button>
        <button type="button" onClick={() => void createFrom("diode")} disabled={busy}>
          新建二极管扫描
        </button>
        <button type="button" onClick={() => void createFrom("rc")} disabled={busy}>
          新建RC暂态
        </button>
        <button type="button" onClick={() => void createFrom("lowpass")} disabled={busy}>
          新建低通交流
        </button>
        <Suspense fallback={null}>
          <LessonCatalog />
          <ImportProjectDialog onAdopted={project => navigate(`/project/${project.id}`)} />
          <LegacyMigrationCard onAdopted={project => navigate(`/project/${project.id}`)} />
        </Suspense>
        {diagnostics.map(item => (
          <p key={item.code} className="library-diagnostic" data-testid="library-diagnostic">
            {item.code}
          </p>
        ))}
        <ul className="library-list">
          {projects.map(project => (
            <li key={project.projectId} data-testid={`project-row-${project.projectId}`}>
              <Link href={`/project/${project.projectId}`}>{project.title}</Link>
              <span>{`修订 ${project.revision}`}</span>
              <button
                type="button"
                data-testid={`delete-project-${project.projectId}`}
                disabled={busy}
                onClick={() => setPendingDelete(project.projectId)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
        {pendingDelete ? (
          <dialog open className="library-delete-dialog" data-testid="delete-project-dialog">
            <p>{`确认删除项目 ${pendingDelete}？此操作会一并删除其运行记录。`}</p>
            <button type="button" data-testid="cancel-delete-project" onClick={() => setPendingDelete(null)}>
              取消
            </button>
            <button type="button" data-testid="confirm-delete-project" disabled={busy} onClick={() => void confirmDelete()}>
              确认删除
            </button>
          </dialog>
        ) : null}
      </section>
    </main>
  );
}
