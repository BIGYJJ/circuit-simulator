import qualifiedVectors from "../../../../vendor/ngspice/QUALIFIED_VECTORS.json";
import type { AnalysisDefinition, CircuitProjectV2, Diagnostic, DomainResult, ProbeDefinition } from "../../domain/project/project-v2";
import { REFDES_FAMILY_PREFIX } from "../../domain/project/project-v2";
import { compileNetlist } from "../../simulation/compile-netlist";
import { listQualifiedFamilies } from "../../simulation/qualified-vectors.mjs";

export type QualifiedVectorManifestInput = unknown;

function fail(code: string, message: string): DomainResult<ProbeDefinition> {
  return { ok: false, diagnostics: [{ severity: "error", code, message, blocksRun: true }] };
}

export function activeQualifiedVectorManifest(): QualifiedVectorManifestInput {
  if (typeof window !== "undefined") {
    const injected = (window as Window & { __fluxlabQualifiedVectorManifest?: unknown }).__fluxlabQualifiedVectorManifest;
    if (injected) return injected;
  }
  return qualifiedVectors;
}

function familyOf(project: CircuitProjectV2, probe: ProbeDefinition) {
  if (probe.kind !== "branch-current" && probe.kind !== "device-power") return "";
  const component = project.schematic.components.find(item => item.id === probe.componentId);
  if (!component || component.kind === "ground") return "";
  return REFDES_FAMILY_PREFIX[component.kind];
}

export async function validateProbeDraft(
  project: CircuitProjectV2,
  analysis: AnalysisDefinition,
  probe: ProbeDefinition,
  manifest: QualifiedVectorManifestInput = activeQualifiedVectorManifest()
): Promise<DomainResult<ProbeDefinition>> {
  const family = familyOf(project, probe);
  if (probe.kind === "branch-current" && (family === "Q" || family === "M" || family === "X")) {
    return fail("PROBE_AMBIGUOUS_BRANCH_CURRENT", "branch current is ambiguous for Q/M/X");
  }
  if (probe.kind === "device-power" && (analysis.kind === "ac" || family === "X")) {
    return fail("PROBE_UNSUPPORTED_DEVICE_POWER", "device power is not qualified for this analysis or device");
  }
  if (probe.kind === "branch-current" || probe.kind === "device-power") {
    const quantity = probe.kind === "branch-current" ? "branch-current" : "device-power";
    const allowed = listQualifiedFamilies(manifest, quantity, analysis.kind);
    if (!allowed.includes(family)) {
      return fail(
        probe.kind === "device-power" ? "PROBE_UNSUPPORTED_DEVICE_POWER" : "PROBE_UNSUPPORTED_BRANCH_CURRENT",
        "probe tuple is absent from the qualified vector matrix"
      );
    }
  }
  const next: CircuitProjectV2 = {
    ...project,
    probes: [...project.probes.filter(item => item.id !== probe.id), probe],
  };
  const compiled = await compileNetlist({
    project: next,
    analysis: { ...analysis, enabledProbes: [...new Set([...analysis.enabledProbes, probe.id])] },
  });
  if (!compiled.ok) return compiled;
  return { ok: true, value: probe, diagnostics: compiled.diagnostics };
}

export function probeDraftDiagnostics(result: DomainResult<ProbeDefinition>): Diagnostic[] {
  return result.ok ? result.diagnostics : result.diagnostics;
}
