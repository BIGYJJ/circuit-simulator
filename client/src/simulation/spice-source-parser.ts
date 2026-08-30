import { sha256Hex } from "../domain/project/canonical";
import type {
  CircuitProjectV2,
  Diagnostic,
  DomainResult,
  SpiceDeviceFamily,
  SubcircuitInterface,
} from "../domain/project/project-v2";

export type SpiceSourceOrigin =
  | "user-cir"
  | "project-model"
  | "bundled-model"
  | "migration"
  | "stored-model";

export type SpiceSourceMode = "editable-circuit" | "opaque-model";

export interface ParsedSpiceStatementBase {
  text: string;
  startLine: number;
  endLine: number;
  scope: { kind: "top-level" } | { kind: "subcircuit"; name: string };
}

export type ParsedSpiceValue =
  | { kind: "finite-number"; sourceToken: string; valueSI: number }
  | { kind: "parameter-reference"; sourceToken: string; name: string };

export interface ParsedParameterAssignment {
  name: string;
  value: ParsedSpiceValue;
}

export type ParsedIndependentSource = {
  dc?: number;
  ac?: { magnitude: number; phaseDeg: number };
  transient?:
    | {
        kind: "pulse";
        initial: number;
        pulsed: number;
        delayS: number;
        riseS: number;
        fallS: number;
        widthS: number;
        periodS: number;
      }
    | {
        kind: "sin";
        offset: number;
        amplitude: number;
        frequencyHz: number;
        delayS: number;
        dampingPerS: number;
        phaseDeg: number;
      }
    | { kind: "pwl"; points: Array<{ timeS: number; value: number }> };
};

export type ParsedAnalysisDirective =
  | { kind: "op" }
  | { kind: "dc"; sourceName: string; start: number; stop: number; step: number }
  | { kind: "tran"; stepS: number; stopS: number; startS?: number; maxStepS?: number }
  | { kind: "ac"; scale: "lin" | "dec" | "oct"; points: number; startHz: number; stopHz: number };

export type ParsedSpiceElement =
  | (ParsedSpiceStatementBase & {
      kind: "element";
      device: "R" | "C" | "L";
      name: string;
      positiveNode: string;
      negativeNode: string;
      value: ParsedSpiceValue;
    })
  | (ParsedSpiceStatementBase & {
      kind: "element";
      device: "V" | "I";
      name: string;
      positiveNode: string;
      negativeNode: string;
      source: ParsedIndependentSource;
    })
  | (ParsedSpiceStatementBase & {
      kind: "element";
      device: "S";
      name: string;
      positiveNode: string;
      negativeNode: string;
      controlPositiveNode: string;
      controlNegativeNode: string;
      modelName: string;
    })
  | (ParsedSpiceStatementBase & {
      kind: "element";
      device: "D";
      name: string;
      anodeNode: string;
      cathodeNode: string;
      modelName: string;
      area?: ParsedSpiceValue;
    })
  | (ParsedSpiceStatementBase & {
      kind: "element";
      device: "Q";
      name: string;
      collectorNode: string;
      baseNode: string;
      emitterNode: string;
      substrateNode?: string;
      modelName: string;
      area?: ParsedSpiceValue;
    })
  | (ParsedSpiceStatementBase & {
      kind: "element";
      device: "M";
      name: string;
      drainNode: string;
      gateNode: string;
      sourceNode: string;
      bulkNode: string;
      modelName: string;
      length: ParsedSpiceValue;
      width: ParsedSpiceValue;
      multiplicity?: ParsedSpiceValue;
    })
  | (ParsedSpiceStatementBase & {
      kind: "element";
      device: "X";
      name: string;
      orderedNodes: string[];
      subcircuitName: string;
      orderedOverrides: ParsedParameterAssignment[];
    });

export type ParsedSpiceStatement =
  | (ParsedSpiceStatementBase & { kind: "title" | "terminator" | "comment" })
  | ParsedSpiceElement
  | (ParsedSpiceStatementBase & { kind: "analysis"; analysis: ParsedAnalysisDirective })
  | (ParsedSpiceStatementBase & {
      kind: "model";
      name: string;
      family: SpiceDeviceFamily;
      orderedParameters: ParsedParameterAssignment[];
    })
  | (ParsedSpiceStatementBase & {
      kind: "subckt-start";
      name: string;
      orderedPins: string[];
      orderedDefaults: ParsedParameterAssignment[];
    })
  | (ParsedSpiceStatementBase & { kind: "subckt-end"; name?: string })
  | (ParsedSpiceStatementBase & { kind: "parameter"; orderedAssignments: ParsedParameterAssignment[] });

