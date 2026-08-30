import type {
  AnalysisDefinition,
  AnalysisId,
  AppliedCorner,
  AssertionDefinition,
  AxisUnit,
  CircuitProjectV2,
  ComponentId,
  CornerDefinition,
  Diagnostic,
  ModelId,
  ProbeId,
  ProjectId,
  QuantityValue,
  ResultProjection,
  ResultQuantity,
  ResultUnit,
  RunId,
  VectorId,
  WireEndpoint,
} from "../domain/project/project-v2";

export type {
  AxisUnit,
  Diagnostic,
  ResultProjection,
  ResultQuantity,
  ResultUnit,
} from "../domain/project/project-v2";

export type ResultTransport = "vector-callback" | "binary-rawfile";

export interface RuntimeLimits {
  maxWasmHeapBytes: number;
  maxVirtualFsBytes: number;
  maxLogBytes: number;
  maxResultPoints: number;
  maxSingleVectorBytes: number;
  maxRawResultBytes: number;
  maxSnapshotTransferBytes: number;
  maxExpandedNetlistBytes: number;
}

export interface ResourceEstimate {
  axisPoints: number;
  resultPoints: number;
  maxSingleVectorBytes: number;
  rawResultBytes: number;
  snapshotTransferBytes: number;
  rawfileFsBytes: number;
  modelUtf8Bytes: number;
  expandedNetlistBytes: number;
  virtualFsBytes: number;
}

export interface RunPolicy {
  timeoutMs: number;
  keepLastRuns: number;
}

export type QualifiedResultTransport = ResultTransport;

export interface AdapterResult {
  exitCode: number;
  vectors: Array<{
    name: string;
    axisName: string;
    real: Float64Array;
    imaginary?: Float64Array;
  }>;
  log: string[];
  resultTransport: ResultTransport;
  rawResultBytes: number;
  rawfileFsBytes: number;
  wasmHeapPeakBytes: number;
  virtualFsPeakBytes: number;
}

export interface EngineFingerprint {
  name: "ngspice";
  version: string;
  resultTransport: ResultTransport;
  moduleSha256: string;
  wasmSha256: string;
  engineBuildId: string;
}

export interface EngineMetadata extends EngineFingerprint {
  verifiedAt: string;
}

export interface NgspiceRuntimeAdapter {
  initialize(input: {
    wasmUrl: string;
    expectedResultTransport: ResultTransport;
    expectedModuleSha256: string;
    expectedWasmSha256: string;
    expectedVersion: string;
    expectedEngineBuildId: string;
  }): Promise<EngineMetadata>;
  runBatch(input: {
    netlistUtf8: Uint8Array;
    modelFiles: Array<{ generatedName: string; utf8: Uint8Array }>;
    requestedVectors: string[];
    limits: RuntimeLimits;
  }): Promise<AdapterResult>;
  dispose(): Promise<void>;
}

export interface CompileRequest {
  project: CircuitProjectV2;
  analysis: AnalysisDefinition;
  corner?: {
    definition: CornerDefinition;
    ordinal: number;
    total: number;
  };
}

export interface CompiledModelFile {
  modelId: ModelId;
  sha256: string;
  generatedName: string;
}

export interface CompiledVectorRequest {
  probeId: ProbeId;
  sourceVectorName: string;
  quantity: ResultQuantity;
  projections: ResultProjection[];
  axisName: string;
}

export interface NetlistSourceMap {
  lineToComponent: Record<number, ComponentId>;
  componentToLines: Record<ComponentId, number[]>;
  endpointToNode: Record<string, string>;
  nodeToEndpoints: Record<string, WireEndpoint[]>;
}

export interface CompileResult {
  netlist: string;
  netlistHash: string;
  diagnostics: Diagnostic[];
  sourceMap: NetlistSourceMap;
  modelManifest: CompiledModelFile[];
  vectorPlan: CompiledVectorRequest[];
  vectorPlanHash: string;
  requestedRawVectors: string[];
  appliedCorner?: AppliedCorner;
}

export type RunPhase = "initializing" | "loading-models" | "running" | "parsing-results";

export interface SimulationRunRequest {
  appBuildId: string;
  runId: RunId;
  projectId: ProjectId;
  projectRevision: number;
  electricalRevision: number;
  analysisHash: string;
  requestedAssertionSetHash: string;
  analysis: AnalysisDefinition;
  corner?: AppliedCorner;
  compiled: CompileResult;
  models: Array<CompiledModelFile & { source: string }>;
}

