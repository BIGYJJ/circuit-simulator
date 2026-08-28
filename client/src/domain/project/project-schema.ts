/** FLUXLAB project trust boundary: strict JSON only; graph/ERC and all SPICE parsing happen in later dedicated layers. */
import { z } from "zod";
import type { CircuitProjectV2, Diagnostic, DomainResult } from "./project-v2";

const persistentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const refdesPattern = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const spiceTokenPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const parameterPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const netLabelPattern = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const maxProjectBytes = 5 * 1024 * 1024;
const finite = z.number().finite();
const positive = finite.positive();
const persistentId = z.string().refine((value) => persistentIdPattern.test(value) && !forbiddenKeys.has(value.toLowerCase()), "SCHEMA_BAD_ID");
const refdes = z.string().refine((value) => value === "GND" || refdesPattern.test(value), "SCHEMA_BAD_REFDES");
const spiceToken = z.string().refine((value) => spiceTokenPattern.test(value) && !forbiddenKeys.has(value.toLowerCase()), "SCHEMA_BAD_TOKEN");
const parameterName = z.string().refine((value) => parameterPattern.test(value) && !forbiddenKeys.has(value.toLowerCase()), "SCHEMA_BAD_PARAMETER");
const netLabel = z.string().refine((value) => netLabelPattern.test(value) && !forbiddenKeys.has(value.toLowerCase()), "SCHEMA_BAD_NET_LABEL");
const emptyObject = z.object({}).strict();

