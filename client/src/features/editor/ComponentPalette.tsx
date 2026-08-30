import type { CircuitProjectV2, ComponentInstance, ComponentKind, ModelDefinition } from "../../domain/project/project-v2";
import { familyMatchesKind } from "../models/ModelPanel";
import type { ProjectCommand } from "./project-reducer";

interface ComponentPaletteProps {
  project: CircuitProjectV2;
  onCommand: (command: ProjectCommand) => void;
}

const ADDABLE: Array<{ kind: Exclude<ComponentKind, "diode" | "switch" | "bjt" | "mosfet" | "subcircuit">; label: string }> = [
  { kind: "resistor", label: "电阻" },
  { kind: "capacitor", label: "电容" },
  { kind: "inductor", label: "电感" },
  { kind: "voltageSource", label: "电压源" },
  { kind: "currentSource", label: "电流源" },
  { kind: "ground", label: "地" },
];

function nextRefdes(project: CircuitProjectV2, prefix: string) {
  let index = 1;
  while (project.schematic.components.some(item => item.refdes.toUpperCase() === `${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

function firstModel(project: CircuitProjectV2, kind: ComponentKind): ModelDefinition | undefined {
  if (kind === "subcircuit") return project.models.find(item => item.kind === "spice-subckt");
  return project.models.find(item => item.kind === "spice-model" && familyMatchesKind(item.deviceFamily, kind));
}

function createPassive(project: CircuitProjectV2, kind: (typeof ADDABLE)[number]["kind"]): ComponentInstance {
  if (kind === "ground") {
    const taken = project.schematic.components.some(item => item.id === "GND");
    const id = taken ? nextRefdes(project, "GND") : "GND";
    return { id, refdes: id, kind: "ground", params: {} };
  }
  if (kind === "resistor") {
    const id = nextRefdes(project, "R");
    return { id, refdes: id, kind: "resistor", params: { resistanceOhm: 1000 } };
  }
  if (kind === "capacitor") {
    const id = nextRefdes(project, "C");
    return { id, refdes: id, kind: "capacitor", params: { capacitanceF: 1e-6 } };
  }
  if (kind === "inductor") {
    const id = nextRefdes(project, "L");
    return { id, refdes: id, kind: "inductor", params: { inductanceH: 1e-3 } };
  }
  if (kind === "voltageSource") {
    const id = nextRefdes(project, "V");
    return { id, refdes: id, kind: "voltageSource", params: { dcV: 0 } };
  }
  const id = nextRefdes(project, "I");
  return { id, refdes: id, kind: "currentSource", params: { dcA: 0 } };
}

function addCommand(project: CircuitProjectV2, component: ComponentInstance): ProjectCommand {
  const count = project.schematic.components.length;
  return {
    type: "component/add",
    component,
    layout: { x: 140 + (count % 4) * 80, y: 80 + Math.floor(count / 4) * 80, rotation: 0 },
  };
}

export default function ComponentPalette({ project, onCommand }: ComponentPaletteProps) {
  const diodeModel = firstModel(project, "diode");
  const bjtModel = firstModel(project, "bjt");
  const mosfetModel = firstModel(project, "mosfet");
  const switchModel = firstModel(project, "switch");
  const subcktModel = firstModel(project, "subcircuit");

  return (
    <section className="workspace-palette" aria-label="元件库">
      <h2>元件库</h2>
      {ADDABLE.map(item => (
        <button key={item.kind} type="button" onClick={() => onCommand(addCommand(project, createPassive(project, item.kind)))}>
          {`添加${item.label}`}
        </button>
      ))}
      {diodeModel ? (
        <button
          type="button"
          onClick={() => {
            const id = nextRefdes(project, "D");
            onCommand(addCommand(project, { id, refdes: id, kind: "diode", params: { area: 1 }, modelRef: diodeModel.id }));
          }}
        >
          添加二极管
        </button>
      ) : null}
      {bjtModel ? (
        <button
          type="button"
          onClick={() => {
            const id = nextRefdes(project, "Q");
            onCommand(addCommand(project, { id, refdes: id, kind: "bjt", params: { area: 1 }, modelRef: bjtModel.id }));
          }}
        >
          添加晶体管
        </button>
      ) : null}
      {mosfetModel ? (
        <button
          type="button"
          onClick={() => {
            const id = nextRefdes(project, "M");
            onCommand(
              addCommand(project, {
                id,
                refdes: id,
                kind: "mosfet",
                params: { lengthM: 1e-6, widthM: 1e-6, multiplicity: 1 },
                modelRef: mosfetModel.id,
              })
            );
          }}
        >
          添加MOSFET
        </button>
      ) : null}
      {switchModel ? (
        <button
          type="button"
          onClick={() => {
            const id = nextRefdes(project, "S");
            onCommand(addCommand(project, { id, refdes: id, kind: "switch", params: {}, modelRef: switchModel.id }));
          }}
        >
          添加开关
        </button>
      ) : null}
      {subcktModel && subcktModel.kind === "spice-subckt" && subcktModel.interfaces[0] ? (
        <button
          type="button"
          onClick={() => {
            const id = nextRefdes(project, "X");
            const iface = subcktModel.interfaces[0]!;
            onCommand(
              addCommand(project, {
                id,
                refdes: id,
                kind: "subcircuit",
                params: { parameterOverrides: {} },
                modelRef: subcktModel.id,
                subcircuitName: iface.name,
                orderedPins: iface.orderedPins,
              })
            );
          }}
        >
          添加子电路
        </button>
      ) : null}
      <p className="workspace-muted">二极管 / 晶体管 / 开关需要先采用模型。</p>
    </section>
  );
}
