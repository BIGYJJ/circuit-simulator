import { useState } from "react";
import type { CircuitProjectV2, Diagnostic } from "../../domain/project/project-v2";
import type { SuccessfulRunRecord, TerminalRunRecord } from "../../simulation/contracts";
import { adoptImportedRun } from "../../storage/indexeddb";
import { adoptRunPreview, parseFluxRun, readImportText, serializeCir, serializeFluxProject, serializeFluxRun, serializeVectorsCsv } from "../../storage/project-files";

interface ExportMenuProps {
  project: CircuitProjectV2;
  selectedRun: SuccessfulRunRecord | null;
  records: TerminalRunRecord[];
  onImported?: () => void;
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ExportMenu({ project, selectedRun, records, onImported }: ExportMenuProps) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const terminal = selectedRun ?? records.at(-1) ?? null;

  async function exportProject() {
    const result = await serializeFluxProject(project);
    if (!result.ok) {
      setDiagnostics(result.diagnostics);
      return;
    }
    download(`${project.id}.fluxproj.json`, result.value, "application/json");
  }

  async function exportRun(mode: "full" | "omitted") {
    if (!terminal) return;
    const result = await serializeFluxRun(terminal, mode);
    if (!result.ok) {
      setDiagnostics(result.diagnostics);
      return;
    }
    download(`${terminal.runId}.${mode}.fluxrun.json`, result.value, "application/json");
  }

  async function exportCir() {
    const analysisId = project.analyses[0]?.id;
    if (!analysisId) return;
    const result = await serializeCir(project, analysisId);
    if (!result.ok) {
      setDiagnostics(result.diagnostics);
      return;
    }
    download(`${project.id}.cir`, result.value, "text/plain");
  }

  function exportCsv() {
    if (!selectedRun) return;
    const result = serializeVectorsCsv(selectedRun, selectedRun.snapshot.vectors.map(item => item.id));
    if (!result.ok) {
      setDiagnostics(result.diagnostics);
      return;
    }
    download(`${selectedRun.runId}.csv`, result.value, "text/csv");
  }

  return (
    <section className="export-menu" data-testid="export-menu">
      <h2>导出</h2>
      <button type="button" onClick={() => void exportProject()}>
        导出项目
      </button>
      <button type="button" onClick={() => void exportRun("full")} disabled={!terminal}>
        导出运行
      </button>
      <button type="button" onClick={() => void exportRun("omitted")} disabled={!terminal}>
        导出运行引用
      </button>
      <button type="button" onClick={() => void exportCir()}>
        导出 CIR
      </button>
      <button type="button" onClick={exportCsv} disabled={!selectedRun}>
        导出 CSV
      </button>
      <label>
        导入运行
        <input
          data-testid="import-run-file"
          type="file"
          accept=".json,.fluxrun"
          onChange={event => {
            const file = event.target.files?.[0];
            if (!file) return;
            void (async () => {
              const text = await readImportText(file, "fluxrun");
              if (!text.ok) {
                setDiagnostics(text.diagnostics);
                return;
              }
              const parsed = await parseFluxRun(text.value);
              if (!parsed.ok) {
                setDiagnostics(parsed.diagnostics);
                return;
              }
              const adopted = await adoptRunPreview(parsed.value, project);
              if (!adopted.ok) {
                setDiagnostics(adopted.diagnostics);
                return;
              }
              const stored = await adoptImportedRun(adopted.value);
              if (!stored.ok) {
                setDiagnostics(stored.diagnostics);
                return;
              }
              onImported?.();
            })();
          }}
        />
      </label>
      {diagnostics.map(item => (
        <p key={item.code} data-testid="export-diagnostic">
          {item.code}
        </p>
      ))}
    </section>
  );
}