const voltageWaveform = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pulse"), initialV: finite, pulsedV: finite, delayS: finite.min(0), riseS: finite.min(0), fallS: finite.min(0), widthS: finite.min(0), periodS: positive }).strict().superRefine((value, context) => { if (value.widthS + value.riseS + value.fallS > value.periodS) context.addIssue({ code: "custom", message: "SCHEMA_BAD_PULSE" }); }),
  z.object({ kind: z.literal("sin"), offsetV: finite, amplitudeV: finite, frequencyHz: positive, delayS: finite.min(0), dampingPerS: finite, phaseDeg: finite }).strict(),
  z.object({ kind: z.literal("pwl"), points: z.array(z.object({ timeS: finite.min(0), valueV: finite }).strict()).min(2) }).strict().superRefine((value, context) => { if (value.points.some((point, index) => index > 0 && point.timeS <= value.points[index - 1].timeS)) context.addIssue({ code: "custom", message: "SCHEMA_BAD_PWL" }); }),
]);
const currentWaveform = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pulse"), initialA: finite, pulsedA: finite, delayS: finite.min(0), riseS: finite.min(0), fallS: finite.min(0), widthS: finite.min(0), periodS: positive }).strict().superRefine((value, context) => { if (value.widthS + value.riseS + value.fallS > value.periodS) context.addIssue({ code: "custom", message: "SCHEMA_BAD_PULSE" }); }),
  z.object({ kind: z.literal("sin"), offsetA: finite, amplitudeA: finite, frequencyHz: positive, delayS: finite.min(0), dampingPerS: finite, phaseDeg: finite }).strict(),
  z.object({ kind: z.literal("pwl"), points: z.array(z.object({ timeS: finite.min(0), valueA: finite }).strict()).min(2) }).strict().superRefine((value, context) => { if (value.points.some((point, index) => index > 0 && point.timeS <= value.points[index - 1].timeS)) context.addIssue({ code: "custom", message: "SCHEMA_BAD_PWL" }); }),
]);
const sourceParams = <K extends "V" | "A">(unit: K) => z.object(unit === "V" ? { dcV: finite.optional(), ac: z.object({ magnitudeV: finite.min(0), phaseDeg: finite }).strict().optional(), transient: voltageWaveform.optional() } : { dcA: finite.optional(), ac: z.object({ magnitudeA: finite.min(0), phaseDeg: finite }).strict().optional(), transient: currentWaveform.optional() }).strict().superRefine((value, context) => { if (!("dcV" in value || "dcA" in value || "ac" in value || "transient" in value)) context.addIssue({ code: "custom", message: "SCHEMA_SOURCE_EMPTY" }); });
const componentBase = { id: persistentId, refdes };
const componentSchema = z.discriminatedUnion("kind", [
  z.object({ ...componentBase, kind: z.literal("resistor"), params: z.object({ resistanceOhm: positive }).strict() }).strict(),
  z.object({ ...componentBase, kind: z.literal("capacitor"), params: z.object({ capacitanceF: positive }).strict() }).strict(),
  z.object({ ...componentBase, kind: z.literal("inductor"), params: z.object({ inductanceH: positive }).strict() }).strict(),
  z.object({ ...componentBase, kind: z.literal("voltageSource"), params: sourceParams("V") }).strict(),
  z.object({ ...componentBase, kind: z.literal("currentSource"), params: sourceParams("A") }).strict(),
  z.object({ ...componentBase, kind: z.literal("switch"), params: emptyObject, modelRef: persistentId }).strict(),
  z.object({ ...componentBase, kind: z.literal("diode"), params: z.object({ area: positive }).strict(), modelRef: persistentId }).strict(),
  z.object({ ...componentBase, kind: z.literal("bjt"), params: z.object({ area: positive }).strict(), modelRef: persistentId }).strict(),
  z.object({ ...componentBase, kind: z.literal("mosfet"), params: z.object({ lengthM: positive, widthM: positive, multiplicity: positive }).strict(), modelRef: persistentId }).strict(),
  z.object({ ...componentBase, kind: z.literal("subcircuit"), params: z.object({ parameterOverrides: z.record(parameterName, finite) }).strict(), modelRef: persistentId, subcircuitName: spiceToken, orderedPins: z.array(spiceToken).min(1) }).strict(),
  z.object({ ...componentBase, kind: z.literal("ground"), params: emptyObject }).strict(),
]).superRefine((component, context) => {
  const family = ({ resistor: "R", capacitor: "C", inductor: "L", voltageSource: "V", currentSource: "I", switch: "S", diode: "D", bjt: "Q", mosfet: "M", subcircuit: "X" } as const)[component.kind as Exclude<typeof component.kind, "ground">];
  if (component.kind === "ground") { if (component.refdes !== "GND") context.addIssue({ code: "custom", message: "SCHEMA_BAD_REFDES" }); }
  else if (component.refdes[0]?.toUpperCase() !== family) context.addIssue({ code: "custom", message: "SCHEMA_BAD_REFDES" });
});
const endpoint = z.object({ componentId: persistentId, pin: spiceToken }).strict();
const analysisBase = { id: persistentId, name: z.string().min(1).max(160), enabledProbes: z.array(persistentId).max(2000) };
const analysis = z.union([
  z.object({ ...analysisBase, kind: z.literal("dc-op") }).strict(),
  z.object({ ...analysisBase, kind: z.literal("dc-sweep"), sweep: z.union([z.object({ sourceComponentId: persistentId, quantity: z.literal("voltage"), startV: finite, stopV: finite, stepV: finite }).strict(), z.object({ sourceComponentId: persistentId, quantity: z.literal("current"), startA: finite, stopA: finite, stepA: finite }).strict()]) }).strict().superRefine((value, context) => { const sweep = value.sweep; const start = "startV" in sweep ? sweep.startV : sweep.startA; const stop = "stopV" in sweep ? sweep.stopV : sweep.stopA; const step = "stepV" in sweep ? sweep.stepV : sweep.stepA; if (step === 0 || (stop - start) * step < 0) context.addIssue({ code: "custom", message: "SCHEMA_BAD_SWEEP" }); }),
  z.object({ ...analysisBase, kind: z.literal("transient"), stepS: positive, stopS: positive, startS: finite.min(0).optional(), maxStepS: positive.optional() }).strict().superRefine((value, context) => { if ((value.startS ?? 0) >= value.stopS) context.addIssue({ code: "custom", message: "SCHEMA_BAD_TRANSIENT" }); }),
  z.object({ ...analysisBase, kind: z.literal("ac"), startHz: positive, stopHz: positive, scale: z.enum(["lin", "dec", "oct"]), totalPoints: z.number().int().positive().optional(), pointsPerInterval: z.number().int().positive().optional() }).strict().superRefine((value, context) => { if (value.startHz >= value.stopHz || (value.scale === "lin" ? !value.totalPoints || value.pointsPerInterval : !value.pointsPerInterval || value.totalPoints)) context.addIssue({ code: "custom", message: "SCHEMA_BAD_AC" }); }),
]);
const model = z.union([
  z.object({ id: persistentId, displayName: z.string().min(1).max(160), source: z.string().max(10 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/), origin: z.enum(["bundled", "user-import"]), licenseNote: z.string().max(2000).optional(), kind: z.literal("spice-model"), modelName: spiceToken, deviceFamily: z.enum(["switch", "diode", "npn", "pnp", "nmos", "pmos"]) }).strict(),
  z.object({ id: persistentId, displayName: z.string().min(1).max(160), source: z.string().max(10 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/), origin: z.enum(["bundled", "user-import"]), licenseNote: z.string().max(2000).optional(), kind: z.literal("spice-subckt"), interfaces: z.array(z.object({ name: spiceToken, orderedPins: z.array(spiceToken).min(1), parameterNames: z.array(parameterName), parameterDefaults: z.record(parameterName, finite) }).strict()).min(1) }).strict(),
]);
const measurementUnit = z.enum(["s", "Hz", "V", "A", "index", "dB", "deg", "W", "dimensionless"]);
const quantityValue = z.object({ value: finite, unit: measurementUnit }).strict();
const measurementExpression = z.discriminatedUnion("function", [
  z.object({ function: z.literal("valueAt"), vectorId: persistentId, at: quantityValue }).strict(),
  z.object({ function: z.enum(["min", "max", "mean"]), vectorId: persistentId }).strict(),
  z.object({ function: z.literal("crossingTime"), vectorId: persistentId, threshold: quantityValue, edge: z.enum(["rising", "falling"]) }).strict(),
  z.object({ function: z.literal("bandwidth3dB"), vectorId: persistentId }).strict(),
]);
const assertionComparator = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["lt", "lte", "gt", "gte"]), expected: quantityValue }).strict(),
  z.object({ kind: z.literal("between"), minimum: quantityValue, maximum: quantityValue, inclusive: z.literal(true) }).strict().superRefine((value, context) => { if (value.minimum.unit !== value.maximum.unit || value.minimum.value > value.maximum.value) context.addIssue({ code: "custom", message: "SCHEMA_BAD_COMPARATOR" }); }),
  z.object({ kind: z.literal("near"), expected: quantityValue, absoluteTolerance: quantityValue.optional(), relativeTolerance: finite.min(0).max(1).optional() }).strict().superRefine((value, context) => { if ((!value.absoluteTolerance && !value.relativeTolerance) || (value.absoluteTolerance && (value.absoluteTolerance.unit !== value.expected.unit || value.absoluteTolerance.value <= 0)) || (value.expected.value === 0 && !value.absoluteTolerance)) context.addIssue({ code: "custom", message: "SCHEMA_BAD_COMPARATOR" }); }),
]);
const assertion = z.object({ id: persistentId, name: z.string().min(1).max(160), enabled: z.boolean(), analysisId: persistentId, expression: measurementExpression, comparator: assertionComparator }).strict();
const corner = z.object({ id: persistentId, name: z.string().min(1).max(160), enabled: z.boolean(), overrides: z.array(z.union([z.object({ kind: z.literal("component-parameter"), componentId: persistentId, path: z.string().regex(/^(resistanceOhm|capacitanceF|inductanceH|dcV|dcA|area|lengthM|widthM|multiplicity|parameterOverrides\.[A-Za-z_][A-Za-z0-9_]*)$/), value: finite }).strict(), z.object({ kind: z.literal("component-model"), componentId: persistentId, modelRef: persistentId }).strict()])) }).strict();
export const circuitProjectV2Schema = z.object({
  schemaVersion: z.literal(2), id: persistentId, title: z.string().min(1).max(160), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), revision: z.number().int().nonnegative(), electricalRevision: z.number().int().nonnegative(),
  schematic: z.object({ components: z.array(componentSchema).max(2000), wires: z.array(z.object({ id: persistentId, from: endpoint, to: endpoint, netLabel: netLabel.optional() }).strict()).max(5000) }).strict(),
  layout: z.object({ components: z.record(persistentId, z.object({ x: finite, y: finite, rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), mirrored: z.boolean().optional() }).strict()), wireRoutes: z.record(persistentId, z.array(z.object({ x: finite, y: finite }).strict()).max(10000)), viewport: z.object({ x: finite, y: finite, zoom: positive }).strict().optional() }).strict(),
  models: z.array(model), analyses: z.array(analysis), probes: z.array(z.union([z.object({ id: persistentId, kind: z.literal("node-voltage"), node: endpoint, label: z.string().min(1).max(160) }).strict(), z.object({ id: persistentId, kind: z.literal("differential-voltage"), positive: endpoint, negative: endpoint, label: z.string().min(1).max(160) }).strict(), z.object({ id: persistentId, kind: z.enum(["branch-current", "device-power"]), componentId: persistentId, label: z.string().min(1).max(160) }).strict()])), assertions: z.array(assertion), corners: z.array(corner), notes: z.array(z.object({ id: persistentId, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), body: z.string().max(10000) }).strict()),
}).strict().superRefine((project, context) => {
  const byteLength = new TextEncoder().encode(JSON.stringify(project)).byteLength;
  if (byteLength > maxProjectBytes) context.addIssue({ code: "custom", message: "SCHEMA_PROJECT_TOO_LARGE" });
  const componentIds = new Set<string>();
  const refdeses = new Set<string>();
  for (const component of project.schematic.components) { const refdesKey = component.refdes.toUpperCase(); if (componentIds.has(component.id)) context.addIssue({ code: "custom", message: "SCHEMA_DUPLICATE_ID" }); if (refdeses.has(refdesKey)) context.addIssue({ code: "custom", message: "SCHEMA_DUPLICATE_REFDES" }); componentIds.add(component.id); refdeses.add(refdesKey); }
  const collections = [project.schematic.wires, project.models, project.analyses, project.probes, project.assertions, project.corners, project.notes];
  for (const entries of collections) { const ids = new Set<string>(); for (const entry of entries) { if (ids.has(entry.id)) context.addIssue({ code: "custom", message: "SCHEMA_DUPLICATE_ID" }); ids.add(entry.id); } }
  const modelIds = new Set(project.models.map((entry) => entry.id));
  const probeIds = new Set(project.probes.map((entry) => entry.id));
  const analysisIds = new Set(project.analyses.map((entry) => entry.id));
  for (const component of project.schematic.components) if ("modelRef" in component && !modelIds.has(component.modelRef)) context.addIssue({ code: "custom", message: "SCHEMA_UNKNOWN_MODEL" });
  for (const entry of project.analyses) if (entry.enabledProbes.some((id) => !probeIds.has(id))) context.addIssue({ code: "custom", message: "SCHEMA_UNKNOWN_PROBE" });
  for (const entry of project.assertions) if (!analysisIds.has(entry.analysisId)) context.addIssue({ code: "custom", message: "SCHEMA_UNKNOWN_ANALYSIS" });
  for (const entry of project.corners) for (const override of entry.overrides) if (!componentIds.has(override.componentId) || (override.kind === "component-model" && !modelIds.has(override.modelRef))) context.addIssue({ code: "custom", message: "SCHEMA_BAD_CORNER_REFERENCE" });
});

