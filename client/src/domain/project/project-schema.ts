import { z, type ZodIssue } from "zod";
import type { CircuitProjectV2, CornerParameterPath, Diagnostic, DomainResult } from "./project-v2";
import { REFDES_FAMILY_PREFIX } from "./project-v2";

const MAX_COMPONENTS = 2000;
const MAX_WIRES = 5000;
const MAX_STRUCTURE_BYTES = 5 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 15 * 1024 * 1024;
const MAX_MODEL_SOURCE_BYTES = 10 * 1024 * 1024;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REFDES_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const TOKEN_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NET_LABEL_RE = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isReservedKey(value: string) {
  return RESERVED_KEYS.has(value.toLowerCase());
}

function issue(code: string, message: string, path: Array<string | number> = []) {
  return { code: "custom" as const, message, path, params: { diagnosticCode: code } };
}

const persistentId = z
  .string()
  .min(1)
  .max(128)
  .regex(ID_RE)
  .superRefine((value, ctx) => {
    if (isReservedKey(value)) {
      ctx.addIssue({ code: "custom", message: "reserved persistent id", params: { diagnosticCode: "SCHEMA_RESERVED_KEY" } });
    }
  });

const isoDate = z.string().regex(ISO_RE);
const finiteNumber = z.number().finite();
const positiveNumber = finiteNumber.positive();
const nonNegativeNumber = finiteNumber.nonnegative();
const pinToken = z.string().regex(TOKEN_RE);
const paramName = z
  .string()
  .regex(PARAM_NAME_RE)
  .superRefine((value, ctx) => {
    if (isReservedKey(value)) {
      ctx.addIssue({ code: "custom", message: "reserved parameter name", params: { diagnosticCode: "SCHEMA_RESERVED_KEY" } });
    }
  });
const spiceSymbol = z.string().regex(TOKEN_RE);
const netLabel = z
  .string()
  .regex(NET_LABEL_RE, { error: "invalid net label" })
  .superRefine((value, ctx) => {
    if (isReservedKey(value)) {
      ctx.addIssue({ code: "custom", message: "reserved net label", params: { diagnosticCode: "SCHEMA_RESERVED_KEY" } });
    }
  });

function refinePulseTimes(
  value: { delayS: number; riseS: number; fallS: number; widthS: number; periodS: number },
  ctx: z.RefinementCtx
) {
  if (
    value.delayS < 0 ||
    value.riseS < 0 ||
    value.fallS < 0 ||
    value.widthS < 0 ||
    value.periodS <= 0 ||
    value.widthS + value.riseS + value.fallS > value.periodS
  ) {
    ctx.addIssue({
      code: "custom",
      message: "invalid PULSE period or times",
      path: ["periodS"],
      params: { diagnosticCode: "SCHEMA_BAD_PULSE" },
    });
  }
}

const voltagePulse = z
  .object({
    kind: z.literal("pulse"),
    initialV: finiteNumber,
    pulsedV: finiteNumber,
    delayS: finiteNumber,
    riseS: finiteNumber,
    fallS: finiteNumber,
    widthS: finiteNumber,
    periodS: finiteNumber,
  })
  .strict()
  .superRefine(refinePulseTimes);

const voltageSin = z
  .object({
    kind: z.literal("sin"),
    offsetV: finiteNumber,
    amplitudeV: finiteNumber,
    frequencyHz: positiveNumber,
    delayS: nonNegativeNumber,
    dampingPerS: finiteNumber,
    phaseDeg: finiteNumber,
  })
  .strict();

const voltagePwl = z
  .object({
    kind: z.literal("pwl"),
    points: z
      .array(z.object({ timeS: finiteNumber, valueV: finiteNumber }).strict())
      .min(2)
      .superRefine((points, ctx) => {
        for (let index = 1; index < points.length; index += 1) {
          if (points[index]!.timeS <= points[index - 1]!.timeS) {
            ctx.addIssue({
              code: "custom",
              message: "PWL times must increase",
              path: [index, "timeS"],
              params: { diagnosticCode: "SCHEMA_BAD_PWL" },
            });
          }
        }
      }),
  })
  .strict();

