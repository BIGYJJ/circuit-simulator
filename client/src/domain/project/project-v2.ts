/** FLUXLAB domain contract: every persistent circuit fact is typed here before UI or simulation code can consume it. */

export type ProjectId = string;
export type ComponentId = string;
export type WireId = string;
export type ModelId = string;
export type AnalysisId = string;
export type ProbeId = string;
export type CornerId = string;
export type RunId = string;
export type VectorId = string;

export type AxisUnit = "s" | "Hz" | "V" | "A" | "index";
export type ResultUnit = "V" | "A" | "dB" | "deg" | "W" | "dimensionless";
export type ResultQuantity = "voltage" | "current" | "power";
export type ResultProjection = "scalar" | "real" | "imaginary" | "magnitude" | "phase" | "db20";

export interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  location?: {
    componentId?: ComponentId; wireId?: WireId; modelId?: ModelId; analysisId?: AnalysisId;
    probeId?: ProbeId; assertionId?: string; cornerId?: CornerId; runId?: RunId;
    sourceName?: string; field?: string; line?: number; endLine?: number;
  };
  blocksRun: boolean;
  helpId?: string;
}

export type DomainResult<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

export interface ComponentBase<K extends string, P> { id: ComponentId; refdes: string; kind: K; params: P; }
export type VoltageTransientWaveform =
  | { kind: "pulse"; initialV: number; pulsedV: number; delayS: number; riseS: number; fallS: number; widthS: number; periodS: number }
  | { kind: "sin"; offsetV: number; amplitudeV: number; frequencyHz: number; delayS: number; dampingPerS: number; phaseDeg: number }
  | { kind: "pwl"; points: Array<{ timeS: number; valueV: number }> };
export type CurrentTransientWaveform =
  | { kind: "pulse"; initialA: number; pulsedA: number; delayS: number; riseS: number; fallS: number; widthS: number; periodS: number }
  | { kind: "sin"; offsetA: number; amplitudeA: number; frequencyHz: number; delayS: number; dampingPerS: number; phaseDeg: number }
  | { kind: "pwl"; points: Array<{ timeS: number; valueA: number }> };

export type ComponentInstance =
  | ComponentBase<"resistor", { resistanceOhm: number }>
  | ComponentBase<"capacitor", { capacitanceF: number }>
  | ComponentBase<"inductor", { inductanceH: number }>
  | ComponentBase<"voltageSource", { dcV?: number; ac?: { magnitudeV: number; phaseDeg: number }; transient?: VoltageTransientWaveform }>
  | ComponentBase<"currentSource", { dcA?: number; ac?: { magnitudeA: number; phaseDeg: number }; transient?: CurrentTransientWaveform }>
  | (ComponentBase<"switch", Record<string, never>> & { modelRef: ModelId })
  | (ComponentBase<"diode", { area: number }> & { modelRef: ModelId })
  | (ComponentBase<"bjt", { area: number }> & { modelRef: ModelId })
  | (ComponentBase<"mosfet", { lengthM: number; widthM: number; multiplicity: number }> & { modelRef: ModelId })
  | (ComponentBase<"subcircuit", { parameterOverrides: Record<string, number> }> & { modelRef: ModelId; subcircuitName: string; orderedPins: string[] })
  | ComponentBase<"ground", Record<string, never>>;
export type ComponentKind = ComponentInstance["kind"];

export interface WireEndpoint { componentId: ComponentId; pin: string; }
export interface SchematicWire { id: WireId; from: WireEndpoint; to: WireEndpoint; netLabel?: string; }
export interface SchematicDocument { components: ComponentInstance[]; wires: SchematicWire[]; }
export interface ComponentLayout { x: number; y: number; rotation: 0 | 90 | 180 | 270; mirrored?: boolean; }
export interface SchematicLayout { components: Record<ComponentId, ComponentLayout>; wireRoutes: Record<WireId, Array<{ x: number; y: number }>>; viewport?: { x: number; y: number; zoom: number }; }