export interface SimulationFailure {
  code: string;
  message: string;
  diagnostics: Diagnostic[];
  log: string[];
  retryable: boolean;
}

export type SimulationWorkerRequest =
  | { type: "initialize"; appBuildId: string; workerGeneration: number; requestId: string }
  | { type: "run"; appBuildId: string; workerGeneration: number; requestId: string; run: SimulationRunRequest };

export type SimulationWorkerEvent =
  | { type: "ready"; appBuildId: string; workerGeneration: number; requestId: string; engine: EngineMetadata }
  | {
      type: "initialization-failed";
      appBuildId: string;
      workerGeneration: number;
      requestId: string;
      error: SimulationFailure;
    }
  | {
      type: "progress";
      appBuildId: string;
      workerGeneration: number;
      requestId: string;
      runId: RunId;
      phase: RunPhase;
    }
  | {
      type: "completed";
      appBuildId: string;
      workerGeneration: number;
      requestId: string;
      runId: RunId;
      snapshot: SimulationSnapshot;
    }
  | {
      type: "run-failed";
      appBuildId: string;
      workerGeneration: number;
      requestId: string;
      runId: RunId;
      error: SimulationFailure;
    };

export interface ResultAxis {
  id: string;
  analysisId: AnalysisId;
  label: string;
  unit: AxisUnit;
  values: Float64Array;
}

export interface ResultVector {
  id: VectorId;
  probeId: ProbeId;
  analysisId: AnalysisId;
  quantity: ResultQuantity;
  projection: ResultProjection;
  sourceVectorName: string;
  label: string;
  unit: ResultUnit;
  axisId: string;
  values: Float64Array;
}

export interface SimulationSnapshot {
  schemaVersion: 1;
  appBuildId: string;
  runId: RunId;
  projectId: ProjectId;
  projectRevision: number;
  electricalRevision: number;
  analysisId: AnalysisId;
  analysis: AnalysisDefinition;
  analysisHash: string;
  netlistHash: string;
  vectorPlan: CompiledVectorRequest[];
  vectorPlanHash: string;
  engine: EngineMetadata;
  modelManifest: CompiledModelFile[];
  startedAt: string;
  finishedAt: string;
  axes: ResultAxis[];
  vectors: ResultVector[];
  diagnostics: Diagnostic[];
  log: string[];
}

export interface AssertionResult {
  id: string;
  assertionId: string;
  assertionDefinitionHash: string;
  assertionSetHash: string;
  runId: RunId;
  projectRevision: number;
  electricalRevision: number;
  status: "passed" | "failed" | "error";
  actual?: QuantityValue;
  diagnostics: Diagnostic[];
}

export interface AssertionEvaluation {
  id: string;
  runId: RunId;
  projectRevision: number;
  electricalRevision: number;
  assertionSetHash: string;
  evaluatedAt: string;
  definitions: AssertionDefinition[];
  results: AssertionResult[];
}

export interface RunRecordBase {
  schemaVersion: 1;
  appBuildId: string;
  runId: RunId;
  projectId: ProjectId;
  projectRevision: number;
  electricalRevision: number;
  analysisId: AnalysisId;
  analysis: AnalysisDefinition;
  analysisHash: string;
  requestedAssertions: AssertionDefinition[];
  requestedAssertionSetHash: string;
  netlistHash: string;
  vectorPlan: CompiledVectorRequest[];
  vectorPlanHash: string;
  requestedEngine: EngineFingerprint;
  modelManifest: CompiledModelFile[];
  inputBundle: {
    netlist: string;
    models: Array<CompiledModelFile & { source: string }>;
    sourceMap: NetlistSourceMap;
  };
  corner?: AppliedCorner;
  startedAt: string;
  preflightDiagnostics: Array<{
    phase: "schema" | "model" | "graph" | "erc" | "compile" | "resource";
    diagnostic: Diagnostic;
  }>;
}

export type RunRecord = RunRecordBase &
  (
    | { status: "running"; verifiedEngine?: EngineMetadata }
    | {
        status: "success";
        finishedAt: string;
        snapshot: SimulationSnapshot;
        assertionEvaluations: AssertionEvaluation[];
      }
    | {
        status: "failed";
        finishedAt: string;
        verifiedEngine?: EngineMetadata;
        failure: SimulationFailure;
      }
    | { status: "cancelled"; finishedAt: string; reason: "user" | "project-changed" }
    | { status: "timeout"; finishedAt: string; limitMs: number }
  );

export type SuccessfulRunRecord = Extract<RunRecord, { status: "success" }>;
