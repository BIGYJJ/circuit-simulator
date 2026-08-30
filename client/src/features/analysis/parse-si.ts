const SI_RE = /^(?<num>[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?<prefix>meg|[tTgGkKmMuUnNpPfF])?$/;

export function parseSiNumber(text: string): number | null {
  const match = SI_RE.exec(text.trim());
  if (!match?.groups) return null;
  const factors: Record<string, number> = {
    T: 1e12,
    t: 1e12,
    G: 1e9,
    g: 1e9,
    meg: 1e6,
    k: 1e3,
    K: 1e3,
    m: 1e-3,
    u: 1e-6,
    U: 1e-6,
    n: 1e-9,
    N: 1e-9,
    p: 1e-12,
    P: 1e-12,
    f: 1e-15,
    F: 1e-15,
  };
  const value = Number(match.groups.num);
  if (!Number.isFinite(value)) return null;
  const prefix = match.groups.prefix ?? "";
  return value * (factors[prefix] ?? 1);
}
