/**
 * 精密实验档案：本模块只描述电路事实，不承载画布像素、React 状态或仿真结果。
 * 版本化文档同时服务于分压器、RC 与 LED 学习实验，保留可扩展的元件属性边界。
 */

export const CIRCUIT_DOCUMENT_VERSION = 1 as const;
export type ComponentKind = "voltageSource" | "resistor" | "capacitor" | "switch" | "diode" | "led" | "probe" | "ground";
export type RCSwitchMode = "charge" | "hold" | "discharge";
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
  switchMode?: RCSwitchMode;
  forwardVoltage?: number;
  targetComponentId?: string;
}

export interface WireEndpoint { componentId: string; port: CircuitPortName; }
export interface CircuitWire { id: string; from: WireEndpoint; to: WireEndpoint; }
export interface CircuitDocument { version: typeof CIRCUIT_DOCUMENT_VERSION; name: string; components: CircuitComponent[]; wires: CircuitWire[]; updatedAt: string; }

export const storageKey = "circuit-simulator:active-document";
export const componentKinds: Record<ComponentKind, { title: string; defaultLabel: string; defaultValue?: number; unit?: string }> = {
  voltageSource: { title: "直流电压源", defaultLabel: "V1", defaultValue: 9, unit: "V" },
  resistor: { title: "电阻", defaultLabel: "R", defaultValue: 1000, unit: "Ω" },
  capacitor: { title: "电容", defaultLabel: "C", defaultValue: 100e-6, unit: "F" },
  switch: { title: "开关", defaultLabel: "S" },
  diode: { title: "二极管", defaultLabel: "D", defaultValue: 0.7, unit: "V" },
  led: { title: "LED", defaultLabel: "D", defaultValue: 2, unit: "V" },
  probe: { title: "测量探针", defaultLabel: "P" },
  ground: { title: "参考地", defaultLabel: "GND" },
};

export function createVoltageDividerDocument(): CircuitDocument {
  return { version: CIRCUIT_DOCUMENT_VERSION, name: "9V 分压器实验", updatedAt: new Date().toISOString(), components: [
    { id: "V1", kind: "voltageSource", label: "V1", x: 220, y: 285, value: 9 },
    { id: "R1", kind: "resistor", label: "R1", x: 490, y: 215, value: 1000 },
    { id: "R2", kind: "resistor", label: "R2", x: 490, y: 390, value: 2000 },
    { id: "GND", kind: "ground", label: "GND", x: 490, y: 545 },
  ], wires: [
    { id: "w1", from: { componentId: "V1", port: "top" }, to: { componentId: "R1", port: "top" } },
    { id: "w2", from: { componentId: "R1", port: "bottom" }, to: { componentId: "R2", port: "top" } },
    { id: "w3", from: { componentId: "R2", port: "bottom" }, to: { componentId: "GND", port: "top" } },
    { id: "w4", from: { componentId: "GND", port: "top" }, to: { componentId: "V1", port: "bottom" } },
  ] };
}

export function createRCChargeDocument(): CircuitDocument {
  return { version: CIRCUIT_DOCUMENT_VERSION, name: "RC 充电实验", updatedAt: new Date().toISOString(), components: [
    { id: "V1", kind: "voltageSource", label: "V1", x: 230, y: 328, value: 5 },
    { id: "S1", kind: "switch", label: "S1", x: 400, y: 190, closed: true, switchMode: "charge" },
    { id: "R1", kind: "resistor", label: "R1", x: 560, y: 280, value: 10000 },
    { id: "C1", kind: "capacitor", label: "C1", x: 560, y: 435, value: 100e-6, initialValue: 0 },
    { id: "GND", kind: "ground", label: "GND", x: 560, y: 565 },
  ], wires: [
    { id: "w1", from: { componentId: "V1", port: "top" }, to: { componentId: "S1", port: "top" } },
    { id: "w2", from: { componentId: "S1", port: "bottom" }, to: { componentId: "R1", port: "top" } },
    { id: "w3", from: { componentId: "R1", port: "bottom" }, to: { componentId: "C1", port: "top" } },
    { id: "w4", from: { componentId: "C1", port: "bottom" }, to: { componentId: "GND", port: "top" } },
    { id: "w5", from: { componentId: "GND", port: "top" }, to: { componentId: "V1", port: "bottom" } },
  ] };
}

