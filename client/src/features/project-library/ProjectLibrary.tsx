import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { createDividerTemplate } from "../../domain/project/templates";
import type { Diagnostic } from "../../domain/project/project-v2";
import { listProjects, saveProject, type ProjectSummary } from "../../storage/indexeddb";

export default function ProjectLibrary() {
  const [, navigate] = useLocation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [busy, setBusy] = useState(false);

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

  async function createDivider() {
    setBusy(true);
    const createdAt = new Date().toISOString();
    const template = await createDividerTemplate(crypto.randomUUID(), createdAt);
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
        <button type="button" onClick={() => void createDivider()} disabled={busy}>
          新建分压项目
        </button>
        {diagnostics.map(item => (
          <p key={item.code} className="library-diagnostic">
            {item.code}
          </p>
        ))}
        <ul className="library-list">
          {projects.map(project => (
            <li key={project.projectId}>
              <Link href={`/project/${project.projectId}`}>{project.title}</Link>
              <span>{`修订 ${project.revision}`}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
