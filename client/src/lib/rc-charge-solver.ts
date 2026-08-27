/**
 * 精密实验档案：本模块实现可验证的理想 RC 充电黄金基线，和线性 DC 求解器保持独立。
 * 它采用解析式生成固定采样快照；后续统一 MNA 瞬态内核必须以本结果作为回归参照。
 */

import { type CircuitComponent, type CircuitDocument, type CircuitPortName, validateDocument } from "./circuit-model";

export interface RCChargeSample {
  time: number;
  capacitorVoltage: number;
  current: number;
}

export interface RCChargeSolution {
  sourceVoltage: number;
  resistor: CircuitComponent;
  capacitor: CircuitComponent;
  timeConstant: number;
  duration: number;
  samples: RCChargeSample[];
}

export type RCChargeResult =
  | { success: true; solution: RCChargeSolution; warnings: string[] }
  | { success: false; diagnostics: string[] };

class DisjointSet {
  private parent = new Map<string, string>();

  constructor(keys: string[]) {
    keys.forEach((key) => this.parent.set(key, key));
  }

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

function key(component: CircuitComponent, port: CircuitPortName) {
  return `${component.id}:${port}`;
}

function buildNetworks(document: CircuitDocument) {
  const networks = new DisjointSet(
    document.components.flatMap((component) => component.kind === "ground" ? [key(component, "top")] : [key(component, "top"), key(component, "bottom")]),
  );
  for (const wire of document.wires) networks.union(`${wire.from.componentId}:${wire.from.port}`, `${wire.to.componentId}:${wire.to.port}`);
  return networks;
}

function connected(networks: DisjointSet, left: CircuitComponent, leftPort: CircuitPortName, right: CircuitComponent, rightPort: CircuitPortName) {
  return networks.find(key(left, leftPort)) === networks.find(key(right, rightPort));
}

export function solveRCCharge(document: CircuitDocument, sampleCount = 500): RCChargeResult {
  const errors = validateDocument(document);
  if (errors.length) return { success: false, diagnostics: errors };

  const source = document.components.find((component) => component.kind === "voltageSource");
  const resistor = document.components.find((component) => component.kind === "resistor");
  const capacitor = document.components.find((component) => component.kind === "capacitor");
  const ground = document.components.find((component) => component.kind === "ground");
  const circuitSwitch = document.components.find((component) => component.kind === "switch");

  if (!source || !resistor || !capacitor || !ground) {
    return { success: false, diagnostics: ["RC 充电实验需要电压源、电阻、电容和参考地。"] };
  }
  if (circuitSwitch && circuitSwitch.closed === false) {
    return { success: false, diagnostics: ["开关 S1 未闭合。闭合开关后，电容才能开始充电。"] };
  }
  if (source.value === undefined || resistor.value === undefined || capacitor.value === undefined) {
    return { success: false, diagnostics: ["RC 元件缺少可用于瞬态计算的参数。"] };
  }

  const networks = buildNetworks(document);
  const sourceToResistor = circuitSwitch
    ? connected(networks, source, "top", circuitSwitch, "top") && connected(networks, circuitSwitch, "bottom", resistor, "top")
    : connected(networks, source, "top", resistor, "top");
  const complete = sourceToResistor
    && connected(networks, resistor, "bottom", capacitor, "top")
    && connected(networks, capacitor, "bottom", ground, "top")
    && connected(networks, source, "bottom", ground, "top");
  if (!complete) {
    return { success: false, diagnostics: ["未形成完整 RC 充电回路。请确认电源、开关、电阻、电容与参考地依次闭合。"] };
  }

  const timeConstant = resistor.value * capacitor.value;
  const duration = timeConstant * 5;
  const initialVoltage = capacitor.initialValue ?? 0;
  const samples: RCChargeSample[] = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const time = (duration * index) / sampleCount;
    const exponential = Math.exp(-time / timeConstant);
    return {
      time,
      capacitorVoltage: source.value! + (initialVoltage - source.value!) * exponential,
      current: ((source.value! - initialVoltage) / resistor.value!) * exponential,
    };
  });

  return { success: true, solution: { sourceVoltage: source.value, resistor, capacitor, timeConstant, duration, samples }, warnings: [] };
}
