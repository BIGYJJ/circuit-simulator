import type { CircuitProjectV2 } from "../../../client/src/domain/project/project-v2";

export function dividerProjectFixture(): CircuitProjectV2 {
  return {
    schemaVersion: 2,
    id: "proj-divider-v2",
    title: "9V divider",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components: [
        { id: "V1", refdes: "V1", kind: "voltageSource", params: { dcV: 9 } },
        { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 1000 } },
        { id: "R2", refdes: "R2", kind: "resistor", params: { resistanceOhm: 2000 } },
        { id: "GND", refdes: "GND", kind: "ground", params: {} },
      ],
      wires: [
        {
          id: "wire-v1-r1",
          from: { componentId: "V1", pin: "p" },
          to: { componentId: "R1", pin: "p" },
        },
        {
          id: "wire-r1-r2",
          from: { componentId: "R1", pin: "n" },
          to: { componentId: "R2", pin: "p" },
          netLabel: "VOUT",
        },
        {
          id: "wire-r2-gnd",
          from: { componentId: "R2", pin: "n" },
          to: { componentId: "GND", pin: "p" },
        },
        {
          id: "wire-v1-gnd",
          from: { componentId: "V1", pin: "n" },
          to: { componentId: "GND", pin: "p" },
        },
      ],
    },
    layout: {
      components: {
        V1: { x: 80, y: 40, rotation: 0 },
        R1: { x: 80, y: 140, rotation: 0 },
        R2: { x: 80, y: 240, rotation: 0 },
        GND: { x: 80, y: 320, rotation: 0 },
      },
      wireRoutes: {
        "wire-v1-r1": [
          { x: 80, y: 60 },
          { x: 80, y: 120 },
        ],
        "wire-r1-r2": [
          { x: 80, y: 160 },
          { x: 80, y: 220 },
        ],
        "wire-r2-gnd": [
          { x: 80, y: 260 },
          { x: 80, y: 300 },
        ],
        "wire-v1-gnd": [
          { x: 40, y: 40 },
          { x: 40, y: 320 },
        ],
      },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    models: [],
    analyses: [{ id: "an-op", name: "DC OP", kind: "dc-op", enabledProbes: ["probe-vout"] }],
    probes: [
      {
        id: "probe-vout",
        kind: "node-voltage",
        node: { componentId: "R1", pin: "n" },
        label: "Vout",
      },
    ],
    assertions: [
      {
        id: "assert-vout",
        name: "Vout is 6 V",
        enabled: true,
        analysisId: "an-op",
        expression: { function: "valueAt", vectorId: "vec-placeholder", at: { value: 0, unit: "index" } },
        comparator: {
          kind: "near",
          expected: { value: 6, unit: "V" },
          absoluteTolerance: { value: 0.01, unit: "V" },
        },
      },
    ],
    corners: [],
    notes: [],
  };
}

function cloneDivider(): CircuitProjectV2 {
  return structuredClone(dividerProjectFixture());
}

export function labelledProjectFixture(first: string, second: string): CircuitProjectV2 {
  const project = cloneDivider();
  project.id = "proj-labelled";
  const mid = project.schematic.wires.find(item => item.id === "wire-r1-r2");
  const top = project.schematic.wires.find(item => item.id === "wire-v1-r1");
  if (mid) mid.netLabel = first;
  if (top) top.netLabel = second;
  return project;
}

export function conflictingLabelProjectFixture(first: string, second: string): CircuitProjectV2 {
  const project = cloneDivider();
  project.id = "proj-conflict-labels";
  project.schematic.wires.push({
    id: "wire-label-conflict",
    from: { componentId: "R1", pin: "n" },
    to: { componentId: "R2", pin: "p" },
    netLabel: second,
  });
  const mid = project.schematic.wires.find(item => item.id === "wire-r1-r2");
  if (mid) mid.netLabel = first;
  return project;
}

export function parallelLoadProjectFixture(): CircuitProjectV2 {
  const project = cloneDivider();
  project.id = "proj-parallel";
  project.schematic.components.push({ id: "R3", refdes: "R3", kind: "resistor", params: { resistanceOhm: 2000 } });
  project.layout.components.R3 = { x: 160, y: 240, rotation: 0 };
  project.schematic.wires.push(
    { id: "wire-r3-p", from: { componentId: "R3", pin: "p" }, to: { componentId: "R2", pin: "p" } },
    { id: "wire-r3-n", from: { componentId: "R3", pin: "n" }, to: { componentId: "R2", pin: "n" } }
  );
  return project;
}

export function disconnectedSingletonProjectFixture(): CircuitProjectV2 {
  const project = cloneDivider();
  project.id = "proj-floating";
  project.schematic.wires = project.schematic.wires.filter(item => item.id !== "wire-r2-gnd");
  return project;
}

export function shuffledDividerFixture(): CircuitProjectV2 {
  const project = cloneDivider();
  project.title = "shuffled divider";
  project.schematic.components.reverse();
  project.schematic.wires.reverse();
  project.layout.components.R1 = { x: 12, y: 34, rotation: 90 };
  return project;
}

export function dividerAnalysis() {
  return dividerProjectFixture().analyses[0]!;
}

