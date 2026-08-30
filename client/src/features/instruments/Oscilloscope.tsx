import type { SuccessfulRunRecord } from "../../simulation/contracts";

interface OscilloscopeProps {
  run: SuccessfulRunRecord;
}

export default function Oscilloscope({ run }: OscilloscopeProps) {
  const axis = run.snapshot.axes[0];
  const vector = run.snapshot.vectors[0];
  const path = toPath(axis?.values, vector?.values);
  const hasNegInf = Boolean(vector && [...vector.values].some(value => value === Number.NEGATIVE_INFINITY));
  return (
    <svg viewBox="0 0 320 120" role="img" aria-label={`示波器 ${run.runId}`}>
      <title>{`示波器 ${vector?.label ?? ""}`}</title>
      <desc>{`${axis?.unit ?? ""} vs ${vector?.unit ?? ""}${hasNegInf ? " −∞" : ""}`}</desc>
      <path d={path} fill="none" stroke="#27d9ef" strokeWidth="1.5" />
      {hasNegInf ? (
        <text x="8" y="16" fill="currentColor" fontSize="10">
          −∞
        </text>
      ) : null}
    </svg>
  );
}

function toPath(axis?: Float64Array, values?: Float64Array) {
  if (!axis || !values || axis.length === 0) return "";
  const minX = axis[0]!;
  const maxX = axis[axis.length - 1]!;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minY = Math.min(minY, value);
    maxY = Math.max(maxY, value);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minX === maxX) return "";
  const spanY = maxY === minY ? 1 : maxY - minY;
  return [...values]
    .map((value, index) => {
      const x = ((axis[index]! - minX) / (maxX - minX)) * 300 + 10;
      const y = 110 - ((Number.isFinite(value) ? value : minY) - minY) / spanY * 100;
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}
