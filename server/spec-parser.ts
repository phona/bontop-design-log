export interface ParsedDimensions {
  width: number;
  height: number;
  depth: number;
}

export function parseSpecDimensions(spec: string): ParsedDimensions | null {
  const cleaned = spec.replace(/\s/g, '');
  const match = cleaned.match(/(\d+(?:\.\d+)?)[×xX](\d+(?:\.\d+)?)(?:[×xX](\d+(?:\.\d+)?))?/);
  if (!match) return null;

  const toMeters = (val: number): number => (cleaned.includes('mm') ? val / 1000 : val);

  const w = toMeters(parseFloat(match[1]));
  const h = toMeters(parseFloat(match[2]));
  const d = match[3] ? toMeters(parseFloat(match[3])) : 0;

  return { width: w, height: h, depth: d };
}