export function rcTransientProjectFixture(): CircuitProjectV2 {
  return {
    schemaVersion: 2,
    id: "proj-rc-v2",
    title: "RC transient",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components: [
        {
          id: "V1",
          refdes: "V1",
          kind: "voltageSource",
          params: {
            dcV: 0,
            transient: { kind: "pulse", initialV: 0, pulsedV: 5, delayS: 0, riseS: 1e-9, fallS: 1e-9, widthS: 10, periodS: 20 },
          },
        },
        { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 10000 } },
        { id: "C1", refdes: "C1", kind: "capacitor", params: { capacitanceF: 100e-6 } },
        { id: "GND", refdes: "GND", kind: "ground", params: {} },
      ],
      wires: [
        { id: "w1", from: { componentId: "V1", pin: "p" }, to: { componentId: "R1", pin: "p" } },
        { id: "w2", from: { componentId: "R1", pin: "n" }, to: { componentId: "C1", pin: "p" } },
        { id: "w3", from: { componentId: "C1", pin: "n" }, to: { componentId: "GND", pin: "p" } },
        { id: "w4", from: { componentId: "GND", pin: "p" }, to: { componentId: "V1", pin: "n" } },
      ],
    },
    layout: { components: {}, wireRoutes: {} },
    models: [],
    analyses: [{ id: "an-tran", name: "Transient", kind: "transient", stepS: 0.01, stopS: 5, enabledProbes: ["pr-vcap"] }],
    probes: [{ id: "pr-vcap", kind: "node-voltage", node: { componentId: "C1", pin: "p" }, label: "Vcap" }],
    assertions: [],
    corners: [],
    notes: [],
  };
}

export function diodeSweepProjectFixture(): CircuitProjectV2 {
  return {
    schemaVersion: 2,
    id: "proj-diode-sweep",
    title: "diode sweep",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components: [
        { id: "V1", refdes: "V1", kind: "voltageSource", params: { dcV: 0 } },
        { id: "D1", refdes: "D1", kind: "diode", params: { area: 1 }, modelRef: "dmod" },
        { id: "GND", refdes: "GND", kind: "ground", params: {} },
      ],
      wires: [
        { id: "w1", from: { componentId: "V1", pin: "p" }, to: { componentId: "D1", pin: "p" } },
        { id: "w2", from: { componentId: "D1", pin: "n" }, to: { componentId: "GND", pin: "p" } },
        { id: "w3", from: { componentId: "GND", pin: "p" }, to: { componentId: "V1", pin: "n" } },
      ],
    },
    layout: { components: {}, wireRoutes: {} },
    models: [
      {
        id: "dmod",
        displayName: "DMOD",
        source: ".model DMOD D(IS=1e-14 N=1)\n",
        sha256: "a4554d8c891cff561a2833915ef6bb96d3f324ab31ce68600931a61b8b867d59",
        origin: "user-import",
        kind: "spice-model",
        modelName: "DMOD",
        deviceFamily: "diode",
      },
    ],
    analyses: [
      {
        id: "an-dc",
        name: "Diode sweep",
        kind: "dc-sweep",
        sweep: { sourceComponentId: "V1", quantity: "voltage", startV: 0.4, stopV: 0.8, stepV: 0.01 },
        enabledProbes: ["pr-pd"],
      },
    ],
    probes: [{ id: "pr-pd", kind: "device-power", componentId: "D1", label: "P(D1)" }],
    assertions: [],
    corners: [],
    notes: [],
  };
}

export function lowpassAcProjectFixture(): CircuitProjectV2 {
  return {
    schemaVersion: 2,
    id: "proj-lowpass-ac",
    title: "RC lowpass",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    revision: 1,
    electricalRevision: 1,
    schematic: {
      components: [
        { id: "V1", refdes: "V1", kind: "voltageSource", params: { dcV: 0, ac: { magnitudeV: 1, phaseDeg: 0 } } },
        { id: "R1", refdes: "R1", kind: "resistor", params: { resistanceOhm: 1000 } },
        { id: "C1", refdes: "C1", kind: "capacitor", params: { capacitanceF: 1e-6 } },
        { id: "GND", refdes: "GND", kind: "ground", params: {} },
      ],
      wires: [
        { id: "w1", from: { componentId: "V1", pin: "p" }, to: { componentId: "R1", pin: "p" } },
        { id: "w2", from: { componentId: "R1", pin: "n" }, to: { componentId: "C1", pin: "p" } },
        { id: "w3", from: { componentId: "C1", pin: "n" }, to: { componentId: "GND", pin: "p" } },
        { id: "w4", from: { componentId: "GND", pin: "p" }, to: { componentId: "V1", pin: "n" } },
      ],
    },
    layout: { components: {}, wireRoutes: {} },
    models: [],
    analyses: [
      { id: "an-ac", name: "AC", kind: "ac", scale: "dec", pointsPerInterval: 20, startHz: 1, stopHz: 1e5, enabledProbes: ["pr-vout"] },
    ],
    probes: [{ id: "pr-vout", kind: "node-voltage", node: { componentId: "C1", pin: "p" }, label: "Vout" }],
    assertions: [],
    corners: [],
    notes: [],
  };
}

export function pulseNoDcProjectFixture(): CircuitProjectV2 {
  const project = rcTransientProjectFixture();
  project.id = "proj-pulse-nodc";
  const source = project.schematic.components.find(item => item.id === "V1");
  if (source && source.kind === "voltageSource") {
    source.params = {
      transient: { kind: "pulse", initialV: 1, pulsedV: 5, delayS: 0, riseS: 1e-9, fallS: 1e-9, widthS: 10, periodS: 20 },
    };
  }
  return project;
}

export function voltageSourceShortProjectFixture(): CircuitProjectV2 {
  const project = cloneDivider();
  project.id = "proj-vshort";
  project.schematic.wires.push({
    id: "wire-v1-short",
    from: { componentId: "V1", pin: "p" },
    to: { componentId: "V1", pin: "n" },
  });
  return project;
}
