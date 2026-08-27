/**
 * 精密实验档案：导出函数只序列化已求解的实验事实，不生成演示性或随机数据。
 * 浏览器下载由界面层触发；本模块保持纯函数，便于测试和后续服务端导出复用。
 */

import type { CircuitDocument } from "./circuit-model";
import type { RCChargeSolution } from "./rc-charge-solver";

export function serializeCircuit(document: CircuitDocument) {
  return JSON.stringify(document, null, 2);
}

export function serializeRCTrace(solution: RCChargeSolution) {
  const header = ["time_s", "capacitor_voltage_v", "branch_current_a", "capacitor_energy_j"];
  const rows = solution.samples.map((sample) => [
    sample.time.toFixed(6),
    sample.capacitorVoltage.toFixed(9),
    sample.current.toFixed(12),
    sample.capacitorEnergy.toFixed(12),
  ].join(","));
  return [header.join(","), ...rows].join("\n");
}
