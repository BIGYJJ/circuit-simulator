import { describe, expect, it } from "vitest";
import { cloneDocument, createRCChargeDocument } from "./circuit-model";
import { solveRCCharge } from "./rc-charge-solver";

describe("理想 RC 充电求解器", () => {
  it("在一个时间常数时计算出约 63.2% 的电容电压", () => {
    const result = solveRCCharge(createRCChargeDocument(), 500);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.solution.timeConstant).toBeCloseTo(1, 10);
      expect(result.solution.samples[100].capacitorVoltage).toBeCloseTo(3.16060279, 7);
      expect(result.solution.samples[0].current).toBeCloseTo(0.0005, 10);
    }
  });

  it("在五个时间常数时趋近源电压", () => {
    const result = solveRCCharge(createRCChargeDocument(), 500);
    expect(result.success).toBe(true);
    if (result.success) expect(result.solution.samples.at(-1)?.capacitorVoltage).toBeCloseTo(4.96631027, 7);
  });

  it("将打开的开关明确诊断为尚不能充电", () => {
    const document = cloneDocument(createRCChargeDocument());
    document.components.find((component) => component.id === "S1")!.closed = false;
    const result = solveRCCharge(document);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.diagnostics[0]).toContain("未闭合");
  });

  it("对放电模式计算指数衰减电压、负方向支路电流和电容能量", () => {
    const document = createRCChargeDocument();
    document.components.find((component) => component.id === "S1")!.switchMode = "discharge";
    document.components.find((component) => component.id === "C1")!.initialValue = 5;
    const result = solveRCCharge(document, 500);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.solution.samples[100].capacitorVoltage).toBeCloseTo(1.83939721, 7);
      expect(result.solution.samples[100].current).toBeCloseTo(-0.00018393972, 9);
      expect(result.solution.samples[0].capacitorEnergy).toBeCloseTo(0.00125, 10);
    }
  });

  it("对保持模式返回不变的电压和零电流", () => {
    const document = createRCChargeDocument();
    document.components.find((component) => component.id === "S1")!.switchMode = "hold";
    document.components.find((component) => component.id === "C1")!.initialValue = 2.5;
    const result = solveRCCharge(document, 5);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.solution.samples.every((sample) => sample.capacitorVoltage === 2.5 && sample.current === 0)).toBe(true);
    }
  });
});
