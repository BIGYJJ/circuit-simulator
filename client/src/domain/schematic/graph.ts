import type { CircuitProjectV2, Diagnostic, DomainResult, WireEndpoint } from "../project/project-v2";
import { createNullRecord, endpointKey, resolveComponentDefinition, type ComponentDefinition } from "./component-library";

export { endpointKey } from "./component-library";

export interface SchematicGraph {
  endpointToNode: Record<string, string>;
  nodeToEndpoints: Record<string, WireEndpoint[]>;
  nodes: Array<{ name: string; grounded: boolean; labels: string[] }>;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(key: string) {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    this.add(key);
    const parent = this.parent.get(key)!;
    if (parent !== key) {
      const root = this.find(parent);
      this.parent.set(key, root);
      return root;
    }
    return parent;
  }

  union(left: string, right: string) {
    const a = this.find(left);
    const b = this.find(right);
    if (a === b) return;
    if (a < b) this.parent.set(b, a);
    else this.parent.set(a, b);
  }

  roots() {
    return [...new Set([...this.parent.keys()].map(key => this.find(key)))];
  }
}

function normalizeLabel(label: string) {
  return label.toUpperCase();
}

function isGroundLabel(label: string) {
  const normalized = normalizeLabel(label);
  return normalized === "0" || normalized === "GND";
}

export function buildSchematicGraph(project: CircuitProjectV2): DomainResult<SchematicGraph> {
  const diagnostics: Diagnostic[] = [];
  const definitions = new Map<string, ComponentDefinition>();
  const endpoints = new Map<string, WireEndpoint>();

  for (const component of project.schematic.components) {
    const resolved = resolveComponentDefinition(component, project.models);
    if (!resolved.ok) {
      diagnostics.push(...resolved.diagnostics);
      continue;
    }
    definitions.set(component.id, resolved.value);
    for (const pin of resolved.value.pins) {
      const endpoint = { componentId: component.id, pin };
      endpoints.set(endpointKey(endpoint), endpoint);
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const unions = new UnionFind();
  for (const endpoint of endpoints.values()) unions.add(endpointKey(endpoint));

  for (const wire of project.schematic.wires) {
    const fromKey = endpointKey(wire.from);
    const toKey = endpointKey(wire.to);
    if (!endpoints.has(fromKey) || !endpoints.has(toKey)) {
      diagnostics.push({
        severity: "error",
        code: "GRAPH_UNKNOWN_ENDPOINT",
        message: "wire endpoint does not match a defined component pin",
        blocksRun: true,
        location: { wireId: wire.id, componentId: endpoints.has(fromKey) ? wire.to.componentId : wire.from.componentId },
      });
      continue;
    }
    unions.union(fromKey, toKey);
  }
  if (diagnostics.some(item => item.code === "GRAPH_UNKNOWN_ENDPOINT")) return { ok: false, diagnostics };

  const labelsByRoot = new Map<string, Set<string>>();
  function addLabel(root: string, label: string) {
    const bucket = labelsByRoot.get(root) ?? new Set<string>();
    bucket.add(label);
    labelsByRoot.set(root, bucket);
  }

  for (const wire of project.schematic.wires) {
    if (!wire.netLabel) continue;
    const root = unions.find(endpointKey(wire.from));
    if (isGroundLabel(wire.netLabel)) addLabel(root, "0");
    else addLabel(root, normalizeLabel(wire.netLabel));
  }

  for (const component of project.schematic.components) {
    if (component.kind !== "ground") continue;
    const definition = definitions.get(component.id);
    if (!definition) continue;
    for (const pin of definition.pins) addLabel(unions.find(endpointKey({ componentId: component.id, pin })), "0");
  }

  for (const [root, labels] of labelsByRoot) {
    const named = [...labels].filter(label => label !== "0");
    if (named.length > 1) {
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "GRAPH_CONFLICTING_LABELS",
            message: `physical net has conflicting labels ${named.join(", ")}`,
            blocksRun: true,
            location: { field: root },
          },
        ],
      };
    }
  }

  const labelRoots = new Map<string, string[]>();
  for (const root of unions.roots()) {
    const labels = [...(labelsByRoot.get(root) ?? [])];
    if (labels.length === 0) continue;
    const key = labels.includes("0") ? "0" : labels[0]!;
    const list = labelRoots.get(key) ?? [];
    list.push(root);
    labelRoots.set(key, list);
  }
  for (const roots of labelRoots.values()) {
    for (let index = 1; index < roots.length; index += 1) unions.union(roots[0]!, roots[index]!);
  }

  const members = new Map<string, string[]>();
  for (const key of endpoints.keys()) {
    const root = unions.find(key);
    const list = members.get(root) ?? [];
    list.push(key);
    members.set(root, list);
  }

  const named = createNullRecord<string>();
  const unlabelled: string[] = [];
  for (const [root] of members) {
    const mergedLabels = new Set<string>();
    for (const [oldRoot, oldLabels] of labelsByRoot) {
      if (unions.find(oldRoot) === root) for (const label of oldLabels) mergedLabels.add(label);
    }
    if (mergedLabels.has("0")) named[root] = "0";
    else if (mergedLabels.size === 1) named[root] = [...mergedLabels][0]!;
    else unlabelled.push(root);
  }

  unlabelled.sort((left, right) => {
    const a = (members.get(left) ?? []).slice().sort()[0] ?? left;
    const b = (members.get(right) ?? []).slice().sort()[0] ?? right;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  unlabelled.forEach((root, index) => {
    named[root] = `N${String(index + 1).padStart(4, "0")}`;
  });

  const endpointToNode = createNullRecord<string>();
  const nodeToEndpoints = createNullRecord<WireEndpoint[]>();
  const nodeMeta = new Map<string, { grounded: boolean; labels: Set<string> }>();

  for (const [key, endpoint] of endpoints) {
    const node = named[unions.find(key)]!;
    endpointToNode[key] = node;
    const list = Object.hasOwn(nodeToEndpoints, node) ? nodeToEndpoints[node]! : [];
    list.push(endpoint);
    nodeToEndpoints[node] = list;
    const meta = nodeMeta.get(node) ?? { grounded: node === "0", labels: new Set<string>() };
    if (node === "0") meta.grounded = true;
    if (!/^N\d{4}$/.test(node) && node !== "0") meta.labels.add(node);
    nodeMeta.set(node, meta);
  }

  for (const list of Object.values(nodeToEndpoints)) {
    list.sort((left, right) => endpointKey(left).localeCompare(endpointKey(right)));
  }

  const nodes = Object.keys(nodeToEndpoints)
    .sort()
    .map(name => ({
      name,
      grounded: nodeMeta.get(name)?.grounded ?? name === "0",
      labels: [...(nodeMeta.get(name)?.labels ?? [])].sort(),
    }));

  return {
    ok: true,
    value: { endpointToNode, nodeToEndpoints, nodes },
    diagnostics: [],
  };
}
