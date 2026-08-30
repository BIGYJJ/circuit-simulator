/**
 * 精密实验档案：示波器只绘制 RC 求解器返回的离散时间样本，游标与画布读数共用同一索引。
 * 青蓝用于电压轨迹，萤光石灰用于当前时间游标，避免以装饰曲线替代真实求解数据。
 */

import type { RCChargeResult } from "@/lib/rc-charge-solver";
import { cn } from "@/lib/utils";

interface OscilloscopeProps {
  result: RCChargeResult | null;
  activeIndex: number;
}

function timeLabel(time: number) {
  return time < 1 ? `${(time * 1000).toFixed(0)} ms` : `${time.toFixed(1)} s`;
}

export default function Oscilloscope({ result, activeIndex }: OscilloscopeProps) {
  const isSolved = result?.success === true;
  const samples = isSolved ? result.solution.samples : [];
  const width = 840;
  const height = 176;
  const left = 62;
  const top = 20;
  const right = 18;
  const bottom = 31;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const duration = isSolved ? result.solution.duration : 5;
  const source = isSolved ? result.solution.sourceVoltage : 5;
  const index = Math.min(activeIndex, Math.max(samples.length - 1, 0));
  const cursor = samples[index];
  const point = (sample: { time: number; capacitorVoltage: number }) => ({ x: left + (sample.time / duration) * plotWidth, y: top + (1 - sample.capacitorVoltage / source) * plotHeight });
  const fullPath = samples.map((sample, sampleIndex) => `${sampleIndex ? "L" : "M"}${point(sample).x.toFixed(2)} ${point(sample).y.toFixed(2)}`).join(" ");
  const activePath = samples.slice(0, index + 1).map((sample, sampleIndex) => `${sampleIndex ? "L" : "M"}${point(sample).x.toFixed(2)} ${point(sample).y.toFixed(2)}`).join(" ");
  const cursorPoint = cursor ? point(cursor) : null;

  return <section className="oscilloscope" aria-label="Vcap 示波器">
    <div className="scope-toolbar"><div><span className="scope-dot" /><b>CH A</b><span>Vcap</span><small>1.00 V/div</small></div><div><span>时基</span><b>{isSolved ? `${(duration / 10).toFixed(1)} s/div` : "0.5 s/div"}</b><span className="scope-toolbar-divider" /><span>采样</span><b>{isSolved ? `${samples.length} 点` : "—"}</b></div></div>
    <div className="scope-plot-wrap"><svg className="scope-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {Array.from({ length: 6 }, (_, gridIndex) => <line key={`h-${gridIndex}`} className="scope-grid" x1={left} x2={width - right} y1={top + (plotHeight * gridIndex) / 5} y2={top + (plotHeight * gridIndex) / 5} />)}
      {Array.from({ length: 11 }, (_, gridIndex) => <line key={`v-${gridIndex}`} className="scope-grid" y1={top} y2={height - bottom} x1={left + (plotWidth * gridIndex) / 10} x2={left + (plotWidth * gridIndex) / 10} />)}
      {[0, 1, 2, 3, 4, 5].map((value) => <text key={value} className="scope-axis" x="18" y={top + plotHeight - (plotHeight * value) / 5 + 4}>{value} V</text>)}
      {Array.from({ length: 6 }, (_, gridIndex) => <text key={`time-${gridIndex}`} className="scope-axis" x={left + (plotWidth * gridIndex) / 5 - (gridIndex ? 11 : 0)} y={height - 10}>{gridIndex} s</text>)}
      {isSolved && <path d={fullPath} className="scope-trace-dim" />}
      {isSolved && activePath && <path d={activePath} className="scope-trace" />}
      {cursorPoint && <><line className="scope-cursor" x1={cursorPoint.x} x2={cursorPoint.x} y1={top} y2={height - bottom} /><circle className="scope-point" cx={cursorPoint.x} cy={cursorPoint.y} r="5" /><rect className="scope-cursor-label" x={Math.min(cursorPoint.x + 7, width - 80)} y="6" width="65" height="21" rx="4" /><text className="scope-cursor-text" x={Math.min(cursorPoint.x + 12, width - 75)} y="21">{timeLabel(cursor.time)}</text></>}
      {!isSolved && <text className="scope-empty-text" x={width / 2} y={height / 2}>运行 RC 实验后显示 Vcap(t)</text>}
    </svg></div>
    <div className="scope-footer"><span><i className="scope-dot" />Vcap（青蓝）</span><span>{cursor ? `当前：${cursor.capacitorVoltage.toFixed(3)} V` : "等待求解"}</span><span>{isSolved ? `τ = ${result.solution.timeConstant.toFixed(3)} s` : "理想 RC 模型"}</span></div>
  </section>;
}
