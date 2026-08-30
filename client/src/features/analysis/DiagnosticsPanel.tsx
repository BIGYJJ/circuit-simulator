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

function diagnosticIdentity(item: Diagnostic) {
  const location = item.location;
  return [
    item.code,
    item.message,
    location?.componentId ?? "",
    location?.wireId ?? "",
    location?.modelId ?? "",
    location?.analysisId ?? "",
    location?.probeId ?? "",
    location?.assertionId ?? "",
    location?.cornerId ?? "",
    location?.runId ?? "",
    location?.sourceName ?? "",
    location?.field ?? "",
    location?.line ?? "",
    location?.endLine ?? "",
  ].join("\0");
}

function uniqueDiagnostics(items: Diagnostic[]) {
  const seen = new Set<string>();
  const unique: Diagnostic[] = [];
  for (const item of items) {
    const key = diagnosticIdentity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export default function DiagnosticsPanel({ diagnostics, preview = false, onSelect }: DiagnosticsPanelProps) {
  const groups = ["schema", "erc", "compiler", "engine", "assertion"] as const;
  const visible = uniqueDiagnostics(diagnostics);
  const claimedCodes = new Set<string>();
  return (
    <section className="workspace-diagnostics" aria-label="诊断">
      <h2>诊断</h2>
      <div data-testid="diagnostics-live" aria-live="polite">
        {visible.length === 0 ? "无诊断" : visible.map(item => item.code).join(" ")}
      </div>
      {preview ? <p data-testid="compile-preview-label">未执行</p> : null}
      {groups.map(group => {
        const items = visible.filter(item => groupOf(item.code) === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <h3>{group}</h3>
            {items.map((item, index) => {
              const componentId = item.location?.componentId ?? "";
              const testId = claimedCodes.has(item.code) ? undefined : `diagnostic-${item.code}`;
              claimedCodes.add(item.code);
              return (
                <p key={`${item.code}-${index}`} data-testid={testId}>
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
