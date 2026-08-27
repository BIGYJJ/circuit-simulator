/**
 * 精密实验档案：本模块只描述电路事实，不承载画布像素、React 状态或仿真结果。
 * 这种边界保证布局调整不会改变电气拓扑，并为后续网表、导入导出和协作留出空间。
 */

export const CIRCUIT_DOCUMENT_VERSION = 1 as const;

export type ComponentKind = "voltageSource" | "resistor" | "capacitor" | "switch" | "ground";

export type CircuitPortName = "top" | "bottom";

export interface CircuitComponent {
  id: string;
  kind: ComponentKind;
  label: string;
  x: number;
  y: number;
  value?: number;
  initialValue?: number;
  closed?: boolean;
}

export interface WireEndpoint {
  componentId: string;
  port: CircuitPortName;
}

export interface CircuitWire {
  id: string;
  from: WireEndpoint;
  to: WireEndpoint;
}

export interface CircuitDocument {
  version: typeof CIRCUIT_DOCUMENT_VERSION;
  name: string;
  components: CircuitComponent[];
  wires: CircuitWire[];
  updatedAt: string;
}

export const storageKey = "circuit-simulator:active-document";

export const componentKinds: Record<ComponentKind, { title: string; defaultLabel: string; defaultValue?: number; unit?: string }> = {
  voltageSource: { title: "直流电压源", defaultLabel: "V1", defaultValue: 9, unit: "V" },
  resistor: { title: "电阻", defaultLabel: "R", defaultValue: 1000, unit: "Ω" },
  capacitor: { title: "电容", defaultLabel: "C", defaultValue: 100e-6, unit: "F" },
  switch: { title: "开关", defaultLabel: "S" },
  ground: { title: "参考地", defaultLabel: "GND" },
};

export function createVoltageDividerDocument(): CircuitDocument {
  return {
    version: CIRCUIT_DOCUMENT_VERSION,
    name: "9V 分压器实验",
    updatedAt: new Date().toISOString(),
    components: [
      { id: "V1", kind: "voltageSource", label: "V1", x: 220, y: 285, value: 9 },
      { id: "R1", kind: "resistor", label: "R1", x: 490, y: 215, value: 1000 },
      { id: "R2", kind: "resistor", label: "R2", x: 490, y: 390, value: 2000 },
      { id: "GND", kind: "ground", label: "GND", x: 490, y: 545 },
    ],
    wires: [
      { id: "w1", from: { componentId: "V1", port: "top" }, to: { componentId: "R1", port: "top" } },
      { id: "w2", from: { componentId: "R1", port: "bottom" }, to: { componentId: "R2", port: "top" } },
      { id: "w3", from: { componentId: "R2", port: "bottom" }, to: { componentId: "GND", port: "top" } },
      { id: "w4", from: { componentId: "GND", port: "top" }, to: { componentId: "V1", port: "bottom" } },
    ],
  };
}

export function createRCChargeDocument(): CircuitDocument {
  return {
    version: CIRCUIT_DOCUMENT_VERSION,
    name: "RC 充电实验",
    updatedAt: new Date().toISOString(),
    components: [
      { id: "V1", kind: "voltageSource", label: "V1", x: 230, y: 328, value: 5 },
      { id: "S1", kind: "switch", label: "S1", x: 400, y: 190, closed: true },
      { id: "R1", kind: "resistor", label: "R1", x: 560, y: 280, value: 10000 },
      { id: "C1", kind: "capacitor", label: "C1", x: 560, y: 435, value: 100e-6, initialValue: 0 },
      { id: "GND", kind: "ground", label: "GND", x: 560, y: 565 },
    ],
    wires: [
      { id: "w1", from: { componentId: "V1", port: "top" }, to: { componentId: "S1", port: "top" } },
      { id: "w2", from: { componentId: "S1", port: "bottom" }, to: { componentId: "R1", port: "top" } },
      { id: "w3", from: { componentId: "R1", port: "bottom" }, to: { componentId: "C1", port: "top" } },
      { id: "w4", from: { componentId: "C1", port: "bottom" }, to: { componentId: "GND", port: "top" } },
      { id: "w5", from: { componentId: "GND", port: "top" }, to: { componentId: "V1", port: "bottom" } },
    ],
  };
}

export function getComponentPorts(component: CircuitComponent): CircuitPortName[] {
  return component.kind === "ground" ? ["top"] : ["top", "bottom"];
}

export function findOpenEndpoints(document: CircuitDocument): WireEndpoint[] {
  const connected = new Set<string>();
  for (const wire of document.wires) {
    connected.add(`${wire.from.componentId}:${wire.from.port}`);
    connected.add(`${wire.to.componentId}:${wire.to.port}`);
  }
  return document.components.flatMap((component) =>
    getComponentPorts(component)
      .filter((port) => !connected.has(`${component.id}:${port}`))
      .map((port) => ({ componentId: component.id, port })),
  );
}

export function cloneDocument(document: CircuitDocument): CircuitDocument {
  return JSON.parse(JSON.stringify(document)) as CircuitDocument;
}

export function updateDocument(document: CircuitDocument, changes: Partial<CircuitDocument>): CircuitDocument {
  return { ...document, ...changes, updatedAt: new Date().toISOString() };
}

export function validateDocument(document: CircuitDocument): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const components = new Map(document.components.map((component) => [component.id, component]));

  if (document.version !== CIRCUIT_DOCUMENT_VERSION) errors.push("当前项目格式版本不受支持。");

  for (const component of document.components) {
    if (ids.has(component.id)) errors.push(`元件 ID 重复：${component.id}。`);
    ids.add(component.id);
    if ((component.kind === "resistor" || component.kind === "capacitor") && (!component.value || component.value <= 0)) {
      errors.push(component.kind === "resistor" ? `${component.label} 的阻值必须大于 0 Ω。` : `${component.label} 的容值必须大于 0 F。`);
    }
    if (component.kind === "voltageSource" && component.value === undefined) errors.push(`${component.label} 缺少电压值。`);
  }

  for (const wire of document.wires) {
    for (const endpoint of [wire.from, wire.to]) {
      const component = components.get(endpoint.componentId);
      if (!component) errors.push(`导线 ${wire.id} 连接到不存在的元件 ${endpoint.componentId}。`);
      else if (!getComponentPorts(component).includes(endpoint.port)) errors.push(`导线 ${wire.id} 使用了 ${component.label} 不存在的端口。`);
    }
  }
  return errors;
}

export function parseStoredDocument(raw: string | null): CircuitDocument | null {
  if (!raw) return null;
  try {
    const candidate = JSON.parse(raw) as CircuitDocument;
    return validateDocument(candidate).length === 0 ? candidate : null;
  } catch {
    return null;
  }
}
