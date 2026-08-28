import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../../tests/fixtures/circuits/projects";
import { applyProjectCommand } from "./project-reducer";

describe("project commands", () => {
  it("separates layout and electrical revisions", () => {
    const project = dividerProjectFixture();
    const moved = applyProjectCommand(project, { type: "layout/componentSet", componentId: "R1", layout: { x: 510, y: 210, rotation: 0 } }, "2026-08-28T00:00:01.000Z");
    expect(moved.ok && [moved.value.revision, moved.value.electricalRevision]).toEqual([2, 1]);
    const changed = moved.ok && applyProjectCommand(moved.value, { type: "component/replace", component: { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 1500 } } }, "2026-08-28T00:00:02.000Z");
    expect(changed && changed.ok && [changed.value.revision, changed.value.electricalRevision]).toEqual([3, 2]);
  });
});