export type ParsedDeclarationBlock =
  | { kind: "model"; name: string; family: SpiceDeviceFamily; startLine: number; endLine: number; normalizedSource: string }
  | {
      kind: "subcircuit";
      interface: SubcircuitInterface;
      startLine: number;
      endLine: number;
      normalizedSource: string;
      statements: ParsedSpiceStatement[];
      externalModelNames: string[];
      externalSubcircuitNames: string[];
    };

export interface ParsedSpiceSource {
  normalizedSource: string;
  statements: ParsedSpiceStatement[];
  declarationBlocks: ParsedDeclarationBlock[];
  models: Array<{ name: string; family: SpiceDeviceFamily }>;
  subcircuits: SubcircuitInterface[];
  utf8Bytes: number;
  sha256: string;
}

export interface BundledModelManifestEntry {
  modelId: string;
  sha256: string;
  kind: "spice-model" | "spice-subckt";
  deviceFamily?: SpiceDeviceFamily;
  interfaces?: SubcircuitInterface[];
  licenseNote?: string;
  sourceVersion: string;
}

const MAX_STATEMENT_BYTES = 65_536;
const REFDES_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const TOKEN_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const PARAM_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN = /\.(control|endc|shell|include|lib|options|save|print|plot|measure)\b/i;
const UNKNOWN_DOT = /^\.([A-Za-z][A-Za-z0-9_]*)/;
const ALLOWED_DOT = new Set(["model", "subckt", "ends", "op", "dc", "tran", "ac", "param", "end"]);
const SUFFIXES: Array<[string, number]> = [
  ["MEG", 1e6],
  ["MIL", 25.4e-6],
  ["T", 1e12],
  ["G", 1e9],
  ["K", 1e3],
  ["M", 1e-3],
  ["U", 1e-6],
  ["N", 1e-9],
  ["P", 1e-12],
  ["F", 1e-15],
];

function fail(code: string, message: string, line?: number, endLine?: number): DomainResult<never> {
  const diagnostic: Diagnostic = {
    severity: "error",
    code,
    message,
    blocksRun: true,
    location: line === undefined ? undefined : { line, endLine: endLine ?? line },
  };
  return { ok: false, diagnostics: [diagnostic] };
}

function collect(diagnostics: Diagnostic[], code: string, message: string, startLine: number, endLine: number) {
  diagnostics.push({
    severity: "error",
    code,
    message,
    blocksRun: true,
    location: { line: startLine, endLine },
  });
}

function hasForbiddenControls(source: string) {
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true;
  }
  return source.includes("\uFEFF");
}

export function parseSpiceNumber(token: string): ParsedSpiceValue | null {
  if (token.includes(",") || /nan|inf/i.test(token) || /0x/i.test(token)) return null;
  const braced = /^\{([A-Za-z_][A-Za-z0-9_]{0,63})\}$/.exec(token);
  if (braced) return { kind: "parameter-reference", sourceToken: token, name: braced[1]! };
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([A-Za-z]+)?$/.exec(token);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  let factor = 1;
  if (match[2]) {
    const suffix = match[2].toUpperCase();
    const found = SUFFIXES.find(([name]) => suffix === name);
    if (!found) return null;
    factor = found[1];
  }
  const valueSI = magnitude * factor;
  if (!Number.isFinite(valueSI)) return null;
  if (magnitude !== 0 && valueSI === 0) return null;
  return { kind: "finite-number", sourceToken: token, valueSI };
}

function tokenize(text: string) {
  return text.replace(/[()]/g, " ").trim().split(/\s+/).filter(Boolean);
}

function requireToken(name: string, pattern: RegExp) {
  return pattern.test(name) && name.toLowerCase() !== "__proto__" && name.toLowerCase() !== "prototype" && name.toLowerCase() !== "constructor";
}

function parseAssignments(tokens: string[]): ParsedParameterAssignment[] | null {
  const assignments: ParsedParameterAssignment[] = [];
  for (const token of tokens) {
    const match = /^([A-Za-z_][A-Za-z0-9_]{0,63})=(.+)$/.exec(token);
    if (!match || !requireToken(match[1]!, PARAM_RE)) return null;
    const value = parseSpiceNumber(match[2]!);
    if (!value) return null;
    assignments.push({ name: match[1]!, value });
  }
  return assignments;
}