const voltageTransient = z.discriminatedUnion("kind", [voltagePulse, voltageSin, voltagePwl]);

const currentPulse = z
  .object({
    kind: z.literal("pulse"),
    initialA: finiteNumber,
    pulsedA: finiteNumber,
    delayS: finiteNumber,
    riseS: finiteNumber,
    fallS: finiteNumber,
    widthS: finiteNumber,
    periodS: finiteNumber,
  })
  .strict()
  .superRefine(refinePulseTimes);

const currentSin = z
  .object({
    kind: z.literal("sin"),
    offsetA: finiteNumber,
    amplitudeA: finiteNumber,
    frequencyHz: positiveNumber,
    delayS: nonNegativeNumber,
    dampingPerS: finiteNumber,
    phaseDeg: finiteNumber,
  })
  .strict();

const currentPwl = z
  .object({
    kind: z.literal("pwl"),
    points: z
      .array(z.object({ timeS: finiteNumber, valueA: finiteNumber }).strict())
      .min(2)
      .superRefine((points, ctx) => {
        for (let index = 1; index < points.length; index += 1) {
          if (points[index]!.timeS <= points[index - 1]!.timeS) {
            ctx.addIssue({
              code: "custom",
              message: "PWL times must increase",
              path: [index, "timeS"],
              params: { diagnosticCode: "SCHEMA_BAD_PWL" },
            });
          }
        }
      }),
  })
  .strict();

const currentTransient = z.discriminatedUnion("kind", [currentPulse, currentSin, currentPwl]);

function refineSourcePresence(
  value: { dcV?: number; dcA?: number; ac?: unknown; transient?: unknown },
  ctx: z.RefinementCtx
) {
  const hasDc = value.dcV !== undefined || value.dcA !== undefined;
  if (!hasDc && value.ac === undefined && value.transient === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "source needs DC, AC or transient",
      params: { diagnosticCode: "SCHEMA_SOURCE_EMPTY" },
    });
  }
}

const voltageSourceParams = z
  .object({
    dcV: finiteNumber.optional(),
    ac: z.object({ magnitudeV: nonNegativeNumber, phaseDeg: finiteNumber }).strict().optional(),
    transient: voltageTransient.optional(),
  })
  .strict()
  .superRefine(refineSourcePresence);

const currentSourceParams = z
  .object({
    dcA: finiteNumber.optional(),
    ac: z.object({ magnitudeA: nonNegativeNumber, phaseDeg: finiteNumber }).strict().optional(),
    transient: currentTransient.optional(),
  })
  .strict()
  .superRefine(refineSourcePresence);

const refdesEmitted = z.string().superRefine((value, ctx) => {
  if (!REFDES_RE.test(value)) {
    ctx.addIssue({
      code: "custom",
      message: "invalid refdes",
      params: { diagnosticCode: "SCHEMA_BAD_REFDES" },
    });
  }
});

function withFamily(kind: keyof typeof REFDES_FAMILY_PREFIX, refdes: z.ZodType<string>) {
  return refdes.superRefine((value, ctx) => {
    if (!REFDES_RE.test(value)) return;
    if (value[0]!.toUpperCase() !== REFDES_FAMILY_PREFIX[kind]) {
      ctx.addIssue({
        code: "custom",
        message: "refdes family prefix mismatch",
        params: { diagnosticCode: "SCHEMA_BAD_REFDES_FAMILY" },
      });
    }
  });
}

const endpoint = z.object({ componentId: persistentId, pin: pinToken }).strict();

const resistor = z
  .object({
    id: persistentId,
    refdes: withFamily("resistor", refdesEmitted),
    kind: z.literal("resistor"),
    params: z.object({ resistanceOhm: positiveNumber }).strict(),
  })
  .strict();

