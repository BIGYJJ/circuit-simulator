import type {
  AnalysisDefinition,
  AssertionDefinition,
  CircuitProjectV2,
  ComponentInstance,
  ComponentLayout,
  CornerDefinition,
  Diagnostic,
  DomainResult,
  ModelDefinition,
  ProbeDefinition,
  ProjectNote,
  SchematicWire,
} from "../../domain/project/project-v2";
import { canonicalJson } from "../../domain/project/canonical";
import { parseCircuitProjectV2 } from "../../domain/project/project-schema";

export type ProjectCommand =
  | { type: "project/rename"; title: string }
  | { type: "component/add"; component: ComponentInstance; layout: ComponentLayout }
  | { type: "component/replace"; component: ComponentInstance }
  | { type: "component/remove"; componentId: string }
  | { type: "wire/add"; wire: SchematicWire }
  | { type: "wire/replace"; wire: SchematicWire }
  | { type: "wire/remove"; wireId: string }
  | { type: "model/upsert"; model: ModelDefinition }
  | { type: "model/remove"; modelId: string }
  | { type: "analysis/upsert"; analysis: AnalysisDefinition }
  | { type: "analysis/remove"; analysisId: string }
  | { type: "probe/upsert"; probe: ProbeDefinition }
  | { type: "probe/remove"; probeId: string }
  | { type: "assertion/upsert"; assertion: AssertionDefinition }
  | { type: "assertion/remove"; assertionId: string }
  | { type: "corner/upsert"; corner: CornerDefinition }
  | { type: "corner/remove"; cornerId: string }
  | { type: "note/upsert"; note: ProjectNote }
  | { type: "note/remove"; noteId: string }
  | { type: "layout/componentSet"; componentId: string; layout: ComponentLayout }
  | { type: "layout/wireRouteSet"; wireId: string; route: Array<{ x: number; y: number }> }
  | { type: "layout/viewportSet"; viewport: { x: number; y: number; zoom: number } };

const ELECTRICAL_PREFIXES = ["component/", "wire/", "model/", "analysis/", "probe/", "corner/"];

export function isElectricalCommand(command: ProjectCommand) {
  return ELECTRICAL_PREFIXES.some(prefix => command.type.startsWith(prefix));
}

function fail(code: string, message: string): DomainResult<CircuitProjectV2> {
  return {
    ok: false,
    diagnostics: [{ severity: "error", code, message, blocksRun: true }],
  };
}

function referencedComponentIds(project: CircuitProjectV2) {
  const ids = new Set<string>();
  for (const wire of project.schematic.wires) {
    ids.add(wire.from.componentId);
    ids.add(wire.to.componentId);
  }
  for (const probe of project.probes) {
    if (probe.kind === "node-voltage") ids.add(probe.node.componentId);
    if (probe.kind === "differential-voltage") {
      ids.add(probe.positive.componentId);
      ids.add(probe.negative.componentId);
    }
    if (probe.kind === "branch-current" || probe.kind === "device-power") ids.add(probe.componentId);
  }
  for (const analysis of project.analyses) {
    if (analysis.kind === "dc-sweep") ids.add(analysis.sweep.sourceComponentId);
  }
  return ids;
}

