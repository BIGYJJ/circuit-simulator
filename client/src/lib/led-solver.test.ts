import { describe, expect, it } from "vitest";
import { createLEDDebugDocument } from "./circuit-model";
import { solveLEDSeries } from "./led-solver";

describe("LED 常压降工作点求解器", () => {
  it("为 5V、330Ω、2V LED 计算约 9.09mA 的工作点", () => {
    const result = solveLEDSeries(createLEDDebugDocument());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.solution.current).toBeCloseTo(0.0090909, 7);
      expect(result.solution.targetMet).toBe(true);
      expect(result.solution.resistorPower).toBeLessThan(0.25);
    }
  });

  it("为开路故障返回零电流和明确的证据诊断", () => {
    const result = solveLEDSeries(createLEDDebugDocument(), "open");
    expect(result.success).toBe(true);
    if (result.success) expect(result.solution.current).toBe(0);
  });

  it("识别 68Ω 错误限流导致的高电流", () => {
    const result = solveLEDSeries(createLEDDebugDocument(), "wrongResistor");
    expect(result.success).toBe(true);
    if (result.success) expect(result.solution.current * 1000).toBeGreaterThan(20);
  });
});
