import { useRef, useState } from "react";
import type { CircuitProjectV2, Diagnostic, ModelDefinition, SpiceDeviceFamily } from "../../domain/project/project-v2";
import { parseAndValidateSpiceSource } from "../../simulation/spice-source-parser";
import type { ProjectCommand } from "../editor/project-reducer";

interface ModelPanelProps {
  project: CircuitProjectV2;
  onCommand: (command: ProjectCommand) => void;
}

const MAX_MODEL_BYTES = 256 * 1024;

export default function ModelPanel({ project, onCommand }: ModelPanelProps) {
  const [preview, setPreview] = useState<string>("");
  const [licenseNote, setLicenseNote] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const sourceRef = useRef<HTMLTextAreaElement>(null);

  function currentSource() {
    return sourceRef.current?.value ?? "";
  }

  function setSource(value: string) {
    if (sourceRef.current) sourceRef.current.value = value;
  }

  async function previewSource(source: string) {
    if (new TextEncoder().encode(source).byteLength > MAX_MODEL_BYTES) {
      setDiagnostics([{ severity: "error", code: "MODEL_TOO_LARGE", message: "model exceeds the size limit", blocksRun: true }]);
      setPreview("");
      return;
    }
    const parsed = await parseAndValidateSpiceSource(source, "project-model", "opaque-model");
    if (!parsed.ok) {
      setDiagnostics(parsed.diagnostics);
      setPreview("");
      return;
    }
    setDiagnostics(parsed.diagnostics);
    const model = parsed.value.models[0];
    const sub = parsed.value.subcircuits[0];
    setPreview(
      model
        ? `${model.name} ${model.family} ${parsed.value.sha256}`
        : sub
          ? `${sub.name} ${sub.orderedPins.join(",")} ${parsed.value.sha256}`
          : parsed.value.sha256
    );
  }

  function incompatible(next: ModelDefinition) {
    const existing = project.models.find(item => item.id === next.id);
    if (!existing) return false;
    if (existing.kind !== next.kind) return true;
    if (existing.kind === "spice-model" && next.kind === "spice-model" && existing.deviceFamily !== next.deviceFamily) {
      return project.schematic.components.some(item => "modelRef" in item && item.modelRef === existing.id);
    }
    if (existing.kind === "spice-subckt" && next.kind === "spice-subckt") {
      const previous = existing.interfaces[0];
      const incoming = next.interfaces[0];
      if (!previous || !incoming) return true;
      return previous.name !== incoming.name || previous.orderedPins.join() !== incoming.orderedPins.join();
    }
    return false;
  }

  async function adopt() {
    const source = currentSource();
    const parsed = await parseAndValidateSpiceSource(source, "project-model", "opaque-model");
    if (!parsed.ok || parsed.diagnostics.some(item => item.blocksRun)) {
      setDiagnostics(parsed.diagnostics);
      setPreview("");
      return;
    }
    const first = parsed.value.models[0];
    const sub = parsed.value.subcircuits[0];
    let model: ModelDefinition | null = null;
    if (first) {
      model = {
        id: first.name.toLowerCase(),
        displayName: first.name,
        source: parsed.value.normalizedSource,
        sha256: parsed.value.sha256,
        origin: "user-import",
        kind: "spice-model",
        modelName: first.name,
        deviceFamily: first.family,
        licenseNote: licenseNote || undefined,
      };
    } else if (sub) {
      model = {
        id: sub.name.toLowerCase(),
        displayName: sub.name,
        source: parsed.value.normalizedSource,
        sha256: parsed.value.sha256,
        origin: "user-import",
        kind: "spice-subckt",
        interfaces: parsed.value.subcircuits,
        licenseNote: licenseNote || undefined,
      };
    }
    if (!model) {
      setDiagnostics([{ severity: "error", code: "MODEL_EMPTY", message: "preview has no model or subcircuit", blocksRun: true }]);
      return;
    }
    if (incompatible(model)) {
      setDiagnostics([
        { severity: "error", code: "MODEL_INCOMPATIBLE_REPLACEMENT", message: "existing component references are incompatible", blocksRun: true },
      ]);
      return;
    }
    onCommand({ type: "model/upsert", model });
    setDiagnostics([]);
  }

  return (
    <section className="workspace-models" aria-label="模型">
      <h2>模型</h2>
      <textarea ref={sourceRef} defaultValue="" aria-label="模型源" rows={4} />
      <label>
        许可说明
        <input value={licenseNote} onChange={event => setLicenseNote(event.target.value)} />
      </label>
      <button type="button" onClick={() => void previewSource(currentSource())}>
        预览模型
      </button>
      <button type="button" onClick={() => void adopt()}>
        采用模型
      </button>
      <input
        type="file"
        accept=".model,.lib,.cir,.txt"
        onChange={event => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > MAX_MODEL_BYTES) {
            setDiagnostics([{ severity: "error", code: "MODEL_TOO_LARGE", message: "file exceeds the size limit", blocksRun: true }]);
            return;
          }
          void file.text().then(value => {
            setSource(value);
            void previewSource(value);
          });
        }}
      />
      <p data-testid="model-preview">{preview}</p>
      <p data-testid="model-count">{String(project.models.length)}</p>
      {diagnostics.map(item => (
        <p key={item.code} data-testid={`diagnostic-${item.code}`}>
          {item.code}
        </p>
      ))}
      <ul>
        {project.models.map(model => (
          <li key={model.id} data-testid={`model-row-${model.id}`}>
            {`${model.displayName} ${model.sha256}${model.licenseNote ? ` ${model.licenseNote}` : ""}`}
            <button type="button" onClick={() => onCommand({ type: "model/remove", modelId: model.id })}>
              删除模型
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function familyMatchesKind(family: SpiceDeviceFamily, kind: CircuitProjectV2["schematic"]["components"][number]["kind"]) {
  if (kind === "diode") return family === "diode";
  if (kind === "switch") return family === "switch";
  if (kind === "bjt") return family === "npn" || family === "pnp";
  if (kind === "mosfet") return family === "nmos" || family === "pmos";
  return false;
}
