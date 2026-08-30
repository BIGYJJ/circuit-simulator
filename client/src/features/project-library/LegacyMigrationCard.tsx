import { useEffect, useState } from "react";
import type { CircuitProjectV2, Diagnostic } from "../../domain/project/project-v2";
import {
  adoptProjectPreview,
  inspectLegacyLocalStorage,
  LEGACY_PROGRESS_KEY,
  LEGACY_PROJECT_KEYS,
  parseV1Project,
} from "../../storage/project-files";
import { saveProject } from "../../storage/indexeddb";

const LABELS: Record<(typeof LEGACY_PROJECT_KEYS)[number], string> = {
  "circuit-simulator:active-document": "分压器 v1",
  "circuit-simulator:rc-charge": "RC v1",
  "circuit-simulator:led-lab": "LED v1",
};

interface LegacyMigrationCardProps {
  onAdopted: (project: CircuitProjectV2) => void;
}

export default function LegacyMigrationCard({ onAdopted }: LegacyMigrationCardProps) {
  const [present, setPresent] = useState(() => inspectLegacyLocalStorage(window.localStorage));
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [savedKeys, setSavedKeys] = useState<string[]>([]);

  useEffect(() => {
    setPresent(inspectLegacyLocalStorage(window.localStorage));
  }, []);

  async function previewAndAdopt(key: (typeof LEGACY_PROJECT_KEYS)[number]) {
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      setDiagnostics([{ severity: "error", code: "MIGRATION_INVALID_V1", message: "legacy JSON is malformed", blocksRun: true }]);
      return;
    }
    const parsed = await parseV1Project(json, { projectId: crypto.randomUUID(), migratedAt: new Date().toISOString() });
    if (!parsed.ok) {
      setDiagnostics(parsed.diagnostics);
      return;
    }
    const adopted = await adoptProjectPreview(parsed.value, null, new Date().toISOString(), "create");
    if (!adopted.ok) {
      setDiagnostics(adopted.diagnostics);
      return;
    }
    const saved = await saveProject(null, adopted.value);
    if (!saved.ok) {
      setDiagnostics(saved.diagnostics);
      return;
    }
    setSavedKeys(current => [...current, key]);
    onAdopted(saved.value);
  }

  function clearKey(key: string) {
    window.localStorage.removeItem(key);
    setPresent(inspectLegacyLocalStorage(window.localStorage));
  }

  return (
    <section className="legacy-migration" data-testid="legacy-migration">
      <h2>本地旧项目</h2>
      {present.discardedProgress ? <p data-testid="legacy-progress-discarded">旧学习进度不会导入为完成证据</p> : null}
      {LEGACY_PROJECT_KEYS.map(key =>
        present.projects.find(item => item.key === key)?.present ? (
          <div key={key} data-testid={`legacy-card-${key}`}>
            <p>{LABELS[key]}</p>
            <button type="button" data-testid={`legacy-adopt-${key}`} onClick={() => void previewAndAdopt(key)}>
              {`预览并采用 ${LABELS[key]}`}
            </button>
            <button type="button" data-testid={`legacy-clear-${key}`} disabled={!savedKeys.includes(key)} onClick={() => clearKey(key)}>
              清除此源
            </button>
          </div>
        ) : null
      )}
      {present.discardedProgress ? (
        <button type="button" data-testid="legacy-clear-progress" onClick={() => clearKey(LEGACY_PROGRESS_KEY)}>
          丢弃旧进度
        </button>
      ) : null}
      {diagnostics.map(item => (
        <p key={item.code} data-testid="legacy-diagnostic">
          {item.code}
        </p>
      ))}
    </section>
  );
}
