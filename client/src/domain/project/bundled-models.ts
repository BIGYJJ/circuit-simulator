import { sha256Hex } from "./canonical";
import type { ModelDefinition, SpiceDeviceFamily, SubcircuitInterface } from "./project-v2";

export interface BundledModelLedgerEntry {
  modelId: string;
  sha256: string;
  source: string;
  kind: ModelDefinition["kind"];
  deviceFamily?: SpiceDeviceFamily;
  interfaces?: SubcircuitInterface[];
  licenseNote: string;
  sourceVersion: string;
}

export const LED_DIODE_SOURCE_V1 = ".model DLED D(IS=1e-14 N=1.7 RS=12)\n";
export const LED_DIODE_SOURCE_V2 = ".model DLED D(IS=1e-14 N=1.8 RS=10)\n";
export const SWITCH_MIGRATION_SOURCE = ".model SWMIG SW(VT=0.5 VH=0.1 RON=1 ROFF=1Meg)\n";

async function entry(
  modelId: string,
  source: string,
  kind: ModelDefinition["kind"],
  extras: Omit<BundledModelLedgerEntry, "modelId" | "sha256" | "source" | "kind">
): Promise<BundledModelLedgerEntry> {
  return {
    modelId,
    source,
    sha256: await sha256Hex(source),
    kind,
    ...extras,
  };
}

let ledger: BundledModelLedgerEntry[] | null = null;

export async function getBundledModelManifest(): Promise<BundledModelLedgerEntry[]> {
  if (ledger) return ledger;
  ledger = [
    await entry("dled-v1", LED_DIODE_SOURCE_V1, "spice-model", {
      deviceFamily: "diode",
      licenseNote: "Teaching 1N4148-like LED diode, append-only v1.",
      sourceVersion: "dled-1",
    }),
    await entry("dled-v2", LED_DIODE_SOURCE_V2, "spice-model", {
      deviceFamily: "diode",
      licenseNote: "Teaching 1N4148-like LED diode, append-only v2.",
      sourceVersion: "dled-2",
    }),
    await entry("swmig-v1", SWITCH_MIGRATION_SOURCE, "spice-model", {
      deviceFamily: "switch",
      licenseNote: "Migration-only voltage-controlled switch.",
      sourceVersion: "swmig-1",
    }),
  ];
  return ledger;
}

export const CURRENT_BUNDLED_MODEL_KEYS = {
  led: "dled-v2",
  migrationSwitch: "swmig-v1",
} as const;

export async function bundledModelDefinition(modelId: string): Promise<ModelDefinition | null> {
  const found = (await getBundledModelManifest()).find(item => item.modelId === modelId);
  if (!found) return null;
  if (found.kind === "spice-model") {
    return {
      id: found.modelId,
      displayName: found.modelId,
      source: found.source,
      sha256: found.sha256,
      origin: "bundled",
      licenseNote: found.licenseNote,
      kind: "spice-model",
      modelName: found.kind === "spice-model" ? (found.source.match(/^\.model\s+(\S+)/i)?.[1] ?? "DLED") : "DLED",
      deviceFamily: found.deviceFamily ?? "diode",
    };
  }
  return {
    id: found.modelId,
    displayName: found.modelId,
    source: found.source,
    sha256: found.sha256,
    origin: "bundled",
    licenseNote: found.licenseNote,
    kind: "spice-subckt",
    interfaces: found.interfaces ?? [],
  };
}

export function bundledManifestForValidation() {
  return getBundledModelManifest().then(items =>
    items.map(item => ({
      modelId: item.modelId,
      sha256: item.sha256,
      kind: item.kind,
      deviceFamily: item.deviceFamily,
      interfaces: item.interfaces,
      licenseNote: item.licenseNote,
      sourceVersion: item.sourceVersion,
    }))
  );
}