function parseIndependentSource(tokens: string[]): ParsedIndependentSource | "invalid" {
  const source: ParsedIndependentSource = {};
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!.toUpperCase();
    if (token === "DC") {
      const value = parseSpiceNumber(tokens[index + 1] ?? "");
      if (!value || value.kind !== "finite-number") return "invalid";
      source.dc = value.valueSI;
      index += 2;
      continue;
    }
    if (token === "AC") {
      const mag = parseSpiceNumber(tokens[index + 1] ?? "");
      const phase = tokens[index + 2] ? parseSpiceNumber(tokens[index + 2]!) : { kind: "finite-number" as const, sourceToken: "0", valueSI: 0 };
      if (!mag || mag.kind !== "finite-number" || !phase || phase.kind !== "finite-number") return "invalid";
      source.ac = { magnitude: mag.valueSI, phaseDeg: phase.valueSI };
      index += tokens[index + 2] ? 3 : 2;
      continue;
    }
    if (token === "PULSE") {
      const args = tokens.slice(index + 1, index + 8).map(parseSpiceNumber);
      if (args.some(item => !item || item.kind !== "finite-number") || args.length < 7) return "invalid";
      const values = args.map(item => (item as { valueSI: number }).valueSI);
      source.transient = {
        kind: "pulse",
        initial: values[0]!,
        pulsed: values[1]!,
        delayS: values[2]!,
        riseS: values[3]!,
        fallS: values[4]!,
        widthS: values[5]!,
        periodS: values[6]!,
      };
      index += 8;
      continue;
    }
    if (token === "SIN") {
      const args = tokens.slice(index + 1, index + 7).map(parseSpiceNumber);
      if (args.some(item => !item || item.kind !== "finite-number") || args.length < 6) return "invalid";
      const values = args.map(item => (item as { valueSI: number }).valueSI);
      source.transient = {
        kind: "sin",
        offset: values[0]!,
        amplitude: values[1]!,
        frequencyHz: values[2]!,
        delayS: values[3]!,
        dampingPerS: values[4]!,
        phaseDeg: values[5]!,
      };
      index += 7;
      continue;
    }
    if (token === "PWL") {
      const rest = tokens.slice(index + 1);
      if (rest.length < 4 || rest.length % 2 !== 0) return "invalid";
      const points: Array<{ timeS: number; value: number }> = [];
      for (let cursor = 0; cursor < rest.length; cursor += 2) {
        const time = parseSpiceNumber(rest[cursor]!);
        const value = parseSpiceNumber(rest[cursor + 1]!);
        if (!time || !value || time.kind !== "finite-number" || value.kind !== "finite-number") return "invalid";
        points.push({ timeS: time.valueSI, value: value.valueSI });
      }
      source.transient = { kind: "pwl", points };
      index = tokens.length;
      continue;
    }
    const bare = parseSpiceNumber(tokens[index]!);
    if (bare?.kind === "finite-number" && source.dc === undefined && index === 0) {
      source.dc = bare.valueSI;
      index += 1;
      continue;
    }
    return "invalid";
  }
  return source;
}

function familyFromModelType(type: string): SpiceDeviceFamily | null {
  const upper = type.toUpperCase();
  if (upper === "D") return "diode";
  if (upper === "SW" || upper === "VSWITCH" || upper === "CSW") return "switch";
  if (upper === "NPN") return "npn";
  if (upper === "PNP") return "pnp";
  if (upper === "NMOS") return "nmos";
  if (upper === "PMOS") return "pmos";
  return null;
}

interface LogicalLine {
  text: string;
  startLine: number;
  endLine: number;
}

function joinLogicalLines(physical: string[]): DomainResult<LogicalLine[]> {
  const logical: LogicalLine[] = [];
  for (let index = 0; index < physical.length; index += 1) {
    const raw = physical[index]!;
    const bytes = new TextEncoder().encode(raw).byteLength;
    if (bytes > MAX_STATEMENT_BYTES) return fail("SPICE_LINE_TOO_LONG", "physical line exceeds 65536 bytes", index + 1);
    const trimmedStart = raw.match(/^\s*/)?.[0].length ?? 0;
    const body = raw.slice(trimmedStart);
    if (body.startsWith("+")) {
      if (logical.length === 0) return fail("SPICE_ORPHAN_CONTINUATION", "continuation has no predecessor", index + 1);
      const previous = logical[logical.length - 1]!;
      previous.text = `${previous.text} ${body.slice(1).trim()}`;
      previous.endLine = index + 1;
      if (new TextEncoder().encode(previous.text).byteLength > MAX_STATEMENT_BYTES) {
        return fail("SPICE_LINE_TOO_LONG", "logical statement exceeds 65536 bytes", previous.startLine, previous.endLine);
      }
      continue;
    }
    logical.push({ text: raw.trim(), startLine: index + 1, endLine: index + 1 });
  }
  return { ok: true, value: logical.filter(line => line.text.length > 0), diagnostics: [] };
}

