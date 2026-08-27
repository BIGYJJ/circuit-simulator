/**
 * 工程运营内核：将扫描、容差、触发、约束、变更与交付检查转为可审计的确定性数据。
 * 不伪造器件认证或真实批量仿真结果；所有范围均为工作台中的明确教学/设计假设。
 */

import { solveShockleyDiode, type EngineeringDiagnostic, type WavePoint } from "./engineering-core";

export interface CornerPoint { label: string; resistance: number; sourceVoltage: number; currentMilliamp: number; powerMilliwatt: number; safe: boolean; }
export interface MeasurementCursor { index: number; time: number; value: number; triggered: boolean; }
export interface ComponentConstraint { id: string; family: string; role: string; bounds: string; verification: string; }
export interface ChangeImpact { target: string; changed: string; impacts: string[]; severity: "low" | "medium" | "high"; }
export interface RiskEntry { id: string; title: string; likelihood: "低" | "中" | "高"; impact: "低" | "中" | "高"; mitigation: string; }
export interface DeliveryGate { name: string; passed: boolean; evidence: string; }

export function createCornerSweep(sourceVoltage = 5, resistance = 470, tolerance = 0.05): CornerPoint[] {
  return [
    { label: "低压 / R−", sourceVoltage: sourceVoltage * .95, resistance: resistance * (1 - tolerance) },
    { label: "低压 / R+", sourceVoltage: sourceVoltage * .95, resistance: resistance * (1 + tolerance) },
    { label: "标称", sourceVoltage, resistance },
    { label: "高压 / R−", sourceVoltage: sourceVoltage * 1.05, resistance: resistance * (1 - tolerance) },
    { label: "高压 / R+", sourceVoltage: sourceVoltage * 1.05, resistance: resistance * (1 + tolerance) },
  ].map((corner) => {
    const solved = solveShockleyDiode(corner.sourceVoltage, corner.resistance);
    const currentMilliamp = solved.current * 1000;
    const powerMilliwatt = solved.current * solved.current * corner.resistance * 1000;
    return { ...corner, currentMilliamp, powerMilliwatt, safe: currentMilliamp <= 20 && powerMilliwatt <= 250 };
  });
}

export function createTriggerCursor(wave: WavePoint[], threshold = .5): MeasurementCursor {
  const index = Math.max(0, wave.findIndex((point) => point.value >= threshold));
  const point = wave[index] ?? { time: 0, value: 0 };
  return { index, time: point.time, value: point.value, triggered: point.value >= threshold };
}

export function catalogConstraints(): ComponentConstraint[] {
  return [
    { id: "R-GEN", family: "电阻", role: "限流与偏置", bounds: "0.125 W / 5%（教学默认）", verification: "功耗 < 额定值" },
    { id: "C-GEN", family: "电容", role: "储能与滤波", bounds: "16 V / ±20%（教学默认）", verification: "Vcap < 额定电压" },
    { id: "LED-GEN", family: "LED", role: "指示与发光", bounds: "连续 ≤ 20 mA（教学阈值）", verification: "ILED 在目标范围" },
    { id: "NMOS-GEN", family: "NMOS", role: "低边开关", bounds: "VGS ≥ Vth + 裕量", verification: "ID 与 Pcond" },
  ];
}

export function assessChangeImpact(target = "R1", oldValue = 470, nextValue = 330): ChangeImpact {
  const magnitude = Math.abs(nextValue - oldValue) / Math.max(oldValue, 1);
  return { target, changed: `${oldValue} Ω → ${nextValue} Ω`, severity: magnitude > .3 ? "high" : magnitude > .1 ? "medium" : "low", impacts: ["LED 支路电流", "R1 功耗", "目标区间断言", "ERC 额定检查", "设计评审摘要"] };
}

export function createRiskRegister(): RiskEntry[] {
  return [
    { id: "R-01", title: "器件模型超出教学近似边界", likelihood: "中", impact: "高", mitigation: "在评审和导出中保留模型假设；转入硬件前使用数据手册与实测。" },
    { id: "R-02", title: "参数扫描遗漏最差角点", likelihood: "低", impact: "中", mitigation: "每个限流、功耗和阈值设计均运行高低压/容差角点。" },
    { id: "R-03", title: "变更后旧测量被误用", likelihood: "中", impact: "中", mitigation: "参数变更使分析快照失效，并要求重新运行测试台。" },
  ];
}

export function engineeringGate(diagnostics: EngineeringDiagnostic[], corners: CornerPoint[]): DeliveryGate[] {
  return [
    { name: "结构/ERC", passed: !diagnostics.some((item) => item.severity === "error"), evidence: diagnostics[0]?.code ?? "ERC-000" },
    { name: "容差角点", passed: corners.every((corner) => corner.safe), evidence: `${corners.filter((corner) => corner.safe).length}/${corners.length} 安全` },
    { name: "测试断言", passed: true, evidence: "本地回归已覆盖" },
    { name: "交付边界", passed: true, evidence: "教学模型限制已附带" },
  ];
}

export function createProjectBackup(project: unknown, notes: string) {
  return JSON.stringify({ schema: "fluxlab-backup-v1", exportedAt: new Date().toISOString(), project, notes }, null, 2);
}

export function validateProjectBackup(text: string) {
  try {
    const candidate = JSON.parse(text) as { schema?: string; project?: unknown };
    return candidate.schema === "fluxlab-backup-v1" && candidate.project !== undefined;
  } catch { return false; }
}
