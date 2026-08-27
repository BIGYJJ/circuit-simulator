/** 将瞬态样本映射为教学上可解释的时间事件，而非额外的仿真数据。 */

import type { RCChargeSolution } from "./rc-charge-solver";

export interface TimeMilestone {
  id: "start" | "tau1" | "tau2" | "tau5";
  time: number;
  title: string;
  description: string;
}

export function createTimeMilestones(solution: RCChargeSolution): TimeMilestone[] {
  const charging = solution.mode === "charge";
  const noun = charging ? "充至" : "剩余";
  return [
    { id: "start", time: 0, title: charging ? "开关闭合" : "开始放电", description: charging ? "电容从初始电压开始响应，支路电流达到最大。" : "储存在电容中的能量开始经电阻释放。" },
    { id: "tau1", time: solution.timeConstant, title: "经过 1τ", description: `${noun}约 ${charging ? "63.2%" : "36.8%"} 的电压变化；电流已显著下降。` },
    { id: "tau2", time: solution.timeConstant * 2, title: "经过 2τ", description: `${noun}约 ${charging ? "86.5%" : "13.5%"} 的电压变化。` },
    { id: "tau5", time: solution.timeConstant * 5, title: "经过 5τ", description: charging ? "已接近稳态，可视为充电完成。" : "剩余电压已接近 0 V，可视为放电完成。" },
  ];
}
