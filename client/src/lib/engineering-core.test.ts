import { describe, expect, it } from "vitest";
import { comparatorSample, createDiodeSweep, createSignal, evaluateAssertions, lowPassAC, parseSpiceSubset, runERC, runTwoBitCounter, simulateRCNumerical, solveCommonEmitter, solveIdealOpAmp, solveMosfetSwitch, solvePwm555, solveShockleyDiode } from "./engineering-core";

describe("工程分析内核", () => {
  it("让 Shockley 二极管迭代收敛并形成可扫描工作点", () => { const solve = solveShockleyDiode(5, 330); expect(solve.converged).toBe(true); expect(solve.current).toBeGreaterThan(0.005); expect(createDiodeSweep()).toHaveLength(61); });
  it("区分 BJT 放大区和 MOSFET 导通状态", () => { expect(solveCommonEmitter({}).region).toBe("放大"); expect(solveMosfetSwitch({}).on).toBe(true); });
  it("生成数值 RC、AC 截止曲线和受控信号源", () => { expect(simulateRCNumerical({}).samples.at(-1)?.value).toBeGreaterThan(4.9); expect(lowPassAC()[0].magnitudeDb).toBeCloseTo(0, 1); expect(createSignal("square")).toHaveLength(120); });
  it("计算运放饱和与 555 时序", () => { expect(solveIdealOpAmp({ inputVoltage: 1, gain: 10, supply: 5 }).saturated).toBe(true); expect(solvePwm555({}).duty).toBeGreaterThan(0.5); });
  it("生成数字计数、比较器与 ERC 证据", () => { expect(runTwoBitCounter(4).at(-1)?.binary).toBe("11"); expect(comparatorSample(3).state).toBe(1); expect(runERC({ hasGround: false })[0].severity).toBe("error"); });
  it("读取受限 SPICE 元件与测试断言", () => { expect(parseSpiceSubset("V1 a 0 5\nR1 a b 1k")).toHaveLength(2); expect(evaluateAssertions([{ label: "I", actual: 0.009, min: 0.008, max: 0.012 }])[0].passed).toBe(true); });
});
