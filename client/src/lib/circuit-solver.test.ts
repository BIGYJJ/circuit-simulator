import { describe, expect, it } from "vitest";
import { cloneDocument, createVoltageDividerDocument } from "./circuit-model";
import { solveVoltageDivider } from "./circuit-solver";

describe("线性直流分压求解器", () => {
  it("计算 9V、1kΩ 与 2kΩ 分压器的 6V 输出", () => {
    const result = solveVoltageDivider(createVoltageDividerDocument());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.solution.vout).toBeCloseTo(6, 8);
      expect(result.solution.current).toBeCloseTo(0.003, 8);
      expect(result.solution.rLowPower).toBeCloseTo(0.018, 8);
    }
  });

  it("识别电源回路未返回参考地的错误", () => {
    const document = cloneDocument(createVoltageDividerDocument());
    document.wires = document.wires.filter((wire) => wire.id !== "w4");
    const result = solveVoltageDivider(document);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.diagnostics[0]).toContain("电源回路");
  });
});
