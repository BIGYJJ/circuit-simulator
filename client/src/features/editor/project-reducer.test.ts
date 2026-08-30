import { describe, expect, it } from "vitest";
import { dividerProjectFixture } from "../../../../tests/fixtures/circuits/projects";
import { applyProjectCommand, projectReducer } from "./project-reducer";

describe("project commands", () => {
  it("separates layout and electrical revisions", () => {
    const project = dividerProjectFixture();
    const moved = applyProjectCommand(
      project,
      {
        type: "layout/componentSet",
        componentId: "R1",
        layout: { x: 510, y: 210, rotation: 0 },
      },
      "2026-08-28T00:00:01.000Z"
    );
    expect(moved.ok && [moved.value.revision, moved.value.electricalRevision]).toEqual([2, 1]);
    const changed =
      moved.ok &&
      applyProjectCommand(
        moved.value,
        {
          type: "component/replace",
          component: { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 1500 } },
        },
        "2026-08-28T00:00:02.000Z"
      );
    expect(changed && changed.ok && [changed.value.revision, changed.value.electricalRevision]).toEqual([3, 2]);
  });

  it("refuses to remove a referenced probe", () => {
    const result = applyProjectCommand(dividerProjectFixture(), { type: "probe/remove", probeId: "probe-vout" }, "2026-08-28T00:00:01.000Z");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe("PROJECT_REFERENCE_EXISTS");
  });
});

describe("project editor history", () => {
  it("increments revision on undo/redo and only bumps electrical when content changes electrically", () => {
    const present = dividerProjectFixture();
    const layout = applyProjectCommand(
      present,
      { type: "layout/componentSet", componentId: "R1", layout: { x: 510, y: 210, rotation: 0 } },
      "2026-08-28T00:00:01.000Z"
    );
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    const undone = projectReducer(
      { past: [present], present: layout.value, future: [], diagnostics: [] },
      { type: "undo", changedAt: "2026-08-28T00:00:02.000Z" }
    );
    expect([undone.present.revision, undone.present.electricalRevision]).toEqual([3, 1]);
    const redone = projectReducer(undone, { type: "redo", changedAt: "2026-08-28T00:00:03.000Z" });
    expect([redone.present.revision, redone.present.electricalRevision]).toEqual([4, 1]);
  });

  it("leaves revisions untouched for no-op undo", () => {
    const present = dividerProjectFixture();
    const next = projectReducer({ past: [], present, future: [], diagnostics: [] }, { type: "undo", changedAt: "2026-08-28T00:00:01.000Z" });
    expect([next.present.revision, next.present.electricalRevision]).toEqual([1, 1]);
  });
});