export function createLEDDebugDocument(): CircuitDocument {
  return { version: CIRCUIT_DOCUMENT_VERSION, name: "LED 亮度实验", updatedAt: new Date().toISOString(), components: [
    { id: "V1", kind: "voltageSource", label: "V1", x: 230, y: 310, value: 5 },
    { id: "R1", kind: "resistor", label: "R1", x: 540, y: 230, value: 330 },
    { id: "D1", kind: "led", label: "D1", x: 540, y: 410, value: 2, forwardVoltage: 2 },
    { id: "GND", kind: "ground", label: "GND", x: 540, y: 555 },
    { id: "P1", kind: "probe", label: "P1", x: 720, y: 392, targetComponentId: "D1" },
  ], wires: [
    { id: "w1", from: { componentId: "V1", port: "top" }, to: { componentId: "R1", port: "top" } },
    { id: "w2", from: { componentId: "R1", port: "bottom" }, to: { componentId: "D1", port: "top" } },
    { id: "w3", from: { componentId: "D1", port: "bottom" }, to: { componentId: "GND", port: "top" } },
    { id: "w4", from: { componentId: "GND", port: "top" }, to: { componentId: "V1", port: "bottom" } },
  ] };
}

export function getComponentPorts(component: CircuitComponent): CircuitPortName[] { return component.kind === "ground" || component.kind === "probe" ? ["top"] : ["top", "bottom"]; }
export function findOpenEndpoints(document: CircuitDocument): WireEndpoint[] {
  const connected = new Set<string>();
  for (const wire of document.wires) { connected.add(`${wire.from.componentId}:${wire.from.port}`); connected.add(`${wire.to.componentId}:${wire.to.port}`); }
  return document.components.flatMap((component) => getComponentPorts(component).filter((port) => !connected.has(`${component.id}:${port}`)).map((port) => ({ componentId: component.id, port })));
}
export function cloneDocument(document: CircuitDocument): CircuitDocument { return JSON.parse(JSON.stringify(document)) as CircuitDocument; }
export function updateDocument(document: CircuitDocument, changes: Partial<CircuitDocument>): CircuitDocument { return { ...document, ...changes, updatedAt: new Date().toISOString() }; }
export function validateDocument(document: CircuitDocument): string[] {
  const errors: string[] = []; const ids = new Set<string>(); const components = new Map(document.components.map((component) => [component.id, component]));
  if (document.version !== CIRCUIT_DOCUMENT_VERSION) errors.push("当前项目格式版本不受支持。");
  for (const component of document.components) {
    if (ids.has(component.id)) errors.push(`元件 ID 重复：${component.id}。`); ids.add(component.id);
    if ((component.kind === "resistor" || component.kind === "capacitor" || component.kind === "diode" || component.kind === "led") && (!component.value || component.value <= 0)) {
      if (component.kind === "resistor") errors.push(`${component.label} 的阻值必须大于 0 Ω。`);
      else if (component.kind === "capacitor") errors.push(`${component.label} 的容值必须大于 0 F。`);
      else errors.push(`${component.label} 的正向压降必须大于 0 V。`);
    }
    if (component.kind === "voltageSource" && component.value === undefined) errors.push(`${component.label} 缺少电压值。`);
  }
  for (const wire of document.wires) for (const endpoint of [wire.from, wire.to]) { const component = components.get(endpoint.componentId); if (!component) errors.push(`导线 ${wire.id} 连接到不存在的元件 ${endpoint.componentId}。`); else if (!getComponentPorts(component).includes(endpoint.port)) errors.push(`导线 ${wire.id} 使用了 ${component.label} 不存在的端口。`); }
  return errors;
}
export function parseStoredDocument(raw: string | null): CircuitDocument | null { if (!raw) return null; try { const candidate = JSON.parse(raw) as CircuitDocument; return validateDocument(candidate).length === 0 ? candidate : null; } catch { return null; } }
