/**
 * 工程工作台内核：每项高级实验通过可测试的纯函数给出数值、诊断与可视化所需的证据。
 * 这些教学模型明确标注近似边界；它们为后续 Web Worker/MNA/SPICE 适配器提供稳定接口。
 */

export interface IterationPoint { iteration: number; voltage: number; current: number; residual: number; }
export interface DiodeSolveResult { voltage: number; current: number; converged: boolean; iterations: IterationPoint[]; }
export interface ACPoint { frequency: number; magnitudeDb: number; phaseDeg: number; }
export interface WavePoint { time: number; value: number; }
export interface EngineeringDiagnostic { severity: "info" | "warning" | "error"; code: string; message: string; }

export function solveShockleyDiode(sourceVoltage: number, resistance: number, saturationCurrent = 1e-12, thermalVoltage = 0.02585): DiodeSolveResult {
  let voltage = Math.min(0.72, Math.max(0, sourceVoltage));
  const iterations: IterationPoint[] = [];
  for (let index = 0; index < 24; index += 1) {
    const exponent = Math.min(30, voltage / thermalVoltage);
    const diodeCurrent = saturationCurrent * (Math.exp(exponent) - 1);
    const residual = (sourceVoltage - voltage) / resistance - diodeCurrent;
    const derivative = -1 / resistance - (saturationCurrent / thermalVoltage) * Math.exp(exponent);
    iterations.push({ iteration: index + 1, voltage, current: diodeCurrent, residual });
    if (Math.abs(residual) < 1e-9) return { voltage, current: diodeCurrent, converged: true, iterations };
    voltage = Math.max(-0.2, Math.min(1.2, voltage - residual / derivative));
  }
  const current = saturationCurrent * (Math.exp(Math.min(30, voltage / thermalVoltage)) - 1);
  return { voltage, current, converged: false, iterations };
}

export function createDiodeSweep(maxVoltage = 5, points = 61) {
  return Array.from({ length: points }, (_, index) => {
    const sourceVoltage = (maxVoltage * index) / (points - 1);
    const result = solveShockleyDiode(sourceVoltage, 330);
    return { sourceVoltage, diodeVoltage: result.voltage, currentMilliamp: result.current * 1000 };
  });
}

export function solveCommonEmitter({ sourceVoltage = 9, baseVoltage = 1.2, baseResistance = 100000, collectorResistance = 1000, beta = 100 }) {
  const baseCurrent = Math.max(0, (baseVoltage - 0.7) / baseResistance);
  const idealCollectorCurrent = baseCurrent * beta;
  const saturationCurrent = Math.max(0, (sourceVoltage - 0.2) / collectorResistance);
  const collectorCurrent = Math.min(idealCollectorCurrent, saturationCurrent);
  const collectorVoltage = sourceVoltage - collectorCurrent * collectorResistance;
  const region = baseCurrent <= 0 ? "截止" : idealCollectorCurrent >= saturationCurrent ? "饱和" : "放大";
  return { baseCurrent, collectorCurrent, collectorVoltage, region, gain: baseCurrent ? collectorCurrent / baseCurrent : 0 };
}

export function solveMosfetSwitch({ sourceVoltage = 12, gateVoltage = 5, loadResistance = 100, thresholdVoltage = 2.5, rdsOn = 0.15 }) {
  const on = gateVoltage >= thresholdVoltage;
  const current = on ? sourceVoltage / (loadResistance + rdsOn) : 0;
  const drainVoltage = on ? current * rdsOn : sourceVoltage;
  const power = current * current * rdsOn;
  return { on, current, drainVoltage, power, gateMargin: gateVoltage - thresholdVoltage };
}

export function simulateRCNumerical({ sourceVoltage = 5, resistance = 10000, capacitance = 100e-6, duration = 5, step = 0.01, method = "trapezoidal" as "euler" | "trapezoidal" }) {
  let voltage = 0;
  const samples: WavePoint[] = [];
  for (let time = 0; time <= duration + step / 2; time += step) {
    samples.push({ time, value: voltage });
    const tau = resistance * capacitance;
    if (method === "euler") voltage += ((sourceVoltage - voltage) / tau) * step;
    else voltage = (voltage + (step / (2 * tau)) * (2 * sourceVoltage - voltage)) / (1 + step / (2 * tau));
  }
  return { samples, timeConstant: resistance * capacitance, method };
}

export function lowPassAC(resistance = 10000, capacitance = 100e-9, points = 80): ACPoint[] {
  return Array.from({ length: points }, (_, index) => {
    const exponent = -1 + (5 * index) / (points - 1);
    const frequency = 10 ** exponent;
    const omegaRC = 2 * Math.PI * frequency * resistance * capacitance;
    return { frequency, magnitudeDb: -10 * Math.log10(1 + omegaRC * omegaRC), phaseDeg: -(Math.atan(omegaRC) * 180) / Math.PI };
  });
}

