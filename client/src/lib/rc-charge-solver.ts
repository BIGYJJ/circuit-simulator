/**
 * 精密实验档案：本模块为理想单支路 RC 充电、保持和放电生成可验证的解析黄金基线。
 * 结果携带模式、能量和离散样本；后续 MNA 数值内核必须以其作为回归参照。
 */

import { type CircuitComponent, type CircuitDocument, type CircuitPortName, type RCSwitchMode, validateDocument } from "./circuit-model";

export interface RCChargeSample {
  time: number;
  capacitorVoltage: number;
  current: number;
  capacitorEnergy: number;
}

export interface RCChargeSolution {
  mode: RCSwitchMode;
  sourceVoltage: number;
  resistor: CircuitComponent;
  capacitor: CircuitComponent;
  timeConstant: number;
  duration: number;
  initialVoltage: number;
  targetVoltage: number;
  samples: RCChargeSample[];
}

export type RCChargeResult =
  | { success: true; solution: RCChargeSolution; warnings: string[] }
  | { success: false; diagnostics: string[] };

class DisjointSet {
  private parent = new Map<string, string>();
  constructor(keys: string[]) { keys.forEach((entry) => this.parent.set(entry, entry)); }
  find(key: string): string {
    const parent = this.parent.get(key);
    if (!parent || parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }
  union(left: string, right: string) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(leftRoot, rightRoot);
  }
}

function endpointKey(component: CircuitComponent, port: CircuitPortName) { return `${component.id}:${port}`; }
function buildNetworks(document: CircuitDocument) {
  const networks = new DisjointSet(document.components.flatMap((component) => component.kind === "ground" ? [endpointKey(component, "top")] : [endpointKey(component, "top"), endpointKey(component, "bottom")]));
  for (const wire of document.wires) networks.union(`${wire.from.componentId}:${wire.from.port}`, `${wire.to.componentId}:${wire.to.port}`);
  return networks;
}
function connected(networks: DisjointSet, left: CircuitComponent, leftPort: CircuitPortName, right: CircuitComponent, rightPort: CircuitPortName) {
  return networks.find(endpointKey(left, leftPort)) === networks.find(endpointKey(right, rightPort));
}

export function getRCMode(document: CircuitDocument): RCSwitchMode {
  const circuitSwitch = document.components.find((component) => component.kind === "switch");
  if (!circuitSwitch) return "charge";
  if (circuitSwitch.switchMode) return circuitSwitch.switchMode;
  return circuitSwitch.closed === false ? "hold" : "charge";
}

export function solveRCCharge(document: CircuitDocument, sampleCount = 500): RCChargeResult {
  const errors = validateDocument(document);
  if (errors.length) return { success: false, diagnostics: errors };
  const source = document.components.find((component) => component.kind === "voltageSource");
  const resistor = document.components.find((component) => component.kind === "resistor");
  const capacitor = document.components.find((component) => component.kind === "capacitor");
  const ground = document.components.find((component) => component.kind === "ground");
  const circuitSwitch = document.components.find((component) => component.kind === "switch");
  if (!source || !resistor || !capacitor || !ground || source.value === undefined || resistor.value === undefined || capacitor.value === undefined) {
    return { success: false, diagnostics: ["RC 实验需要带参数的电压源、电阻、电容和参考地。"] };
  }
  const mode = getRCMode(document);
  if (circuitSwitch && circuitSwitch.closed === false && mode === "charge") {
    return { success: false, diagnostics: ["开关 S1 未闭合。切换到充电或放电回路后再运行。"] };
  }
  const networks = buildNetworks(document);
  const hasChargePath = circuitSwitch
    ? connected(networks, source, "top", circuitSwitch, "top") && connected(networks, circuitSwitch, "bottom", resistor, "top")
    : connected(networks, source, "top", resistor, "top");
  const hasReturn = connected(networks, resistor, "bottom", capacitor, "top") && connected(networks, capacitor, "bottom", ground, "top") && connected(networks, source, "bottom", ground, "top");
  if (!hasReturn || (mode === "charge" && !hasChargePath)) {
    return { success: false, diagnostics: ["未形成完整 RC 回路。请确认电源、电阻、电容与参考地正确连接。"] };
  }
  const timeConstant = resistor.value * capacitor.value;
  const duration = timeConstant * 5;
  const initialVoltage = capacitor.initialValue ?? 0;
  const targetVoltage = mode === "charge" ? source.value : 0;
  const samples: RCChargeSample[] = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const time = (duration * index) / sampleCount;
    const exponential = Math.exp(-time / timeConstant);
    const capacitorVoltage = mode === "hold" ? initialVoltage : targetVoltage + (initialVoltage - targetVoltage) * exponential;
    const current = mode === "hold" ? 0 : (targetVoltage - initialVoltage) / resistor.value! * exponential;
    return { time, capacitorVoltage, current, capacitorEnergy: 0.5 * capacitor.value! * capacitorVoltage * capacitorVoltage };
  });
  const warnings = mode === "hold" ? ["开关处于保持状态；电容电压按理想模型维持不变。"] : [];
  return { success: true, solution: { mode, sourceVoltage: source.value, resistor, capacitor, timeConstant, duration, initialVoltage, targetVoltage, samples }, warnings };
}