const capacitor = z
  .object({
    id: persistentId,
    refdes: withFamily("capacitor", refdesEmitted),
    kind: z.literal("capacitor"),
    params: z.object({ capacitanceF: positiveNumber }).strict(),
  })
  .strict();

const inductor = z
  .object({
    id: persistentId,
    refdes: withFamily("inductor", refdesEmitted),
    kind: z.literal("inductor"),
    params: z.object({ inductanceH: positiveNumber }).strict(),
  })
  .strict();

const voltageSource = z
  .object({
    id: persistentId,
    refdes: withFamily("voltageSource", refdesEmitted),
    kind: z.literal("voltageSource"),
    params: voltageSourceParams,
  })
  .strict();

const currentSource = z
  .object({
    id: persistentId,
    refdes: withFamily("currentSource", refdesEmitted),
    kind: z.literal("currentSource"),
    params: currentSourceParams,
  })
  .strict();

const switchComponent = z
  .object({
    id: persistentId,
    refdes: withFamily("switch", refdesEmitted),
    kind: z.literal("switch"),
    params: z.object({}).strict(),
    modelRef: persistentId,
  })
  .strict();

const diode = z
  .object({
    id: persistentId,
    refdes: withFamily("diode", refdesEmitted),
    kind: z.literal("diode"),
    params: z.object({ area: positiveNumber }).strict(),
    modelRef: persistentId,
  })
  .strict();

const bjt = z
  .object({
    id: persistentId,
    refdes: withFamily("bjt", refdesEmitted),
    kind: z.literal("bjt"),
    params: z.object({ area: positiveNumber }).strict(),
    modelRef: persistentId,
  })
  .strict();

const mosfet = z
  .object({
    id: persistentId,
    refdes: withFamily("mosfet", refdesEmitted),
    kind: z.literal("mosfet"),
    params: z.object({ lengthM: positiveNumber, widthM: positiveNumber, multiplicity: positiveNumber }).strict(),
    modelRef: persistentId,
  })
  .strict();

const subcircuit = z
  .object({
    id: persistentId,
    refdes: withFamily("subcircuit", refdesEmitted),
    kind: z.literal("subcircuit"),
    params: z
      .object({
        parameterOverrides: z.record(paramName, finiteNumber),
      })
      .strict(),
    modelRef: persistentId,
    subcircuitName: spiceSymbol,
    orderedPins: z.array(pinToken),
  })
  .strict();

const ground = z
  .object({
    id: persistentId,
    refdes: z.literal("GND"),
    kind: z.literal("ground"),
    params: z.object({}).strict(),
  })
  .strict();

const component = z.discriminatedUnion("kind", [
  resistor,
  capacitor,
  inductor,
  voltageSource,
  currentSource,
  switchComponent,
  diode,
  bjt,
  mosfet,
  subcircuit,
  ground,
]);

const wire = z
  .object({
    id: persistentId,
    from: endpoint,
    to: endpoint,
    netLabel: netLabel.optional(),
  })
  .strict();

const schematic = z
  .object({
    components: z.array(component).max(MAX_COMPONENTS),
    wires: z.array(wire).max(MAX_WIRES),
  })
  .strict();

const componentLayout = z
  .object({
    x: finiteNumber,
    y: finiteNumber,
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    mirrored: z.boolean().optional(),
  })
  .strict();

const layout = z
  .object({
    components: z.record(persistentId, componentLayout),
    wireRoutes: z.record(persistentId, z.array(z.object({ x: finiteNumber, y: finiteNumber }).strict())),
    viewport: z.object({ x: finiteNumber, y: finiteNumber, zoom: positiveNumber }).strict().optional(),
  })
  .strict();

const modelBase = {
  id: persistentId,
  displayName: z.string().min(1).max(200),
  source: z.string().max(MAX_MODEL_SOURCE_BYTES),
  sha256: z.string().regex(SHA256_RE),
  origin: z.enum(["bundled", "user-import"]),
  licenseNote: z.string().max(2000).optional(),
};

