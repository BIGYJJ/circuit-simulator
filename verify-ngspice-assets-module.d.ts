declare module "./scripts/verify-ngspice-assets.mjs" {
  export function parseSha256Sums(text: string): Map<string, string>;
  export function hashBytes(bytes: Uint8Array): string;
  export function readEngineFingerprint(root?: string): {
    moduleSha256: string;
    wasmSha256: string;
    transport: string;
    engineBuildId: string;
  };
  export function verifyQualifiedObservations(manifest: unknown, observations: unknown): unknown;
}
