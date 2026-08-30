import type { Diagnostic } from "../../domain/project/project-v2";

interface DiagnosticsPanelProps {
  diagnostics: Diagnostic[];
  preview?: boolean;
  onSelect?: (componentId: string) => void;
}

function groupOf(code: string) {
  if (code.startsWith("ERC_") || code.startsWith("GRAPH_")) return "erc";
  if (code.startsWith("COMPILE_") || code.startsWith("PROBE_") || code.startsWith("MODEL_")) return "compiler";
  if (code.startsWith("ASSERT_") || code.startsWith("MEAS_") || code.startsWith("GATE_")) return "assertion";
  if (code.startsWith("ADAPTER_") || code.startsWith("ENGINE_") || code.startsWith("RESOURCE_") || code.startsWith("RESULT_")) {
    return "engine";
  }
  return "schema";
}

export default function DiagnosticsPanel({ diagnostics, preview = false, onSelect }: DiagnosticsPanelProps) {
  const groups = ["schema", "erc", "compiler", "engine", "assertion"] as const;
  return (
    <section className="workspace-diagnostics" aria-label="诊断">
      <h2>诊断</h2>
      <div data-testid="diagnostics-live" aria-live="polite">
        {diagnostics.length === 0 ? "无诊断" : diagnostics.map(item => item.code).join(" ")}
      </div>
      {preview ? <p data-testid="compile-preview-label">未执行</p> : null}
      {groups.map(group => {
        const items = diagnostics.filter(item => groupOf(item.code) === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <h3>{group}</h3>
            {items.map((item, index) => {
              const componentId = item.location?.componentId ?? "";
              return (
                <p key={`${item.code}-${index}`} data-testid={`diagnostic-${item.code}`}>
                  {item.code}
                  {componentId ? (
                    <button type="button" onClick={() => onSelect?.(componentId)}>
                      {` · ${componentId}`}
                    </button>
                  ) : null}
                </p>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
