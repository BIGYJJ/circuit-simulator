/**
 * 精密实验档案：本模块使用常压降、分段线性的 LED 教学近似，而非伪装成完整 SPICE 求解。
 * 它输出可核对的串联工作点、功耗、安全裕量和故障证据，为后续非线性迭代器保留同一接口。
 */

import type { CircuitComponent, CircuitDocument } from "./circuit-model";

export type LEDFaultMode = "none" | "open" | "short" | "wrongResistor";

export interface LEDSolution {
  source: CircuitComponent;
  resistor: CircuitComponent;
  led: CircuitComponent;
  current: number;
  ledVoltage: number;
  resistorVoltage: number;
  resistorPower: number;
  ledPower: number;
  brightness: number;
  isSafe: boolean;
  targetMet: boolean;
}

export type LEDSimulationResult =
  | { success: true; solution: LEDSolution; diagnostics: string[] }
  | { success: false; diagnostics: string[] };

function requireComponent(document: CircuitDocument, kind: CircuitComponent["kind"]) {
  return document.components.find((component) => component.kind === kind);
}

export function solveLEDSeries(document: CircuitDocument, fault: LEDFaultMode = "none"): LEDSimulationResult {
  const source = requireComponent(document, "voltageSource");
  const resistor = requireComponent(document, "resistor");
  const led = requireComponent(document, "led");
  const ground = requireComponent(document, "ground");
  if (!source || !resistor || !led || !ground || source.value === undefined || resistor.value === undefined || led.value === undefined) {
    return { success: false, diagnostics: ["LED 实验需要电压源、限流电阻、LED 和参考地。"] };
  }
  if (fault === "open") {
    return { success: true, solution: { source, resistor, led, current: 0, ledVoltage: 0, resistorVoltage: 0, resistorPower: 0, ledPower: 0, brightness: 0, isSafe: true, targetMet: false }, diagnostics: ["检测到开路：支路电流为 0 mA，LED 无法获得正向偏置。"] };
  }
  const effectiveResistance = fault === "wrongResistor" ? 68 : resistor.value;
  const ledVoltage = fault === "short" ? 0 : led.forwardVoltage ?? led.value;
  const availableVoltage = source.value - ledVoltage;
  if (availableVoltage <= 0) return { success: false, diagnostics: ["源电压低于 LED 的近似正向压降，当前模型不能导通。"] };
  const current = availableVoltage / effectiveResistance;
  const resistorVoltage = current * effectiveResistance;
  const resistorPower = current * current * effectiveResistance;
  const ledPower = current * ledVoltage;
  const currentMilliamp = current * 1000;
  const isSafe = currentMilliamp <= 20 && resistorPower <= 0.25;
  const brightness = Math.max(0, Math.min(100, (currentMilliamp / 20) * 100));
  const targetMet = fault === "none" && currentMilliamp >= 8 && currentMilliamp <= 12 && isSafe;
  const diagnostics = fault === "short"
    ? ["检测到短路：LED 两端压降近似为 0 V，电流不再受 LED 正向压降约束。"]
    : fault === "wrongResistor"
      ? ["检测到错误限流值：68 Ω 将电流提升至 LED 的推荐连续工作区间之外。"]
      : isSafe
        ? ["工作点收敛：使用 LED 常压降近似，支路处于可解释的安全范围内。"]
        : ["超出教学安全阈值：请增加限流电阻或降低源电压。"];
  return { success: true, solution: { source, resistor, led, current, ledVoltage, resistorVoltage, resistorPower, ledPower, brightness, isSafe, targetMet }, diagnostics };
}