export function createSignal(kind: "sine" | "square" | "pulse" | "pwl", frequency = 10, amplitude = 1, points = 120): WavePoint[] {
  return Array.from({ length: points }, (_, index) => {
    const time = index / (points - 1) / frequency;
    const phase = (time * frequency) % 1;
    const value = kind === "sine" ? amplitude * Math.sin(2 * Math.PI * phase)
      : kind === "square" ? (phase < 0.5 ? amplitude : -amplitude)
        : kind === "pulse" ? (phase < 0.2 ? amplitude : 0)
          : phase < 0.35 ? (phase / 0.35) * amplitude : ((1 - phase) / 0.65) * amplitude;
    return { time, value };
  });
}

export function solveIdealOpAmp({ inputVoltage = 0.2, gain = -10, supply = 5 }) {
  const idealOutput = inputVoltage * gain;
  const output = Math.max(-supply, Math.min(supply, idealOutput));
  return { idealOutput, output, saturated: Math.abs(idealOutput) > supply };
}

export function solvePwm555({ resistanceA = 1000, resistanceB = 10000, capacitance = 100e-9 }) {
  const highTime = 0.693 * (resistanceA + resistanceB) * capacitance;
  const lowTime = 0.693 * resistanceB * capacitance;
  const period = highTime + lowTime;
  return { highTime, lowTime, period, frequency: 1 / period, duty: highTime / period };
}

export function runTwoBitCounter(steps = 10) {
  return Array.from({ length: steps }, (_, index) => ({ step: index, q0: index % 2, q1: Math.floor(index / 2) % 2, binary: (index % 4).toString(2).padStart(2, "0") }));
}

export function comparatorSample(inputVoltage = 2.3, threshold = 2.5, hysteresis = 0.15) {
  const high = inputVoltage >= threshold + hysteresis / 2;
  const low = inputVoltage <= threshold - hysteresis / 2;
  return { inputVoltage, threshold, hysteresis, state: high ? 1 : low ? 0 : "保持" as 0 | 1 | "保持" };
}

export function runERC({ hasGround = true, openPorts = 0, supplyVoltage = 5, resistorPower = 0.027, ratedPower = 0.25 }): EngineeringDiagnostic[] {
  const diagnostics: EngineeringDiagnostic[] = [];
  if (!hasGround) diagnostics.push({ severity: "error", code: "ERC-001", message: "未检测到参考地：节点电压没有共同基准。" });
  if (openPorts) diagnostics.push({ severity: "warning", code: "ERC-014", message: `检测到 ${openPorts} 个未连接端口：可保存但当前分析可能无法收敛。` });
  if (supplyVoltage > 30) diagnostics.push({ severity: "warning", code: "ERC-021", message: "教学工作台默认低压范围为 30 V 以下；请确认安全假设。" });
  if (resistorPower > ratedPower) diagnostics.push({ severity: "error", code: "ERC-033", message: "电阻预计功耗超过额定值。" });
  if (!diagnostics.length) diagnostics.push({ severity: "info", code: "ERC-000", message: "未发现当前模型定义的结构或额定风险。" });
  return diagnostics;
}

export interface SpiceElement { type: "V" | "R" | "C" | "D"; name: string; nodes: string[]; value: string; }
export function parseSpiceSubset(netlist: string): SpiceElement[] {
  return netlist.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("*") && !line.startsWith(".")).flatMap((line) => {
    const [name, ...parts] = line.split(/\s+/); const type = name?.[0]?.toUpperCase();
    if (!type || !["V", "R", "C", "D"].includes(type) || parts.length < 3) return [];
    return [{ type: type as SpiceElement["type"], name, nodes: parts.slice(0, 2), value: parts.slice(2).join(" ") }];
  });
}
export function createSpiceSubset() { return "* FLUXLAB supported netlist\nV1 VIN 0 DC 5\nR1 VIN LEDA 330\nD1 LEDA 0 D_LED\n.end"; }

export interface TestAssertion { label: string; actual: number; min?: number; max?: number; target?: number; tolerance?: number; }
export function evaluateAssertions(assertions: TestAssertion[]) {
  return assertions.map((item) => ({ ...item, passed: item.target !== undefined ? Math.abs(item.actual - item.target) <= (item.tolerance ?? 0) : (item.min === undefined || item.actual >= item.min) && (item.max === undefined || item.actual <= item.max) }));
}
