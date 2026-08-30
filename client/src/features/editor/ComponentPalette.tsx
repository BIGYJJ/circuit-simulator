import type { CircuitProjectV2, ComponentInstance, ComponentKind } from "../../domain/project/project-v2";
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

function createComponent(project: CircuitProjectV2, kind: (typeof ADDABLE)[number]["kind"]): ComponentInstance {
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

export default function ComponentPalette({ project, onCommand }: ComponentPaletteProps) {
  return (
    <section className="workspace-palette" aria-label="元件库">
      <h2>元件库</h2>
      {ADDABLE.map(item => (
        <button
          key={item.kind}
          type="button"
          onClick={() => {
            const component = createComponent(project, item.kind);
            const count = project.schematic.components.length;
            onCommand({
              type: "component/add",
              component,
              layout: { x: 140 + (count % 4) * 80, y: 80 + Math.floor(count / 4) * 80, rotation: 0 },
            });
          }}
        >
          {`添加${item.label}`}
        </button>
      ))}
      <p className="workspace-muted">二极管 / 晶体管 / 开关需要先采用模型。</p>
    </section>
  );
}