const spiceModel = z
  .object({
    ...modelBase,
    kind: z.literal("spice-model"),
    modelName: spiceSymbol,
    deviceFamily: z.enum(["switch", "diode", "npn", "pnp", "nmos", "pmos"]),
  })
  .strict();

const subcircuitInterface = z
  .object({
    name: spiceSymbol,
    orderedPins: z.array(pinToken).min(1),
    parameterNames: z.array(paramName),
    parameterDefaults: z.record(paramName, finiteNumber),
  })
  .strict();

const spiceSubckt = z
  .object({
    ...modelBase,
    kind: z.literal("spice-subckt"),
    interfaces: z.array(subcircuitInterface),
  })
  .strict();

const model = z.discriminatedUnion("kind", [spiceModel, spiceSubckt]);

const analysisBase = {
  id: persistentId,
  name: z.string().min(1).max(200),
  enabledProbes: z.array(persistentId),
};

const dcOp = z.object({ ...analysisBase, kind: z.literal("dc-op") }).strict();

const sourceSweep = z.discriminatedUnion("quantity", [
  z
    .object({
      sourceComponentId: persistentId,
      quantity: z.literal("voltage"),
      startV: finiteNumber,
      stopV: finiteNumber,
      stepV: finiteNumber,
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.stepV === 0 || Math.sign(value.stepV) !== Math.sign(value.stopV - value.startV)) {
        ctx.addIssue({
          code: "custom",
          message: "sweep step cannot reach stop",
          params: { diagnosticCode: "SCHEMA_BAD_SWEEP" },
        });
      }
    }),
  z
    .object({
      sourceComponentId: persistentId,
      quantity: z.literal("current"),
      startA: finiteNumber,
      stopA: finiteNumber,
      stepA: finiteNumber,
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.stepA === 0 || Math.sign(value.stepA) !== Math.sign(value.stopA - value.startA)) {
        ctx.addIssue({
          code: "custom",
          message: "sweep step cannot reach stop",
          params: { diagnosticCode: "SCHEMA_BAD_SWEEP" },
        });
      }
    }),
]);

const dcSweep = z.object({ ...analysisBase, kind: z.literal("dc-sweep"), sweep: sourceSweep }).strict();

const transient = z
  .object({
    ...analysisBase,
    kind: z.literal("transient"),
    stepS: positiveNumber,
    stopS: positiveNumber,
    startS: nonNegativeNumber.optional(),
    maxStepS: positiveNumber.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = value.startS ?? 0;
    if (!(start < value.stopS)) {
      ctx.addIssue({
        code: "custom",
        message: "transient start must be below stop",
        params: { diagnosticCode: "SCHEMA_BAD_TRANSIENT" },
      });
    }
  });

const acLin = z
  .object({
    ...analysisBase,
    kind: z.literal("ac"),
    startHz: positiveNumber,
    stopHz: positiveNumber,
    scale: z.literal("lin"),
    totalPoints: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!(value.startHz < value.stopHz)) {
      ctx.addIssue({
        code: "custom",
        message: "AC start must be below stop",
        params: { diagnosticCode: "SCHEMA_BAD_AC" },
      });
    }
  });

const acLog = z
  .object({
    ...analysisBase,
    kind: z.literal("ac"),
    startHz: positiveNumber,
    stopHz: positiveNumber,
    scale: z.enum(["dec", "oct"]),
    pointsPerInterval: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!(value.startHz < value.stopHz)) {
      ctx.addIssue({
        code: "custom",
        message: "AC start must be below stop",
        params: { diagnosticCode: "SCHEMA_BAD_AC" },
      });
    }
  });

const analysis = z.union([dcOp, dcSweep, transient, acLin, acLog]);

const probe = z.discriminatedUnion("kind", [
  z.object({ id: persistentId, kind: z.literal("node-voltage"), node: endpoint, label: z.string().min(1).max(80) }).strict(),
  z
    .object({
      id: persistentId,
      kind: z.literal("differential-voltage"),
      positive: endpoint,
      negative: endpoint,
      label: z.string().min(1).max(80),
    })
    .strict(),
  z.object({ id: persistentId, kind: z.literal("branch-current"), componentId: persistentId, label: z.string().min(1).max(80) }).strict(),
  z.object({ id: persistentId, kind: z.literal("device-power"), componentId: persistentId, label: z.string().min(1).max(80) }).strict(),
]);