function findNonFinite(value: unknown, path: Array<string | number> = [], found: Array<Array<string | number>> = []): Array<Array<string | number>> { if (typeof value === "number" && !Number.isFinite(value)) found.push(path); else if (Array.isArray(value)) value.forEach((entry, index) => findNonFinite(entry, [...path, index], found)); else if (value && typeof value === "object") Object.keys(value).forEach((key) => findNonFinite((value as Record<string, unknown>)[key], [...path, key], found)); return found; }
function flattenZodIssues(issues: z.ZodIssue[]): z.ZodIssue[] { return issues.flatMap((issue) => { const nested = issue as z.ZodIssue & { errors?: z.ZodIssue[][] }; return issue.code === "invalid_union" && Array.isArray(nested.errors) ? flattenZodIssues(nested.errors.flat()) : [issue]; }); }
function zodIssuesToDiagnostics(issues: z.ZodIssue[], nonFinitePaths: Array<Array<string | number>>): Diagnostic[] { const nonFiniteKeys = new Set(nonFinitePaths.map((path) => path.join("."))); const output: Diagnostic[] = nonFinitePaths.map((path) => ({ severity: "error", code: "SCHEMA_NON_FINITE", message: "Project values must be finite numbers.", location: { field: path.join(".") }, blocksRun: true })); for (const issue of flattenZodIssues(issues)) { const field = issue.path.join("."); if (nonFiniteKeys.has(field)) continue; const code = issue.message.startsWith("SCHEMA_") ? issue.message : issue.code === "unrecognized_keys" ? "SCHEMA_UNKNOWN_FIELD" : field.endsWith("refdes") ? "SCHEMA_BAD_REFDES" : field.endsWith("id") ? "SCHEMA_BAD_ID" : "SCHEMA_INVALID"; output.push({ severity: "error", code, message: "Circuit project input does not satisfy the v2 schema.", location: field ? { field } : undefined, blocksRun: true }); } return output; }
export function parseCircuitProjectV2(input: unknown): DomainResult<CircuitProjectV2> { const nonFinitePaths = findNonFinite(input); const parsed = circuitProjectV2Schema.safeParse(input); if (parsed.success && nonFinitePaths.length === 0) return { ok: true, value: parsed.data as CircuitProjectV2, diagnostics: [] }; return { ok: false, diagnostics: zodIssuesToDiagnostics(parsed.success ? [] : parsed.error.issues, nonFinitePaths) }; }
