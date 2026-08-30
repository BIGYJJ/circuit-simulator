import { describe, expect, it } from "vitest";
import { createLEDDebugDocument, createRCChargeDocument, createVoltageDividerDocument, findOpenEndpoints, parseStoredDocument, validateDocument } from "./circuit-model";

describe("版本化电路文档", () => {
  it("创建可用于分压实验的有效初始文档", () => {
    const document = createVoltageDividerDocument();
    expect(document.version).toBe(1);
    expect(document.components).toHaveLength(4);
    expect(document.wires).toHaveLength(4);
    expect(validateDocument(document)).toEqual([]);
  });

  it("拒绝零欧姆电阻以避免首期分压模型出现除零情况", () => {
    const document = createVoltageDividerDocument();
    document.components.find((component) => component.id === "R1")!.value = 0;
    expect(validateDocument(document)).toContain("R1 的阻值必须大于 0 Ω。");
  });

  it("只恢复通过结构验证的本地项目", () => {
    const valid = JSON.stringify(createVoltageDividerDocument());
    expect(parseStoredDocument(valid)?.name).toBe("9V 分压器实验");
    expect(parseStoredDocument("{not json}")).toBeNull();
  });

  it("将未接线端口作为可编辑但尚未完整的结构状态返回", () => {
    const document = createVoltageDividerDocument();
    expect(findOpenEndpoints(document)).toEqual([]);
    document.wires = document.wires.filter((wire) => wire.id !== "w4");
    expect(findOpenEndpoints(document)).toEqual([{ componentId: "V1", port: "bottom" }]);
  });

  it("创建包含电容和开关的版本化 RC 充电实验", () => {
    const document = createRCChargeDocument();
    expect(document.components.map((component) => component.kind)).toEqual(["voltageSource", "switch", "resistor", "capacitor", "ground"]);
    expect(validateDocument(document)).toEqual([]);
  });

  it("创建包含 LED 和探针的可导出工作点实验", () => {
    const document = createLEDDebugDocument();
    expect(document.components.some((component) => component.kind === "led")).toBe(true);
    expect(document.components.some((component) => component.kind === "probe")).toBe(true);
    expect(validateDocument(document)).toEqual([]);
  });
});