function mutate(project: CircuitProjectV2, command: ProjectCommand): CircuitProjectV2 | "noop" | "ref" {
  if (command.type === "layout/componentSet") {
    if (!project.schematic.components.some(item => item.id === command.componentId)) return "noop";
    const current = project.layout.components[command.componentId];
    if (
      current &&
      current.x === command.layout.x &&
      current.y === command.layout.y &&
      current.rotation === command.layout.rotation
    ) {
      return "noop";
    }
    return {
      ...project,
      layout: {
        ...project.layout,
        components: { ...project.layout.components, [command.componentId]: command.layout },
      },
    };
  }
  const next = structuredClone(project);
  switch (command.type) {
    case "project/rename":
      if (next.title === command.title) return "noop";
      next.title = command.title;
      return next;
    case "component/add":
      if (next.schematic.components.some(item => item.id === command.component.id)) return "noop";
      next.schematic.components.push(command.component);
      next.layout.components[command.component.id] = command.layout;
      return next;
    case "component/replace": {
      const index = next.schematic.components.findIndex(item => item.id === command.component.id);
      if (index < 0) return "noop";
      if (JSON.stringify(next.schematic.components[index]) === JSON.stringify(command.component)) return "noop";
      next.schematic.components[index] = command.component;
      return next;
    }
    case "component/remove":
      if (referencedComponentIds(next).has(command.componentId)) return "ref";
      if (!next.schematic.components.some(item => item.id === command.componentId)) return "noop";
      next.schematic.components = next.schematic.components.filter(item => item.id !== command.componentId);
      delete next.layout.components[command.componentId];
      return next;
    case "wire/add":
      if (next.schematic.wires.some(item => item.id === command.wire.id)) return "noop";
      next.schematic.wires.push(command.wire);
      return next;
    case "wire/replace": {
      const index = next.schematic.wires.findIndex(item => item.id === command.wire.id);
      if (index < 0) return "noop";
      next.schematic.wires[index] = command.wire;
      return next;
    }
    case "wire/remove":
      if (!next.schematic.wires.some(item => item.id === command.wireId)) return "noop";
      next.schematic.wires = next.schematic.wires.filter(item => item.id !== command.wireId);
      delete next.layout.wireRoutes[command.wireId];
      return next;
    case "model/upsert": {
      const index = next.models.findIndex(item => item.id === command.model.id);
      if (index >= 0) next.models[index] = command.model;
      else next.models.push(command.model);
      return next;
    }
    case "model/remove":
      if (next.schematic.components.some(item => "modelRef" in item && item.modelRef === command.modelId)) return "ref";
      if (!next.models.some(item => item.id === command.modelId)) return "noop";
      next.models = next.models.filter(item => item.id !== command.modelId);
      return next;
    case "analysis/upsert": {
      const index = next.analyses.findIndex(item => item.id === command.analysis.id);
      if (index >= 0) next.analyses[index] = command.analysis;
      else next.analyses.push(command.analysis);
      return next;
    }
    case "analysis/remove":
      if (next.assertions.some(item => item.analysisId === command.analysisId)) return "ref";
      if (!next.analyses.some(item => item.id === command.analysisId)) return "noop";
      next.analyses = next.analyses.filter(item => item.id !== command.analysisId);
      return next;
    case "probe/upsert": {
      const index = next.probes.findIndex(item => item.id === command.probe.id);
      if (index >= 0) next.probes[index] = command.probe;
      else next.probes.push(command.probe);
      return next;
    }
    case "probe/remove":
      if (next.analyses.some(item => item.enabledProbes.includes(command.probeId))) return "ref";
      if (!next.probes.some(item => item.id === command.probeId)) return "noop";
      next.probes = next.probes.filter(item => item.id !== command.probeId);
      return next;
    case "assertion/upsert": {
      const index = next.assertions.findIndex(item => item.id === command.assertion.id);
      if (index >= 0) next.assertions[index] = command.assertion;
      else next.assertions.push(command.assertion);
      return next;
    }
    case "assertion/remove":
      if (!next.assertions.some(item => item.id === command.assertionId)) return "noop";
      next.assertions = next.assertions.filter(item => item.id !== command.assertionId);
      return next;
    case "corner/upsert": {
      const index = next.corners.findIndex(item => item.id === command.corner.id);
      if (index >= 0) next.corners[index] = command.corner;
      else next.corners.push(command.corner);
      return next;
    }
    case "corner/remove":
      if (!next.corners.some(item => item.id === command.cornerId)) return "noop";
      next.corners = next.corners.filter(item => item.id !== command.cornerId);
      return next;
    case "note/upsert": {
      const index = next.notes.findIndex(item => item.id === command.note.id);
      if (index >= 0) next.notes[index] = command.note;
      else next.notes.push(command.note);
      return next;
    }
    case "note/remove":
      if (!next.notes.some(item => item.id === command.noteId)) return "noop";
      next.notes = next.notes.filter(item => item.id !== command.noteId);
      return next;
    case "layout/wireRouteSet":
      next.layout.wireRoutes[command.wireId] = command.route;
      return next;
    case "layout/viewportSet":
      next.layout.viewport = command.viewport;
      return next;
    default:
      return "noop";
  }
}

export function applyProjectCommand(
  project: CircuitProjectV2,
  command: ProjectCommand,
  changedAt: string
): DomainResult<CircuitProjectV2> {
  const result = mutate(project, command);
  if (result === "ref") return fail("PROJECT_REFERENCE_EXISTS", "cannot remove a referenced object");
  if (result === "noop") return { ok: true, value: project, diagnostics: [] };
  result.revision = project.revision + 1;
  if (isElectricalCommand(command)) result.electricalRevision = project.electricalRevision + 1;
  result.updatedAt = changedAt;
  if (command.type.startsWith("layout/")) return { ok: true, value: result, diagnostics: [] };
  const parsed = parseCircuitProjectV2(result);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value, diagnostics: [] };
}

export interface ProjectEditorState {
  past: CircuitProjectV2[];
  present: CircuitProjectV2;
  future: CircuitProjectV2[];
  diagnostics: Diagnostic[];
}

export type ProjectEditorAction =
  | { type: "load"; project: CircuitProjectV2 }
  | { type: "command"; command: ProjectCommand; changedAt: string }
  | { type: "undo"; changedAt: string }
  | { type: "redo"; changedAt: string };

function electricallyEqual(left: CircuitProjectV2, right: CircuitProjectV2) {
  return (
    canonicalJson({
      schematic: left.schematic,
      models: left.models,
      analyses: left.analyses,
      probes: left.probes,
      corners: left.corners,
    }) ===
    canonicalJson({
      schematic: right.schematic,
      models: right.models,
      analyses: right.analyses,
      probes: right.probes,
      corners: right.corners,
    })
  );
}

export function projectReducer(state: ProjectEditorState, action: ProjectEditorAction): ProjectEditorState {
  if (action.type === "load") {
    return { past: [], present: action.project, future: [], diagnostics: [] };
  }
  if (action.type === "command") {
    const applied = applyProjectCommand(state.present, action.command, action.changedAt);
    if (!applied.ok) return { ...state, diagnostics: applied.diagnostics };
    if (applied.value === state.present) return { ...state, diagnostics: [] };
    return {
      past: [...state.past, state.present].slice(-50),
      present: applied.value,
      future: [],
      diagnostics: [],
    };
  }
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    if (!previous) return state;
    const restored = structuredClone(previous);
    restored.revision = state.present.revision + 1;
    if (!electricallyEqual(previous, state.present)) restored.electricalRevision = state.present.electricalRevision + 1;
    restored.updatedAt = action.changedAt;
    return {
      past: state.past.slice(0, -1),
      present: restored,
      future: [state.present, ...state.future],
      diagnostics: [],
    };
  }
  const next = state.future[0];
  if (!next) return state;
  const restored = structuredClone(next);
  restored.revision = state.present.revision + 1;
  if (!electricallyEqual(next, state.present)) restored.electricalRevision = state.present.electricalRevision + 1;
  restored.updatedAt = action.changedAt;
  return {
    past: [...state.past, state.present].slice(-50),
    present: restored,
    future: state.future.slice(1),
    diagnostics: [],
  };
}
