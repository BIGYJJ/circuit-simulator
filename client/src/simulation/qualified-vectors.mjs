import { z } from "zod";

const FAMILIES_CURRENT = ["R", "C", "L", "V", "I", "D", "S"];
const FAMILIES_POWER = ["R", "D"];
const ANALYSES = ["dc-op", "dc-sweep", "transient", "ac"];
const FRAGMENT = /^[A-Za-z0-9_@#.[\]:+\-]{0,64}$/;
const TEMPLATE = /^(.*)\{ref\}(.*)$/;
const REFDES = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const branchCurrentCapability = z
  .object({
    quantity: z.literal("branch-current"),
    family: z.enum(FAMILIES_CURRENT),
    analysis: z.enum(ANALYSES),
    rawNameTemplate: z.string(),
    positiveDirection: z.literal("p-to-n"),
  })
  .strict();

const devicePowerCapability = z
  .object({
    quantity: z.literal("device-power"),
    family: z.enum(FAMILIES_POWER),
    analysis: z.enum(["dc-op", "dc-sweep", "transient"]),
    rawNameTemplate: z.string(),
    sign: z.literal("absorbed"),
  })
  .strict();

const capabilitySchema = z.union([branchCurrentCapability, devicePowerCapability]);

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    capabilities: z.array(capabilitySchema),
  })
  .strict();

function sortKey(capability) {
  return `${capability.quantity}\0${capability.family}\0${capability.analysis}`;
}

function assertTemplate(template) {
  const match = TEMPLATE.exec(template);
  if (!match || template.includes("{") !== template.includes("{ref}")) {
    throw new Error("invalid rawNameTemplate");
  }
  const open = (template.match(/\{/g) ?? []).length;
  const close = (template.match(/\}/g) ?? []).length;
  if (open !== 1 || close !== 1) throw new Error("invalid rawNameTemplate");
  const [, prefix, suffix] = match;
  if (!FRAGMENT.test(prefix) || !FRAGMENT.test(suffix)) {
    throw new Error("invalid rawNameTemplate fragment");
  }
}

export function parseQualifiedVectorManifest(input) {
  const parsed = manifestSchema.parse(input);
  const keys = parsed.capabilities.map(sortKey);
  const unique = new Set(keys);
  if (unique.size !== keys.length) throw new Error("duplicate capability");
  const sorted = [...keys].sort();
  if (keys.some((key, index) => key !== sorted[index])) {
    throw new Error("capabilities are not sorted");
  }
  for (const capability of parsed.capabilities) {
    assertTemplate(capability.rawNameTemplate);
  }
  return parsed;
}

export function resolveQualifiedVector(manifest, request) {
  const parsed = parseQualifiedVectorManifest(manifest);
  if (!REFDES.test(request.refdes)) return null;
  const capability = parsed.capabilities.find(
    item =>
      item.quantity === request.quantity &&
      item.family === request.family &&
      item.analysis === request.analysis
  );
  if (!capability) return null;
  return capability.rawNameTemplate.replace("{ref}", request.refdes.toLowerCase());
}

export function listQualifiedFamilies(manifest, quantity, analysis) {
  const parsed = parseQualifiedVectorManifest(manifest);
  return parsed.capabilities
    .filter(item => item.quantity === quantity && item.analysis === analysis)
    .map(item => item.family);
}
