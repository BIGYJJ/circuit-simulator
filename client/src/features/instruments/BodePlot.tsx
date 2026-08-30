import type { SuccessfulRunRecord } from "../../simulation/contracts";

interface BodePlotProps {
  run: SuccessfulRunRecord;
}

export default function BodePlot({ run }: BodePlotProps) {
  const axis = run.snapshot.axes[0];
  const db = run.snapshot.vectors.find(item => item.projection === "db20");
  const phase = run.snapshot.vectors.find(item => item.projection === "phase");
  const hasNegInf = Boolean(db && [...db.values].some(value => value === Number.NEGATIVE_INFINITY));
  return (
    <svg viewBox="0 0 320 140" role="img" aria-label={`Bode ${run.runId}`}>
      <title>Bode</title>
      <desc>{`db20 ${db?.label ?? ""} phase ${phase?.label ?? ""} on ${axis?.unit ?? "Hz"}${hasNegInf ? " −∞" : ""}`}</desc>
      <text x="8" y="20" fill="currentColor" fontSize="10">
        {db ? `db20 points ${db.values.length}` : "no db20"}
      </text>
      <text x="8" y="40" fill="currentColor" fontSize="10">
        {phase ? `phase points ${phase.values.length}` : "no phase"}
      </text>
      {hasNegInf ? (
        <text x="8" y="60" fill="currentColor" fontSize="10">
          −∞
        </text>
      ) : null}
    </svg>
  );
}