const measurementUnit = z.enum(["s", "Hz", "V", "A", "index", "dB", "deg", "W", "dimensionless"]);
const quantityValue = z.object({ value: finiteNumber, unit: measurementUnit }).strict();

const expression = z.discriminatedUnion("function", [
  z.object({ function: z.literal("valueAt"), vectorId: persistentId, at: quantityValue }).strict(),
  z.object({ function: z.enum(["min", "max", "mean"]), vectorId: persistentId }).strict(),
  z
    .object({
      function: z.literal("crossingTime"),
      vectorId: persistentId,
      threshold: quantityValue,
      edge: z.enum(["rising", "falling"]),
    })
    .strict(),
  z.object({ function: z.literal("bandwidth3dB"), vectorId: persistentId }).strict(),
]);

const comparator = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["lt", "lte", "gt", "gte"]), expected: quantityValue }).strict(),
  z
    .object({
      kind: z.literal("between"),
      minimum: quantityValue,
      maximum: quantityValue,
      inclusive: z.literal(true),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.minimum.value > value.maximum.value) {
        ctx.addIssue({
          code: "custom",
          message: "between minimum exceeds maximum",
          params: { diagnosticCode: "SCHEMA_BAD_ASSERTION" },
        });
      }
    }),
  z
    .object({
      kind: z.literal("near"),
      expected: quantityValue,
      absoluteTolerance: quantityValue.optional(),
      relativeTolerance: z.number().finite().min(0).max(1).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      const abs = value.absoluteTolerance?.value;
      const rel = value.relativeTolerance;
      if ((abs === undefined || abs <= 0) && (rel === undefined || rel <= 0)) {
        ctx.addIssue({
          code: "custom",
          message: "near requires a positive tolerance",
          params: { diagnosticCode: "SCHEMA_BAD_ASSERTION" },
        });
      }
    }),
]);

const assertion = z
  .object({
    id: persistentId,
    name: z.string().min(1).max(200),
    enabled: z.boolean(),
    analysisId: persistentId,
    expression,
    comparator,
  })
  .strict();

const cornerPath: z.ZodType<CornerParameterPath> = z.union([
  z.enum(["resistanceOhm", "capacitanceF", "inductanceH", "dcV", "dcA", "area", "lengthM", "widthM", "multiplicity"]),
  z.custom<`parameterOverrides.${string}`>(
    value => typeof value === "string" && /^parameterOverrides\.[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)
  ),
]);

const cornerOverride = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("component-parameter"),
      componentId: persistentId,
      path: cornerPath,
      value: finiteNumber,
    })
    .strict(),
  z.object({ kind: z.literal("component-model"), componentId: persistentId, modelRef: persistentId }).strict(),
]);

const corner = z
  .object({
    id: persistentId,
    name: z.string().min(1).max(200),
    enabled: z.boolean(),
    overrides: z.array(cornerOverride),
  })
  .strict();

const note = z
  .object({
    id: persistentId,
    createdAt: isoDate,
    updatedAt: isoDate,
    body: z.string().max(20_000),
  })
  .strict();

