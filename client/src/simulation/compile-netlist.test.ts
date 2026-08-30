import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  conflictingLabelProjectFixture,
  diodeSweepProjectFixture,
  dividerAnalysis,
  dividerProjectFixture,
  lowpassAcProjectFixture,
  pulseNoDcProjectFixture,
  rcTransientProjectFixture,
  shuffledDividerFixture,
} from "../../../tests/fixtures/circuits/projects";
import { compileNetlist, hashAnalysisDefinition } from "./compile-netlist";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/netlists");

function expectedCir(name: string) {
  return readFileSync(resolve(fixtureDir, name), "utf8");
}

describe("deterministic netlist compiler", () => {
  it("emits identical bytes and mappings after arrays, layout, and project title are changed", async () => {
    const first = await compileNetlist({ project: dividerProjectFixture(), analysis: dividerAnalysis() });
    const second = await compileNetlist({ project: shuffledDividerFixture(), analysis: dividerAnalysis() });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.netlist).toBe(second.value.netlist);
    expect(first.value.netlistHash).toBe(second.value.netlistHash);
    expect(first.value.sourceMap).toEqual(second.value.sourceMap);
    expect(first.value.vectorPlan).toEqual(second.value.vectorPlan);
  });

  it("matches the four golden netlists", async () => {
    const cases = [
      { project: dividerProjectFixture(), analysis: dividerProjectFixture().analyses[0]!, file: "divider-op.expected.cir" },
      { project: rcTransientProjectFixture(), analysis: rcTransientProjectFixture().analyses[0]!, file: "rc-transient.expected.cir" },
      { project: diodeSweepProjectFixture(), analysis: diodeSweepProjectFixture().analyses[0]!, file: "diode-sweep.expected.cir" },
      { project: lowpassAcProjectFixture(), analysis: lowpassAcProjectFixture().analyses[0]!, file: "lowpass-ac.expected.cir" },
    ];
    for (const item of cases) {
      const compiled = await compileNetlist({ project: item.project, analysis: item.analysis });
      expect(compiled.ok, item.file).toBe(true);
      if (!compiled.ok) continue;
      expect(compiled.value.netlist).toBe(expectedCir(item.file));
      expect(compiled.value.netlist.endsWith("\n")).toBe(true);
      expect(compiled.value.netlist.includes("\r")).toBe(false);
    }
  });

  it("keeps analysis hash and netlist stable when enabledProbes are shuffled", async () => {
    const project = dividerProjectFixture();
    const analysis = { ...project.analyses[0]!, enabledProbes: ["probe-vout"] };
    const shuffled = { ...analysis, enabledProbes: ["probe-vout"] };
    const left = await hashAnalysisDefinition(analysis);
    const right = await hashAnalysisDefinition(shuffled);
    expect(left).toBe(right);
    const first = await compileNetlist({ project, analysis });
    const second = await compileNetlist({ project, analysis: shuffled });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.netlist).toBe(second.value.netlist);
    expect(first.value.vectorPlanHash).toBe(second.value.vectorPlanHash);
  });

  it("omits DC on a transient-only PULSE so it differs from an explicit DC 0 source", async () => {
    const withDc = await compileNetlist({
      project: rcTransientProjectFixture(),
      analysis: rcTransientProjectFixture().analyses[0]!,
    });
    const noDc = await compileNetlist({
      project: pulseNoDcProjectFixture(),
      analysis: pulseNoDcProjectFixture().analyses[0]!,
    });
    expect(withDc.ok && noDc.ok).toBe(true);
    if (!withDc.ok || !noDc.ok) return;
    expect(withDc.value.netlist).toContain("DC 0");
    expect(noDc.value.netlist).not.toContain("DC ");
    expect(noDc.value.netlist).toContain("PULSE(1 5");
    expect(withDc.value.netlist).not.toBe(noDc.value.netlist);
  });

  it("returns blockers and no netlist for graph, model, and unsupported power failures", async () => {
    const conflict = await compileNetlist({
      project: conflictingLabelProjectFixture("OUT", "SENSE"),
      analysis: dividerAnalysis(),
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.diagnostics[0]?.code).toBe("GRAPH_CONFLICTING_LABELS");

    const missingModel = diodeSweepProjectFixture();
    missingModel.models = [];
    const missing = await compileNetlist({ project: missingModel, analysis: missingModel.analyses[0]! });
    expect(missing.ok).toBe(false);

    const acPower = lowpassAcProjectFixture();
    acPower.probes = [{ id: "pr-vout", kind: "device-power", componentId: "R1", label: "P" }];
    const power = await compileNetlist({ project: acPower, analysis: acPower.analyses[0]! });
    expect(power.ok).toBe(false);
    if (!power.ok) expect(power.diagnostics[0]?.code).toBe("PROBE_UNSUPPORTED_DEVICE_POWER");
  });
});
