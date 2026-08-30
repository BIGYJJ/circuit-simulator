/**
 * 精密实验档案：求解器只接受版本化电路模型并返回数值证据，绝不依赖画布坐标或界面状态。
 * 首期刻意限定为可验证的线性直流分压器；复杂 MNA/瞬态分析将在保持此接口的前提下演进。
 */

import {
  type CircuitComponent,
  type CircuitDocument,
  type CircuitPortName,
  validateDocument,
} from "./circuit-model";

export interface DividerSolution {
  sourceVoltage: number;
  rHigh: CircuitComponent;
  rLow: CircuitComponent;
  vout: number;
  current: number;
  rHighPower: number;
  rLowPower: number;
}

export type SimulationResult =
  | { success: true; solution: DividerSolution; warnings: string[] }
  | { success: false; diagnostics: string[] };

class DisjointSet {
  private parent = new Map<string, string>();

  constructor(keys: string[]) {
    keys.forEach((key) => this.parent.set(key, key));
  }

  find(key: string): string {
    const parent = this.parent.get(key);
    if (!parent) return key;
    if (parent === key) return key;
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

function endpointKey(componentId: string, port: CircuitPortName) {
  return `${componentId}:${port}`;
}

function portKey(component: CircuitComponent, port: CircuitPortName) {
  return endpointKey(component.id, port);
}

export function solveVoltageDivider(document: CircuitDocument): SimulationResult {
  const structuralErrors = validateDocument(document);
  if (structuralErrors.length > 0) return { success: false, diagnostics: structuralErrors };

  const source = document.components.find((component) => component.kind === "voltageSource");
  const ground = document.components.find((component) => component.kind === "ground");
  const resistors = document.components.filter((component) => component.kind === "resistor");

  if (!source) return { success: false, diagnostics: ["未找到直流电压源。请添加一个 VDC 元件。"] };
  if (!ground) return { success: false, diagnostics: ["未找到参考地。添加 GND 后即可建立可求解的节点电压。"] };
  if (resistors.length < 2) {
    return { success: false, diagnostics: ["分压实验至少需要两个已连接的电阻。"] };
  }
  if (source.value === undefined || !Number.isFinite(source.value)) {
    return { success: false, diagnostics: [`${source.label} 的电压值无效。`] };
  }

  const componentById = new Map(document.components.map((component) => [component.id, component]));
  const keys = document.components.flatMap((component) =>
    component.kind === "ground"
      ? [portKey(component, "top")]
      : [portKey(component, "top"), portKey(component, "bottom")],
  );
  const nets = new DisjointSet(keys);

  for (const wire of document.wires) {
    if (componentById.has(wire.from.componentId) && componentById.has(wire.to.componentId)) {
      nets.union(endpointKey(wire.from.componentId, wire.from.port), endpointKey(wire.to.componentId, wire.to.port));
    }
  }

  const connected = (
    left: CircuitComponent,
    leftPort: CircuitPortName,
    right: CircuitComponent,
    rightPort: CircuitPortName,
  ) => nets.find(portKey(left, leftPort)) === nets.find(portKey(right, rightPort));

  const rHigh = resistors.find((resistor) => connected(resistor, "top", source, "top"));
  const rLow = resistors.find(
    (resistor) => resistor.id !== rHigh?.id && connected(resistor, "bottom", ground, "top"),
  );

  if (!rHigh || !rLow || !connected(rHigh, "bottom", rLow, "top")) {
    return {
      success: false,
      diagnostics: [
        "未形成完整分压支路。请确认 V1 顶端接 R1、R1 与 R2 中点相连、R2 下端接地。",
      ],
    };
  }

  if (!connected(source, "bottom", ground, "top")) {
    return {
      success: false,
      diagnostics: ["电源回路未连接到参考地。将 V1 负端接至 GND 后再运行。"],
    };
  }

  const rHighValue = rHigh.value ?? 0;
  const rLowValue = rLow.value ?? 0;
  const totalResistance = rHighValue + rLowValue;
  if (totalResistance <= 0) {
    return { success: false, diagnostics: ["总电阻必须大于 0 Ω。"] };
  }

  const current = source.value / totalResistance;
  const vout = current * rLowValue;
  const warnings = document.components.length > 4 ? ["未接入分压主支路的元件未参与本次 DC 求解。"] : [];

  return {
    success: true,
    solution: {
      sourceVoltage: source.value,
      rHigh,
      rLow,
      vout,
      current,
      rHighPower: current * current * rHighValue,
      rLowPower: current * current * rLowValue,
    },
    warnings,
  };
}
