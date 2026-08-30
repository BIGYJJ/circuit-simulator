import { useEffect, useState } from "react";
import { canonicalJson, sha256Hex } from "../../domain/project/canonical";
import type { SuccessfulRunRecord } from "../../simulation/contracts";

interface ProvenanceInspectorProps {
  record: SuccessfulRunRecord | null;
}

export default function ProvenanceInspector({ record }: ProvenanceInspectorProps) {
  const [computed, setComputed] = useState<{ netlist: string; vectorPlan: string; models: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!record) {
      setComputed(null);
      return;
    }
    void Promise.all([
      sha256Hex(record.inputBundle.netlist),
      sha256Hex(canonicalJson(record.vectorPlan)),
      Promise.all(record.inputBundle.models.map(model => sha256Hex(model.source))),
    ]).then(([netlist, vectorPlan, models]) => {
      if (!cancelled) setComputed({ netlist, vectorPlan, models });
    });
    return () => {
      cancelled = true;
    };
  }, [record]);

  if (!record) return <section className="workspace-provenance">没有选中的成功运行。</section>;

  const engine = record.snapshot.engine;
  const firstMap = Object.entries(record.inputBundle.sourceMap.lineToComponent)[0];

  return (
    <section className="workspace-provenance" data-testid="provenance-inspector" aria-label="来源">
      <h2>来源</h2>
      <p>{`ngspice ${engine.version} SHA-256 ${engine.moduleSha256}`}</p>
      <p data-testid="provenance-app-build">{record.appBuildId}</p>
      <p data-testid="provenance-engine-build">{engine.engineBuildId}</p>
      <p>{`项目修订 ${record.projectRevision} / 电气 ${record.electricalRevision}`}</p>
      <p data-testid="record-netlist-hash">{record.netlistHash}</p>
      <p data-testid="provenance-netlist-hash">{computed?.netlist ?? "计算中"}</p>
      <p data-testid="record-vector-plan-hash">{record.vectorPlanHash}</p>
      <p data-testid="provenance-vector-plan-hash">{computed?.vectorPlan ?? "计算中"}</p>
      {record.inputBundle.models.map((model, index) => (
        <p key={model.modelId} data-testid={`provenance-model-${model.modelId}`}>
          {`${model.generatedName} ${computed?.models[index] ?? model.sha256}`}
        </p>
      ))}
      <p>{`角点 ${record.corner?.cornerId ?? "nominal"}`}</p>
      <p>{`${record.startedAt} → ${record.finishedAt}`}</p>
      <details open>
        <summary>捕获网表</summary>
        <pre data-testid="captured-netlist">{record.inputBundle.netlist}</pre>
      </details>
      <details>
        <summary>向量计划</summary>
        <pre data-testid="captured-vector-plan">{canonicalJson(record.vectorPlan)}</pre>
      </details>
      <details open>
        <summary>源映射</summary>
        {Object.entries(record.inputBundle.sourceMap.lineToComponent).map(([line, componentId]) => (
          <p key={line} data-testid={`sourcemap-line-${line}`}>
            {`L${line} → ${componentId}`}
          </p>
        ))}
        {firstMap ? <p data-testid="sourcemap-target">{`L${firstMap[0]} → ${firstMap[1]}`}</p> : null}
      </details>
      <details>
        <summary>预检警告</summary>
        {record.preflightDiagnostics.map((item, index) => (
          <p key={`${item.phase}-${index}`}>{`${item.phase} ${item.diagnostic.code}`}</p>
        ))}
      </details>
      <details>
        <summary>引擎日志</summary>
        <pre data-testid="engine-log">{record.snapshot.log.join("\n")}</pre>
      </details>
    </section>
  );
}