function classify(
  line: LogicalLine,
  mode: SpiceSourceMode,
  scope: ParsedSpiceStatementBase["scope"],
  diagnostics: Diagnostic[]
): ParsedSpiceStatement | null {
  const text = line.text;
  const base = { text, startLine: line.startLine, endLine: line.endLine, scope };
  if (/^(?:\*|;)|^$/.test(text)) return { ...base, kind: "comment" };
  if (FORBIDDEN.test(text) || /\b(?:\bIC\b|\bOFF\b|\bUIC\b)/i.test(` ${text} `) && /^\./.test(text) === false && /\sIC=|\sOFF\b|\sUIC\b/i.test(text)) {
    if (FORBIDDEN.test(text)) {
      collect(diagnostics, "SPICE_FORBIDDEN_DIRECTIVE", "forbidden SPICE directive", line.startLine, line.endLine);
      return null;
    }
  }
  if (FORBIDDEN.test(text)) {
    collect(diagnostics, "SPICE_FORBIDDEN_DIRECTIVE", "forbidden SPICE directive", line.startLine, line.endLine);
    return null;
  }
  if (/[\\/`]|\$\(/.test(text)) {
    collect(diagnostics, "SPICE_FORBIDDEN_DIRECTIVE", "path or command substitution is not allowed", line.startLine, line.endLine);
    return null;
  }
  if (text.startsWith(".")) {
    const directive = UNKNOWN_DOT.exec(text)?.[1]?.toLowerCase();
    if (!directive || !ALLOWED_DOT.has(directive) || (directive === "param" && mode !== "opaque-model")) {
      collect(diagnostics, "SPICE_FORBIDDEN_DIRECTIVE", `directive .${directive ?? "?"} is not allowed`, line.startLine, line.endLine);
      return null;
    }
  }

  const tokens = tokenize(text);
  if (tokens.length === 0) return { ...base, kind: "comment" };

  if (tokens[0]!.toLowerCase() === ".end") return { ...base, kind: "terminator" };
  if (tokens[0]!.toLowerCase() === ".ends") return { ...base, kind: "subckt-end", name: tokens[1] };
  if (tokens[0]!.toLowerCase() === ".param") {
    const assignments = parseAssignments(tokens.slice(1));
    if (!assignments) {
      collect(diagnostics, "SPICE_BAD_PARAM", "invalid .param assignment", line.startLine, line.endLine);
      return null;
    }
    return { ...base, kind: "parameter", orderedAssignments: assignments };
  }
  if (tokens[0]!.toLowerCase() === ".model") {
    if (tokens.length < 3) {
      collect(diagnostics, "SPICE_BAD_MODEL", "incomplete .model", line.startLine, line.endLine);
      return null;
    }
    const name = tokens[1]!;
    const family = familyFromModelType(tokens[2]!);
    if (!requireToken(name, TOKEN_RE) || !family) {
      collect(diagnostics, "SPICE_BAD_MODEL", "invalid .model name or family", line.startLine, line.endLine);
      return null;
    }
    const orderedParameters = parseAssignments(tokens.slice(3)) ?? [];
    if (family === "switch") {
      const lookup = Object.fromEntries(orderedParameters.map(item => [item.name.toUpperCase(), item.value]));
      const vt = lookup.VT;
      const vh = lookup.VH;
      const ron = lookup.RON;
      const roff = lookup.ROFF;
      if (
        !vt ||
        vt.kind !== "finite-number" ||
        !vh ||
        vh.kind !== "finite-number" ||
        !ron ||
        ron.kind !== "finite-number" ||
        ron.valueSI <= 0 ||
        !roff ||
        roff.kind !== "finite-number" ||
        roff.valueSI <= 0 ||
        roff.valueSI <= ron.valueSI
      ) {
        collect(diagnostics, "SPICE_BAD_SWITCH_MODEL", "switch model needs finite VT/VH and ROFF > RON > 0", line.startLine, line.endLine);
        return null;
      }
    }
    return { ...base, kind: "model", name, family, orderedParameters };
  }
  if (tokens[0]!.toLowerCase() === ".subckt") {
    const name = tokens[1];
    if (!name || !requireToken(name, TOKEN_RE)) {
      collect(diagnostics, "SPICE_BAD_SUBCKT", "invalid .subckt name", line.startLine, line.endLine);
      return null;
    }
    const paramsIndex = tokens.findIndex(token => token.toUpperCase() === "PARAMS:");
    const pinTokens = tokens.slice(2, paramsIndex === -1 ? undefined : paramsIndex);
    const defaultTokens = paramsIndex === -1 ? [] : tokens.slice(paramsIndex + 1);
    if (!pinTokens.every(pin => requireToken(pin, TOKEN_RE))) {
      collect(diagnostics, "SPICE_BAD_TOKEN", "invalid subcircuit pin", line.startLine, line.endLine);
      return null;
    }
    const orderedDefaults = defaultTokens.length ? parseAssignments(defaultTokens) : [];
    if (!orderedDefaults) {
      collect(diagnostics, "SPICE_BAD_PARAM", "invalid subcircuit default", line.startLine, line.endLine);
      return null;
    }
    return { ...base, kind: "subckt-start", name, orderedPins: pinTokens, orderedDefaults };
  }
  if (tokens[0]!.toLowerCase() === ".op") return { ...base, kind: "analysis", analysis: { kind: "op" } };
  if (tokens[0]!.toLowerCase() === ".dc") {
    const sourceName = tokens[1];
    const start = parseSpiceNumber(tokens[2] ?? "");
    const stop = parseSpiceNumber(tokens[3] ?? "");
    const step = parseSpiceNumber(tokens[4] ?? "");
    if (!sourceName || !start || !stop || !step || start.kind !== "finite-number" || stop.kind !== "finite-number" || step.kind !== "finite-number") {
      collect(diagnostics, "SPICE_BAD_ANALYSIS", "invalid .dc", line.startLine, line.endLine);
      return null;
    }
    return { ...base, kind: "analysis", analysis: { kind: "dc", sourceName, start: start.valueSI, stop: stop.valueSI, step: step.valueSI } };
  }
  if (tokens[0]!.toLowerCase() === ".tran") {
    const step = parseSpiceNumber(tokens[1] ?? "");
    const stop = parseSpiceNumber(tokens[2] ?? "");
    const start = tokens[3] ? parseSpiceNumber(tokens[3]) : undefined;
    const max = tokens[4] ? parseSpiceNumber(tokens[4]) : undefined;
    if (!step || !stop || step.kind !== "finite-number" || stop.kind !== "finite-number") {
      collect(diagnostics, "SPICE_BAD_ANALYSIS", "invalid .tran", line.startLine, line.endLine);
      return null;
    }
    return {
      ...base,
      kind: "analysis",
      analysis: {
        kind: "tran",
        stepS: step.valueSI,
        stopS: stop.valueSI,
        startS: start?.kind === "finite-number" ? start.valueSI : undefined,
        maxStepS: max?.kind === "finite-number" ? max.valueSI : undefined,
      },
    };
  }
  if (tokens[0]!.toLowerCase() === ".ac") {
    const scale = tokens[1]?.toLowerCase();
    const points = parseSpiceNumber(tokens[2] ?? "");
    const start = parseSpiceNumber(tokens[3] ?? "");
    const stop = parseSpiceNumber(tokens[4] ?? "");
    if (!scale || !["lin", "dec", "oct"].includes(scale) || !points || !start || !stop || points.kind !== "finite-number" || start.kind !== "finite-number" || stop.kind !== "finite-number") {
      collect(diagnostics, "SPICE_BAD_ANALYSIS", "invalid .ac", line.startLine, line.endLine);
      return null;
    }
    return {
      ...base,
      kind: "analysis",
      analysis: { kind: "ac", scale: scale as "lin" | "dec" | "oct", points: points.valueSI, startHz: start.valueSI, stopHz: stop.valueSI },
    };
  }

  const device = tokens[0]![0]!.toUpperCase();
  const name = tokens[0]!;
  if (!requireToken(name, REFDES_RE)) {
    if (scope.kind === "top-level" && mode === "editable-circuit") return { ...base, kind: "title" };
    collect(diagnostics, "SPICE_BAD_REFDES", "invalid element name", line.startLine, line.endLine);
    return null;
  }

  const allowParamRef = scope.kind === "subcircuit";
  const requireValue = (token: string | undefined) => {
    if (!token) return null;
    const value = parseSpiceNumber(token);
    if (!value) return null;
    if (value.kind === "parameter-reference" && !allowParamRef) return null;
    if (value.kind === "finite-number" && ["R", "C", "L"].includes(device) && value.valueSI <= 0) return null;
    return value;
  };

  if ((device === "R" || device === "C" || device === "L") && tokens.length >= 4) {
    const value = requireValue(tokens[3]);
    if (!requireToken(tokens[1]!, TOKEN_RE) || !requireToken(tokens[2]!, TOKEN_RE) || !value) {
      collect(diagnostics, "SPICE_BAD_ELEMENT", "invalid R/C/L statement", line.startLine, line.endLine);
      return null;
    }
    return { ...base, kind: "element", device, name, positiveNode: tokens[1]!, negativeNode: tokens[2]!, value };
  }
  if ((device === "V" || device === "I") && tokens.length >= 3) {
    if (!requireToken(tokens[1]!, TOKEN_RE) || !requireToken(tokens[2]!, TOKEN_RE)) {
      collect(diagnostics, "SPICE_BAD_ELEMENT", "invalid V/I nodes", line.startLine, line.endLine);
      return null;
    }
    const parsed = parseIndependentSource(tokens.slice(3));
    if (parsed === "invalid") {
      collect(diagnostics, "SPICE_BAD_SOURCE", "invalid V/I source", line.startLine, line.endLine);
      return null;
    }
    return { ...base, kind: "element", device, name, positiveNode: tokens[1]!, negativeNode: tokens[2]!, source: parsed };
  }
  if (device === "S" && tokens.length >= 6) {
    if (![1, 2, 3, 4, 5].every(index => requireToken(tokens[index]!, TOKEN_RE))) {
      collect(diagnostics, "SPICE_BAD_ELEMENT", "invalid switch", line.startLine, line.endLine);
      return null;
    }
    return {
      ...base,
      kind: "element",
      device: "S",
      name,
      positiveNode: tokens[1]!,
      negativeNode: tokens[2]!,
      controlPositiveNode: tokens[3]!,
      controlNegativeNode: tokens[4]!,
      modelName: tokens[5]!,
    };
  }
  if (device === "D" && tokens.length >= 4) {
    const area = tokens[4] ? requireValue(tokens[4]) : undefined;
    if (!requireToken(tokens[1]!, TOKEN_RE) || !requireToken(tokens[2]!, TOKEN_RE) || !requireToken(tokens[3]!, TOKEN_RE) || (tokens[4] && !area)) {
      collect(diagnostics, "SPICE_BAD_ELEMENT", "invalid diode", line.startLine, line.endLine);
      return null;
    }
    return { ...base, kind: "element", device: "D", name, anodeNode: tokens[1]!, cathodeNode: tokens[2]!, modelName: tokens[3]!, area: area ?? undefined };
  }
  if (device === "Q" && tokens.length >= 5) {
    let substrate: string | undefined;
    let modelName = tokens[4]!;
    let areaToken: string | undefined;
    if (tokens.length >= 6 && requireToken(tokens[5]!, TOKEN_RE) && !tokens[5]!.includes("=") && parseSpiceNumber(tokens[5]!) === null) {
      substrate = tokens[4];
      modelName = tokens[5]!;
      areaToken = tokens[6];
    } else {
      areaToken = tokens[5];
    }
    const area = areaToken ? requireValue(areaToken) : undefined;
    if (![1, 2, 3].every(index => requireToken(tokens[index]!, TOKEN_RE)) || !requireToken(modelName, TOKEN_RE) || (areaToken && !area)) {
      collect(diagnostics, "SPICE_BAD_ELEMENT", "invalid BJT", line.startLine, line.endLine);
      return null;
    }
    return {
      ...base,
      kind: "element",
      device: "Q",
      name,
      collectorNode: tokens[1]!,
      baseNode: tokens[2]!,
      emitterNode: tokens[3]!,
      substrateNode: substrate,
      modelName,
      area: area ?? undefined,
    };
  }
  if (device === "M" && tokens.length >= 8) {
    if (![1, 2, 3, 4, 5].every(index => requireToken(tokens[index]!, TOKEN_RE))) {
      collect(diagnostics, "SPICE_BAD_ELEMENT", "invalid MOSFET nodes", line.startLine, line.endLine);
      return null;
    }
    const assignments = parseAssignments(tokens.slice(6));
    const lookup = Object.fromEntries((assignments ?? []).map(item => [item.name.toUpperCase(), item.value]));
    if (!lookup.L || !lookup.W) {
      collect(diagnostics, "SPICE_BAD_ELEMENT", "MOSFET requires L and W", line.startLine, line.endLine);
      return null;
    }
    return {
      ...base,
      kind: "element",
      device: "M",
      name,
      drainNode: tokens[1]!,
      gateNode: tokens[2]!,
      sourceNode: tokens[3]!,
      bulkNode: tokens[4]!,
      modelName: tokens[5]!,
      length: lookup.L,
      width: lookup.W,
      multiplicity: lookup.M,
    };
  }
  if (device === "X" && tokens.length >= 3) {
    const assignmentsStart = tokens.findIndex((token, index) => index >= 2 && token.includes("="));
    const middle = tokens.slice(1, assignmentsStart === -1 ? tokens.length : assignmentsStart);
    if (middle.length < 2) {
      collect(diagnostics, "SPICE_BAD_ELEMENT", "invalid subcircuit instance", line.startLine, line.endLine);
      return null;
    }
    const subcircuitName = middle[middle.length - 1]!;
    const orderedNodes = middle.slice(0, -1);
    const orderedOverrides = assignmentsStart === -1 ? [] : parseAssignments(tokens.slice(assignmentsStart));
    if (!requireToken(subcircuitName, TOKEN_RE) || !orderedNodes.every(node => requireToken(node, TOKEN_RE)) || !orderedOverrides) {
      collect(diagnostics, "SPICE_BAD_ELEMENT", "invalid X instance", line.startLine, line.endLine);
      return null;
    }
    return { ...base, kind: "element", device: "X", name, orderedNodes, subcircuitName, orderedOverrides };
  }

  if (scope.kind === "top-level" && mode === "editable-circuit" && !text.startsWith(".")) {
    return { ...base, kind: "title" };
  }
  collect(diagnostics, "SPICE_UNKNOWN_STATEMENT", "statement is not on the allowlist", line.startLine, line.endLine);
  return null;
}

export async function parseAndValidateSpiceSource(
  source: string,
  origin: SpiceSourceOrigin,
  mode: SpiceSourceMode
): Promise<DomainResult<ParsedSpiceSource>> {
  void origin;
  if (hasForbiddenControls(source)) return fail("SPICE_FORBIDDEN_CONTROL", "source contains a forbidden control character");
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const physical = normalized.split("\n");
  const joined = joinLogicalLines(physical);
  if (!joined.ok) return joined;
  const diagnostics: Diagnostic[] = [];
  const statements: ParsedSpiceStatement[] = [];
  let scope: ParsedSpiceStatementBase["scope"] = { kind: "top-level" };
  let sawTitle = false;
  let sawEnd = false;

  for (const line of joined.value) {
    if (sawEnd && !/^(?:\*|;)/.test(line.text)) {
      collect(diagnostics, "SPICE_MISPLACED_END", ".end must be the final non-comment line", line.startLine, line.endLine);
    }
    const statement = classify(line, mode, scope, diagnostics);
    if (!statement) continue;
    if (statement.kind === "title") {
      if (mode !== "editable-circuit" || sawTitle || statements.some(item => item.kind !== "comment")) {
        collect(diagnostics, "SPICE_BAD_TITLE", "title must be the first non-comment editable line", line.startLine, line.endLine);
        continue;
      }
      sawTitle = true;
    }
    if (statement.kind === "terminator") {
      if (mode !== "editable-circuit") {
        collect(diagnostics, "SPICE_FORBIDDEN_DIRECTIVE", ".end is not allowed in opaque-model", line.startLine, line.endLine);
        continue;
      }
      sawEnd = true;
    }
    if (statement.kind === "subckt-start") {
      if (scope.kind === "subcircuit") {
        collect(diagnostics, "SPICE_NESTED_SUBCKT", "nested subcircuits are not allowed", line.startLine, line.endLine);
        continue;
      }
      scope = { kind: "subcircuit", name: statement.name };
    }
    if (statement.kind === "subckt-end") {
      if (scope.kind !== "subcircuit") {
        collect(diagnostics, "SPICE_UNPAIRED_ENDS", "unpaired .ends", line.startLine, line.endLine);
        continue;
      }
      scope = { kind: "top-level" };
    }
    if (statement.kind === "element" && scope.kind === "top-level" && mode === "opaque-model") {
      collect(diagnostics, "SPICE_TOPLEVEL_ELEMENT", "opaque-model forbids top-level elements", line.startLine, line.endLine);
      continue;
    }
    if (statement.kind === "analysis" && mode !== "editable-circuit") {
      collect(diagnostics, "SPICE_FORBIDDEN_DIRECTIVE", "analysis directives are not allowed in opaque-model", line.startLine, line.endLine);
      continue;
    }
    statements.push(statement);
  }
  if (scope.kind === "subcircuit") {
    collect(diagnostics, "SPICE_UNPAIRED_SUBCKT", "subcircuit is missing .ends", 1, physical.length);
  }

  const modelNames = new Set<string>();
  const subcktNames = new Set<string>();
  const models: Array<{ name: string; family: SpiceDeviceFamily }> = [];
  const subcircuits: SubcircuitInterface[] = [];
  const declarationBlocks: ParsedDeclarationBlock[] = [];
  let currentSubckt: { start: ParsedSpiceStatement & { kind: "subckt-start" }; statements: ParsedSpiceStatement[] } | null = null;

  for (const statement of statements) {
    if (statement.kind === "model") {
      const key = statement.name.toUpperCase();
      if (modelNames.has(key)) collect(diagnostics, "SPICE_DUPLICATE_SYMBOL", "duplicate .model name", statement.startLine, statement.endLine);
      modelNames.add(key);
      models.push({ name: statement.name, family: statement.family });
      declarationBlocks.push({
        kind: "model",
        name: statement.name,
        family: statement.family,
        startLine: statement.startLine,
        endLine: statement.endLine,
        normalizedSource: statement.text,
      });
    }
    if (statement.kind === "subckt-start") {
      currentSubckt = { start: statement, statements: [] };
    } else if (statement.kind === "subckt-end" && currentSubckt) {
      const start = currentSubckt.start;
      const key = start.name.toUpperCase();
      if (subcktNames.has(key)) collect(diagnostics, "SPICE_DUPLICATE_SYMBOL", "duplicate .subckt name", start.startLine, statement.endLine);
      subcktNames.add(key);
      const iface: SubcircuitInterface = {
        name: start.name,
        orderedPins: start.orderedPins,
        parameterNames: start.orderedDefaults.map(item => item.name),
        parameterDefaults: Object.fromEntries(
          start.orderedDefaults.flatMap(item =>
            item.value.kind === "finite-number" ? [[item.name, item.value.valueSI]] : []
          )
        ),
      };
      subcircuits.push(iface);
      const body = currentSubckt.statements;
      declarationBlocks.push({
        kind: "subcircuit",
        interface: iface,
        startLine: start.startLine,
        endLine: statement.endLine,
        normalizedSource: [start, ...body, statement].map(item => item.text).join("\n"),
        statements: body,
        externalModelNames: [...new Set(body.flatMap(item => (item.kind === "element" && "modelName" in item ? [item.modelName] : [])))],
        externalSubcircuitNames: [...new Set(body.flatMap(item => (item.kind === "element" && item.device === "X" ? [item.subcircuitName] : [])))],
      });
      currentSubckt = null;
    } else if (currentSubckt && statement.kind !== "title" && statement.kind !== "terminator") {
      currentSubckt.statements.push(statement);
    }
  }

  if (diagnostics.length) return { ok: false, diagnostics };
  const utf8Bytes = new TextEncoder().encode(normalized).byteLength;
  return {
    ok: true,
    value: {
      normalizedSource: normalized,
      statements,
      declarationBlocks,
      models,
      subcircuits,
      utf8Bytes,
      sha256: await sha256Hex(normalized),
    },
    diagnostics: [],
  };
}

function sameInterface(left: SubcircuitInterface, right: SubcircuitInterface) {
  return (
    left.name.toUpperCase() === right.name.toUpperCase() &&
    left.orderedPins.length === right.orderedPins.length &&
    left.orderedPins.every((pin, index) => pin.toUpperCase() === right.orderedPins[index]!.toUpperCase()) &&
    left.parameterNames.length === right.parameterNames.length &&
    left.parameterNames.every((name, index) => name.toUpperCase() === right.parameterNames[index]!.toUpperCase())
  );
}

export async function validateProjectModels(
  project: CircuitProjectV2,
  origin: SpiceSourceOrigin,
  bundledManifest: BundledModelManifestEntry[]
): Promise<DomainResult<CircuitProjectV2>> {
  const diagnostics: Diagnostic[] = [];
  const models = [];
  for (const model of project.models) {
    const parsed = await parseAndValidateSpiceSource(model.source, origin, "opaque-model");
    if (!parsed.ok) {
      diagnostics.push(...parsed.diagnostics.map(item => ({ ...item, location: { ...item.location, modelId: model.id } })));
      continue;
    }
    if (parsed.value.sha256 !== model.sha256) {
      diagnostics.push({
        severity: "error",
        code: "MODEL_HASH_MISMATCH",
        message: "model hash does not match normalized source",
        blocksRun: true,
        location: { modelId: model.id },
      });
      continue;
    }
    if (model.kind === "spice-model") {
      if (parsed.value.models.length !== 1 || parsed.value.subcircuits.length !== 0) {
        diagnostics.push({
          severity: "error",
          code: "MODEL_SHAPE_MISMATCH",
          message: "spice-model must declare exactly one .model",
          blocksRun: true,
          location: { modelId: model.id },
        });
        continue;
      }
      const declared = parsed.value.models[0]!;
      if (declared.name.toUpperCase() !== model.modelName.toUpperCase() || declared.family !== model.deviceFamily) {
        diagnostics.push({
          severity: "error",
          code: "MODEL_METADATA_MISMATCH",
          message: "declared model name or family does not match source",
          blocksRun: true,
          location: { modelId: model.id },
        });
        continue;
      }
    } else if (
      parsed.value.subcircuits.length !== model.interfaces.length ||
      !model.interfaces.every((iface, index) => parsed.value.subcircuits[index] && sameInterface(iface, parsed.value.subcircuits[index]!))
    ) {
      diagnostics.push({
        severity: "error",
        code: "MODEL_INTERFACE_MISMATCH",
        message: "declared subcircuit interfaces do not match source",
        blocksRun: true,
        location: { modelId: model.id },
      });
      continue;
    }
    if (model.origin === "bundled") {
      const entry = bundledManifest.find(item => item.modelId === model.id);
      if (
        !entry ||
        entry.sha256 !== model.sha256 ||
        entry.kind !== model.kind ||
        (model.kind === "spice-model" && entry.deviceFamily !== model.deviceFamily)
      ) {
        diagnostics.push({
          severity: "error",
          code: "BUNDLED_MODEL_MISMATCH",
          message: "bundled model claim does not match the immutable manifest",
          blocksRun: true,
          location: { modelId: model.id },
        });
        continue;
      }
    }
    models.push({ ...model, source: parsed.value.normalizedSource });
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true, value: { ...project, models }, diagnostics: [] };
}
