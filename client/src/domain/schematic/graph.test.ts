import { describe, expect, it } from "vitest";
import {
  conflictingLabelProjectFixture,
  disconnectedSingletonProjectFixture,
  dividerProjectFixture,
  labelledProjectFixture,
  parallelLoadProjectFixture,
  voltageSourceShortProjectFixture,
} from "../../../../tests/fixtures/circuits/projects";
import { parseCircuitProjectV2 } from "../project/project-schema";
import { endpointKey } from "./component-library";
import { runErc } from "./diagnostics";
import { buildSchematicGraph } from "./graph";

describe("schematic graph", () => {
  it("unions case-insensitive labels and reserves ground", () => {
    const result = buildSchematicGraph(labelledProjectFixture("Signal_A", "signal_a"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(new Set(Object.values(result.value.endpointToNode))).toContain("SIGNAL_A");
    if (result.ok) expect(result.value.nodes.some(node => node.name === "0" && node.grounded)).toBe(true);
  });

  it("blocks conflicting labels on one physical net", () => {
    const result = buildSchematicGraph(conflictingLabelProjectFixture("OUT", "SENSE"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe("GRAPH_CONFLICTING_LABELS");
  });

  it("keeps concatenated endpoint identities distinct", () => {
    expect(endpointKey({ componentId: "a:b", pin: "c" })).not.toBe(endpointKey({ componentId: "a", pin: "b:c" }));
  });

  it("is stable after array shuffle and layout moves", () => {
    const first = buildSchematicGraph(dividerProjectFixture());
    const shuffled = dividerProjectFixture();
    shuffled.schematic.components.reverse();
    shuffled.schematic.wires.reverse();
    shuffled.layout.components.R1 = { x: 999, y: 12, rotation: 90 };
    const second = buildSchematicGraph(shuffled);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.endpointToNode).toEqual(second.value.endpointToNode);
    expect(first.value.nodes.map(node => node.name)).toEqual(second.value.nodes.map(node => node.name));
  });

  it("does not inherit prototype keys on returned records", () => {
    const result = buildSchematicGraph(dividerProjectFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.value.endpointToNode)).toBeNull();
    expect(Object.getPrototypeOf(result.value.nodeToEndpoints)).toBeNull();
    expect(parseCircuitProjectV2({ ...dividerProjectFixture(), schematic: { ...dividerProjectFixture().schematic, wires: [{ id: "w", from: { componentId: "R1", pin: "n" }, to: { componentId: "R2", pin: "p" }, netLabel: "__proto__" }] } }).ok).toBe(false);
  });
});

describe("erc", () => {
  it("shares one node across a parallel load", () => {
    const project = parallelLoadProjectFixture();
    const graph = buildSchematicGraph(project);
    expect(graph.ok).toBe(true);
    if (!graph.ok) return;
    expect(graph.value.endpointToNode[endpointKey({ componentId: "R2", pin: "p" })]).toBe(
      graph.value.endpointToNode[endpointKey({ componentId: "R3", pin: "p" })]
    );
    expect(graph.value.endpointToNode[endpointKey({ componentId: "R2", pin: "n" })]).toBe(
      graph.value.endpointToNode[endpointKey({ componentId: "R3", pin: "n" })]
    );
    expect(runErc(project, graph.value).filter(item => item.blocksRun)).toEqual([]);
  });

  it("reports a disconnected required pin", () => {
    const project = disconnectedSingletonProjectFixture();
    const graph = buildSchematicGraph(project);
    expect(graph.ok).toBe(true);
    if (!graph.ok) return;
    const diagnostics = runErc(project, graph.value);
    expect(diagnostics.some(item => item.code === "ERC_FLOATING_REQUIRED_PIN" && item.location?.componentId === "R2")).toBe(true);
    expect(diagnostics.every(item => item.location)).toBe(true);
  });

  it("reports a nonzero voltage source short", () => {
    const project = voltageSourceShortProjectFixture();
    const graph = buildSchematicGraph(project);
    expect(graph.ok).toBe(true);
    if (!graph.ok) return;
    const diagnostics = runErc(project, graph.value);
    expect(diagnostics.some(item => item.code === "ERC_VOLTAGE_SOURCE_SHORT" && item.location?.componentId === "V1")).toBe(true);
  });
});
