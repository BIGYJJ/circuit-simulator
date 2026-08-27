import { describe, expect, it } from "vitest";
import { createRCChargeDocument } from "./circuit-model";
import { serializeCircuit, serializeRCTrace } from "./experiment-export";
import { solveRCCharge } from "./rc-charge-solver";

describe("实验导出", () => {
  it("导出可重建的电路 JSON", () => {
    const exported = serializeCircuit(createRCChargeDocument());
    expect(JSON.parse(exported).name).toBe("RC 充电实验");
  });

  it("从真实瞬态样本导出 CSV 表头和最终电容能量", () => {
    const result = solveRCCharge(createRCChargeDocument(), 5);
    expect(result.success).toBe(true);
    if (result.success) {
      const csv = serializeRCTrace(result.solution);
      expect(csv.split("\n")).toHaveLength(7);
      expect(csv).toContain("capacitor_energy_j");
    }
  });
});
