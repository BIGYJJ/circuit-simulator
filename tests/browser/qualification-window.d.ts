interface QualificationResult {
  dividerVout: number;
  rcAt1Tau: number;
  rcAt5Tau: number;
  diodeCurrentRatio: number;
  lowpassCutoffHz: number;
  subcircuitVout: number;
  dividerR1PowerW: number;
  diodePowerMatchesVI: boolean;
  secondRunEqualsFirst: boolean;
  cancelledWorkerRebuilt: boolean;
  webLocksAvailable: boolean;
  cancelReadyMs: number;
  hashMismatchCode: string;
  moduleHashMismatchCode: string;
  versionMismatchCode: string;
  transportMismatchCode: string;
  engineBuildMismatchCode: string;
  resultTransport: "vector-callback" | "binary-rawfile";
  rawfileFsBytes: number;
  rawfileEstimateCoversActual: boolean;
  limitCodes: string[];
  fsEntriesAfterRun: string[];
  plotsAfterCleanup: string[];
  businessRequests: string[];
}

interface Window {
  __qualificationResult: Promise<QualificationResult>;
  __fluxlabTestDelaySaveMs?: number;
  __idbGets?: number;
  __idbGetAlls?: number;
  __fluxlabRunStorage?: any;
  __fluxlabBuildRunningRecord?: any;
  __fluxlabPatchedDelete?: () => void;
  __fluxlabHeldLock?: boolean;
  __fluxlabReleaseHeldLock?: () => void;
  __fluxlabWorkerCreations?: number;
}