export type SpiceDeviceFamily = "switch" | "diode" | "npn" | "pnp" | "nmos" | "pmos";
export interface ModelBase { id: ModelId; displayName: string; source: string; sha256: string; origin: "bundled" | "user-import"; licenseNote?: string; }
export interface SubcircuitInterface { name: string; orderedPins: string[]; parameterNames: string[]; parameterDefaults: Record<string, number>; }
export type ModelDefinition =
  | (ModelBase & { kind: "spice-model"; modelName: string; deviceFamily: SpiceDeviceFamily })
  | (ModelBase & { kind: "spice-subckt"; interfaces: SubcircuitInterface[] });

export interface AnalysisBase { id: AnalysisId; name: string; enabledProbes: ProbeId[]; }
export interface DcOperatingPointAnalysis extends AnalysisBase { kind: "dc-op"; }
export type SourceSweep =
  | { sourceComponentId: ComponentId; quantity: "voltage"; startV: number; stopV: number; stepV: number }
  | { sourceComponentId: ComponentId; quantity: "current"; startA: number; stopA: number; stepA: number };
export interface DcSweepAnalysis extends AnalysisBase { kind: "dc-sweep"; sweep: SourceSweep; }
export interface TransientAnalysis extends AnalysisBase { kind: "transient"; stepS: number; stopS: number; startS?: number; maxStepS?: number; }
export type AcAnalysis = AnalysisBase & { kind: "ac"; startHz: number; stopHz: number } & (
  | { scale: "lin"; totalPoints: number }
  | { scale: "dec" | "oct"; pointsPerInterval: number }
);
export type AnalysisDefinition = DcOperatingPointAnalysis | DcSweepAnalysis | TransientAnalysis | AcAnalysis;

export type ProbeDefinition =
  | { id: ProbeId; kind: "node-voltage"; node: WireEndpoint; label: string }
  | { id: ProbeId; kind: "differential-voltage"; positive: WireEndpoint; negative: WireEndpoint; label: string }
  | { id: ProbeId; kind: "branch-current"; componentId: ComponentId; label: string }
  | { id: ProbeId; kind: "device-power"; componentId: ComponentId; label: string };
export type MeasurementUnit = AxisUnit | ResultUnit;
export interface QuantityValue { value: number; unit: MeasurementUnit; }
export type MeasurementExpression =
  | { function: "valueAt"; vectorId: VectorId; at: QuantityValue }
  | { function: "min" | "max" | "mean"; vectorId: VectorId }
  | { function: "crossingTime"; vectorId: VectorId; threshold: QuantityValue; edge: "rising" | "falling" }
  | { function: "bandwidth3dB"; vectorId: VectorId };
export type AssertionComparator =
  | { kind: "lt" | "lte" | "gt" | "gte"; expected: QuantityValue }
  | { kind: "between"; minimum: QuantityValue; maximum: QuantityValue; inclusive: true }
  | { kind: "near"; expected: QuantityValue; absoluteTolerance?: QuantityValue; relativeTolerance?: number };
export interface AssertionDefinition { id: string; name: string; enabled: boolean; analysisId: AnalysisId; expression: MeasurementExpression; comparator: AssertionComparator; }

export type CornerParameterPath = "resistanceOhm" | "capacitanceF" | "inductanceH" | "dcV" | "dcA" | "area" | "lengthM" | "widthM" | "multiplicity" | `parameterOverrides.${string}`;
export type CornerOverride =
  | { kind: "component-parameter"; componentId: ComponentId; path: CornerParameterPath; value: number }
  | { kind: "component-model"; componentId: ComponentId; modelRef: ModelId };
export interface CornerDefinition { id: CornerId; name: string; enabled: boolean; overrides: CornerOverride[]; }
export interface ProjectNote { id: string; createdAt: string; updatedAt: string; body: string; }
export interface LearningEvidence { projectId: ProjectId; lessonId: string; steps: Array<{ stepId: string; projectRevision: number; runId: RunId; prediction: string | number | boolean | null; assertionResultIds: string[]; completedAt: string }>; }

export interface CircuitProjectV2 {
  schemaVersion: 2; id: ProjectId; title: string; createdAt: string; updatedAt: string; revision: number; electricalRevision: number;
  schematic: SchematicDocument; layout: SchematicLayout; models: ModelDefinition[]; analyses: AnalysisDefinition[];
  probes: ProbeDefinition[]; assertions: AssertionDefinition[]; corners: CornerDefinition[]; notes: ProjectNote[];
}
