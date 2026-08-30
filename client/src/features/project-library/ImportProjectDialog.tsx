import { useState } from "react";
import type { CircuitProjectV2, Diagnostic } from "../../domain/project/project-v2";
import {
  adoptProjectPreview,
  parseCirProject,
  parseFluxProject,
  parseV1Project,
  readImportText,
  type ProjectImportPreview,
} from "../../storage/project-files";
import { saveProject } from "../../storage/indexeddb";

interface ImportProjectDialogProps {
  onAdopted: (project: CircuitProjectV2) => void;
}

export default function ImportProjectDialog({ onAdopted }: ImportProjectDialogProps) {
  const [preview, setPreview] = useState<ProjectImportPreview | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const kind = file.name.endsWith(".cir") ? "cir" : "fluxproj";
    const text = await readImportText(file, kind);
    if (!text.ok) {
      setDiagnostics(text.diagnostics);
      setPreview(null);
      setBusy(false);
      return;
    }
    const parsed = file.name.endsWith(".json") && text.value.includes("schemaVersion") && !text.value.includes("fluxproj")
      ? await parseV1Project(JSON.parse(text.value), { projectId: crypto.randomUUID(), migratedAt: new Date().toISOString() })
      : kind === "cir"
        ? await parseCirProject(text.value, { projectId: crypto.randomUUID(), createdAt: new Date().toISOString() })
        : await parseFluxProject(text.value);
    if (!parsed.ok) {
      setDiagnostics(parsed.diagnostics);
      setPreview(null);
      setBusy(false);
      return;
    }
    setPreview(parsed.value);
    setDiagnostics(parsed.diagnostics);
    setBusy(false);
  }

  async function adopt() {
    if (!preview) return;
    setBusy(true);
    const adopted = await adoptProjectPreview(preview, null, new Date().toISOString(), "create");
    if (!adopted.ok) {
      setDiagnostics(adopted.diagnostics);
      setBusy(false);
      return;
    }
    const saved = await saveProject(null, adopted.value);
    if (!saved.ok) {
      setDiagnostics(saved.diagnostics);
      setBusy(false);
      return;
    }
    setBusy(false);
    onAdopted(saved.value);
  }

  return (
    <section className="import-dialog" data-testid="import-project">
      <h2>导入项目</h2>
      <input
        data-testid="import-file"
        type="file"
        accept=".json,.fluxproj,.cir"
        onChange={event => void onFile(event.target.files?.[0])}
      />
      {preview ? (
        <div data-testid="import-preview">
          <p>{`${preview.format} · ${preview.title}`}</p>
          <p data-testid="import-counts">{`${preview.counts.components} 元件 · ${preview.counts.analyses} 分析 · ${preview.counts.probes} 探针`}</p>
          <p data-testid="import-models">{preview.models.map(item => item.sha256).join(" ")}</p>
          {preview.discardedEvidence ? <p>已丢弃旧学习证据</p> : null}
          <button type="button" data-testid="adopt-import" disabled={busy || preview.blockers.some(item => item.code !== "CIR_NO_ANALYSIS")} onClick={() => void adopt()}>
            采用
          </button>
        </div>
      ) : null}
      {diagnostics.map(item => (
        <p key={`${item.code}-${item.message}`} data-testid="import-diagnostic">
          {item.code}
        </p>
      ))}
    </section>
  );
}
