export type QualifiedVectorCapability =
  | {
      quantity: "branch-current";
      family: "R" | "C" | "L" | "V" | "I" | "D" | "S";
      analysis: "dc-op" | "dc-sweep" | "transient" | "ac";
      rawNameTemplate: string;
      positiveDirection: "p-to-n";
    }
  | {
      quantity: "device-power";
      family: "R" | "D";
      analysis: "dc-op" | "dc-sweep" | "transient";
      rawNameTemplate: string;
      sign: "absorbed";
    };

export interface QualifiedVectorManifest {
  schemaVersion: 1;
  capabilities: QualifiedVectorCapability[];
}

export function parseQualifiedVectorManifest(
  input: unknown
): QualifiedVectorManifest;
export function resolveQualifiedVector(
  manifest: unknown,
  request: {
    quantity: QualifiedVectorCapability["quantity"];
    family: string;
    analysis: string;
    refdes: string;
  }
): string | null;
export function listQualifiedFamilies(
  manifest: unknown,
  quantity: QualifiedVectorCapability["quantity"],
  analysis: string
): string[];
