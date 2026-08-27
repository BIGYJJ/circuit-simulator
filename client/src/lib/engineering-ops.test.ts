import { describe, expect, it } from "vitest";
import { assessChangeImpact, catalogConstraints, createCornerSweep, createProjectBackup, createRiskRegister, createTriggerCursor, engineeringGate, validateProjectBackup } from "./engineering-ops";

describe("工程运营内核", () => {
  it("为容差和电源角点生成可审计的电流与功耗结果", () => { const corners = createCornerSweep(); expect(corners).toHaveLength(5); expect(corners[3].currentMilliamp).toBeGreaterThan(corners[0].currentMilliamp); });
  it("从波形中找出第一个触发阈值", () => { const cursor = createTriggerCursor([{ time: 0, value: 0 }, { time: .01, value: .6 }]); expect(cursor.triggered).toBe(true); expect(cursor.index).toBe(1); });
  it("提供元件约束、变更影响和风险登记", () => { expect(catalogConstraints()).toHaveLength(4); expect(assessChangeImpact().severity).toBe("medium"); expect(createRiskRegister()).toHaveLength(3); });
  it("验证备份格式并形成通过的交付门禁", () => { const backup = createProjectBackup({ name: "demo" }, "notes"); expect(validateProjectBackup(backup)).toBe(true); expect(engineeringGate([], createCornerSweep()).every((gate) => gate.passed)).toBe(true); });
});
