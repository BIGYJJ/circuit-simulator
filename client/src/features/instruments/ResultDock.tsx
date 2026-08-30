import { useEffect, useState } from "react";
import { evaluateMeasurement } from "../../simulation/measurements";
import type { SuccessfulRunRecord } from "../../simulation/contracts";
import BodePlot from "./BodePlot";
import Oscilloscope from "./Oscilloscope";
import ResultTable from "./ResultTable";
import RunComparison from "./RunComparison";

interface ResultDockProps {
  run: SuccessfulRunRecord | null;
  compare: SuccessfulRunRecord | null;
}

function isMonotonicRising(values: Float64Array) {
  if (values.length <= 1) return false;
  const step = values.length > 4096 ? Math.floor(values.length / 2048) : 1;
  let previous = Math.abs(values[0]!);
  for (let index = step; index < values.length; index += step) {
    const current = Math.abs(values[index]!);
    if (current + 1e-18 < previous) return false;
    previous = current;
  }
  return true;
}

export default function ResultDock({ run, compare }: ResultDockProps) {
  const [tau, setTau] = useState<string>("");
  const [fiveTau, setFiveTau] = useState<string>("");
  const [cutoff, setCutoff] = useState<string>("");

  useEffect(() => {
    if (!run) {
      setTau("");
      setFiveTau("");
      setCutoff("");
      return;
    }
    const voltage = run.snapshot.vectors.find(item => item.quantity === "voltage" && item.projection === "scalar");
    if (run.analysis.kind === "transient" && voltage) {
      const one = evaluateMeasurement(run, { function: "valueAt", vectorId: voltage.id, at: { value: 1, unit: "s" } });
      const five = evaluateMeasurement(run, { function: "valueAt", vectorId: voltage.id, at: { value: 5, unit: "s" } });
      setTau(one.ok ? one.value.value.toFixed(4) : "");
      setFiveTau(five.ok ? five.value.value.toFixed(4) : "");
    }
    if (run.analysis.kind === "ac") {
      const db = run.snapshot.vectors.find(item => item.projection === "db20");
      if (db) {
        const bandwidth = evaluateMeasurement(run, { function: "bandwidth3dB", vectorId: db.id });
        setCutoff(bandwidth.ok ? String(bandwidth.value.value) : "");
      }
    }
  }, [run]);

  if (!run) return <section data-testid="result-dock">没有选中的成功运行。</section>;

  const current = run.snapshot.vectors.find(item => item.quantity === "current");
  const modelHash = run.modelManifest[0]?.sha256 ?? run.inputBundle.models[0]?.sha256 ?? "";

  return (
    <section data-testid="result-dock" aria-label="仪器">
      <p data-testid="instrument-run-id">{run.runId}</p>
      <p data-testid="instrument-model-hash">{modelHash}</p>
      {current ? (
        <p data-testid="diode-monotonic">{isMonotonicRising(current.values) ? "单调上升" : "非单调"}</p>
      ) : null}
      {run.analysis.kind === "transient" ? (
        <>
          <p data-testid="v-1tau">{tau}</p>
          <p data-testid="v-5tau">{fiveTau}</p>
        </>
      ) : null}
      {run.analysis.kind === "ac" ? <p data-testid="ac-cutoff-hz">{cutoff}</p> : null}
      <ResultTable run={run} />
      {run.analysis.kind === "ac" ? <BodePlot run={run} /> : <Oscilloscope run={run} />}
      <RunComparison left={run} right={compare && compare.analysis.kind === run.analysis.kind ? compare : null} />
    </section>
  );
}
