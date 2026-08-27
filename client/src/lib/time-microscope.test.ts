import { describe, expect, it } from "vitest";
import { createRCChargeDocument } from "./circuit-model";
import { solveRCCharge } from "./rc-charge-solver";
import { createTimeMilestones } from "./time-microscope";

describe("时间显微镜", () => {
  it("从 RC 解生成 0、1τ、2τ、5τ 四个可解释时间节点", () => {
    const result = solveRCCharge(createRCChargeDocument());
    expect(result.success).toBe(true);
    if (result.success) {
      const milestones = createTimeMilestones(result.solution);
      expect(milestones.map((milestone) => milestone.time)).toEqual([0, 1, 2, 5]);
      expect(milestones[1].description).toContain("63.2%");
    }
  });

  it("为放电解生成符合剩余电压语义的事件说明", () => {
    const document = createRCChargeDocument();
    document.components.find((component) => component.id === "S1")!.switchMode = "discharge";
    document.components.find((component) => component.id === "C1")!.initialValue = 5;
    const result = solveRCCharge(document);
    expect(result.success).toBe(true);
    if (result.success) expect(createTimeMilestones(result.solution)[1].description).toContain("36.8%");
  });
});