export const circuitProjectV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: persistentId,
    title: z.string().min(1).max(200),
    createdAt: isoDate,
    updatedAt: isoDate,
    revision: z.number().int().positive(),
    electricalRevision: z.number().int().positive(),
    schematic,
    layout,
    models: z.array(model),
    analyses: z.array(analysis),
    probes: z.array(probe),
    assertions: z.array(assertion),
    corners: z.array(corner),
    notes: z.array(note),
  })
  .strict()
  .superRefine((project, ctx) => {
    const componentIds = new Set<string>();
    const refdes = new Map<string, string>();
    for (const [index, component] of project.schematic.components.entries()) {
      if (componentIds.has(component.id)) {
        ctx.addIssue(issue("SCHEMA_DUPLICATE_ID", "duplicate component id", ["schematic", "components", index, "id"]));
      }
      componentIds.add(component.id);
      const key = component.refdes.toUpperCase();
      if (refdes.has(key)) {
        ctx.addIssue(issue("SCHEMA_DUPLICATE_REFDES", "duplicate refdes", ["schematic", "components", index, "refdes"]));
      }
      refdes.set(key, component.id);
    }
    const wireIds = new Set<string>();
    for (const [index, item] of project.schematic.wires.entries()) {
      if (wireIds.has(item.id)) {
        ctx.addIssue(issue("SCHEMA_DUPLICATE_ID", "duplicate wire id", ["schematic", "wires", index, "id"]));
      }
      wireIds.add(item.id);
    }
    const uniqueLists: Array<[string[], string]> = [
      [project.models.map(item => item.id), "models"],
      [project.analyses.map(item => item.id), "analyses"],
      [project.probes.map(item => item.id), "probes"],
      [project.assertions.map(item => item.id), "assertions"],
      [project.corners.map(item => item.id), "corners"],
      [project.notes.map(item => item.id), "notes"],
    ];
    for (const [ids, field] of uniqueLists) {
      const seen = new Set<string>();
      for (const [index, id] of ids.entries()) {
        if (seen.has(id)) ctx.addIssue(issue("SCHEMA_DUPLICATE_ID", `duplicate ${field} id`, [field, index, "id"]));
        seen.add(id);
      }
    }
    const bundleBytes = new TextEncoder().encode(JSON.stringify(project)).byteLength;
    if (bundleBytes > MAX_BUNDLE_BYTES) {
      ctx.addIssue(issue("SCHEMA_BUNDLE_TOO_LARGE", "project exceeds 15 MiB"));
    }
    const withoutSources = {
      ...project,
      models: project.models.map(model => ({ ...model, source: "" })),
    };
    const structureBytes = new TextEncoder().encode(JSON.stringify(withoutSources)).byteLength;
    if (structureBytes > MAX_STRUCTURE_BYTES) {
      ctx.addIssue(issue("SCHEMA_STRUCTURE_TOO_LARGE", "project structure exceeds 5 MiB"));
    }
  });

function locationFromPath(path: ReadonlyArray<PropertyKey>) {
  const location: NonNullable<Diagnostic["location"]> = {};
  const field = path.map(String).join(".");
  if (field) location.field = field;
  return Object.keys(location).length ? location : undefined;
}

export function zodIssuesToDiagnostics(issues: ZodIssue[]): Diagnostic[] {
  return issues.map(item => {
    const params = "params" in item && item.params && typeof item.params === "object" ? (item.params as { diagnosticCode?: string }) : {};
    let code = params.diagnosticCode;
    if (!code) {
      if (item.code === "unrecognized_keys") code = "SCHEMA_UNKNOWN_FIELD";
      else if (item.message.toLowerCase().includes("net label")) code = "SCHEMA_BAD_NET_LABEL";
      else if (item.code === "too_small" || item.code === "too_big" || item.code === "invalid_type") {
        const expectedFinite =
          typeof item.message === "string" &&
          (item.message.includes("finite") || item.message.includes("NaN") || item.message.includes("number"));
        code = expectedFinite ? "SCHEMA_NON_FINITE" : "SCHEMA_INVALID";
      } else {
        code = "SCHEMA_INVALID";
      }
    }
    return {
      severity: "error",
      code,
      message: item.message,
      location: locationFromPath(item.path),
      blocksRun: true,
    };
  });
}

export function parseCircuitProjectV2(input: unknown): DomainResult<CircuitProjectV2> {
  const parsed = circuitProjectV2Schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data, diagnostics: [] };
  return { ok: false, diagnostics: zodIssuesToDiagnostics(parsed.error.issues) };
}
