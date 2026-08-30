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

function downsample(axis: Float64Array, values: Float64Array, maxPoints = 1200) {
  if (values.length <= maxPoints) return { axis, values };
  const step = Math.ceil(values.length / maxPoints);
  const nextAxis = new Float64Array(Math.ceil(values.length / step));
  const nextValues = new Float64Array(nextAxis.length);
  let write = 0;
  for (let index = 0; index < values.length; index += step) {
    nextAxis[write] = axis[index]!;
    nextValues[write] = values[index]!;
    write += 1;
  }
  return { axis: nextAxis, values: nextValues };
}

function toPath(axis?: Float64Array, values?: Float64Array) {
  if (!axis || !values || axis.length === 0) return "";
  const sampled = downsample(axis, values);
  const minX = sampled.axis[0]!;
  const maxX = sampled.axis[sampled.axis.length - 1]!;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < sampled.values.length; index += 1) {
    const value = sampled.values[index]!;
    if (!Number.isFinite(value)) continue;
    minY = Math.min(minY, value);
    maxY = Math.max(maxY, value);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minX === maxX) return "";
  const spanY = maxY === minY ? 1 : maxY - minY;
  let path = "";
  for (let index = 0; index < sampled.values.length; index += 1) {
    const value = sampled.values[index]!;
    const x = ((sampled.axis[index]! - minX) / (maxX - minX)) * 300 + 10;
    const y = 110 - ((Number.isFinite(value) ? value : minY) - minY) / spanY * 100;
    path += `${index === 0 ? "M" : "L"}${x} ${y}`;
  }
  return path;
}
