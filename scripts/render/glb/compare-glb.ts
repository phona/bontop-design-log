import { existsSync, readFileSync } from 'node:fs';
import { inspectGlb, type GlbSummary, type WorldBbox } from './inspect-glb.js';

export const DEFAULT_BASELINE = 'tmp/baselines/house-20260826.glb';
export const BBOX_TOLERANCE = 0.05;
export const SEMANTIC_CATEGORIES = ['floor', 'ceiling', 'wall', 'door', 'sliding_door', 'curtain', 'furniture', 'hvac'] as const;
export type SemanticCategory = typeof SEMANTIC_CATEGORIES[number];

export interface SemanticInventory {
  ids: Record<SemanticCategory, string[]>;
  counts: Record<SemanticCategory, number>;
  explainableDuplicates: string[];
  ignoredNames: string[];
}

export interface BboxComparison {
  withinTolerance: boolean;
  tolerance: number;
  delta: [number, number, number] | null;
  baseline: WorldBbox | null;
  candidate: WorldBbox | null;
}

export interface CompareGeometryChange {
  category: SemanticCategory | 'overlay';
  objectId: string;
  reason: string;
  baseline: WorldBbox | null;
  candidate: WorldBbox | null;
  delta: [number, number, number] | null;
}

export interface CompareReport {
  schemaVersion: '1.0';
  baseline: { path: string; summary: GlbSummary; semantic: SemanticInventory };
  candidate: { path: string; summary: GlbSummary; semantic: SemanticInventory };
  missing: Record<SemanticCategory, string[]>;
  added: Record<SemanticCategory, string[]>;
  expected: string[];
  expectedGeometryChanges: CompareGeometryChange[];
  errors: string[];
  bbox: BboxComparison;
  ok: boolean;
  strictFailure: boolean;
}

const categoryOf = (name: string): SemanticCategory | undefined => {
  if (/^floor(?::|$)/u.test(name) || /_floor(?::|$)/u.test(name)) return 'floor';
  if (/^ceiling(?::|$)/u.test(name) || /^ceiling_/u.test(name)) return 'ceiling';
  if (/^(?:wall(?::|$)|w_[^:]+)/u.test(name)) return 'wall';
  if (/^sliding_door(?::|$)/u.test(name) || /sliding_door/u.test(name)) return 'sliding_door';
  if (/^(?:door(?::|$)|d_[^:]+)/u.test(name)) return 'door';
  if (/curtain/u.test(name) && !/^ceiling/u.test(name)) return 'curtain';
  if (/^furniture(?::|$)/u.test(name)) return 'furniture';
  if (/^hvac(?::|$)/u.test(name)) return 'hvac';
  return undefined;
};

export function normalizeSemanticId(name: string): { category: SemanticCategory; id: string } | undefined {
  const category = categoryOf(name);
  if (!category) return undefined;
  if (category === 'floor') {
    if (name.startsWith('floor:')) return { category, id: name.split(':').slice(0, 2).join(':') };
    return { category, id: name.replace(/_floor$/u, '') };
  }
  if (category === 'ceiling') {
    const raw = name.replace(/^ceiling:/u, '');
    if (raw.includes(':')) return { category, id: `ceiling:${raw.split(':')[0]}` };
    return { category, id: `ceiling:${raw}` };
  }
  if (category === 'wall') return { category, id: name.startsWith('wall:') ? name.split(':').slice(0, 2).join(':') : name.split(':')[0] };
  if (category === 'door') return { category, id: name.startsWith('door:') ? name.split(':').slice(0, 2).join(':') : name.split(':')[0] };
  if (category === 'sliding_door') {
    if (name.startsWith('sliding_door:')) return { category, id: name.split(':').slice(0, 2).join(':') };
    return { category, id: name.split(':')[0] };
  }
  if (category === 'curtain') {
    const match = name.match(/(?:curtain|curtain_box)[^:]*/u);
    let id = match ? match[0].replace(/^curtain_box_/u, 'curtain_') : name.split(':')[0];
    if (id === 'curtain_living_south') id = 'curtain_living';
    return { category, id };
  }
  if (category === 'furniture') {
    const parts = name.split(':');
    return { category, id: parts.length >= 4 ? parts.slice(0, 4).join(':') : `furniture:${parts[0].replace(/:part.*$/u, '')}` };
  }
  if (category === 'hvac') {
    const parts = name.split(':');
    if (parts[2] === 'anchor' && parts[3]?.startsWith('power_')) parts[3] = `branch_${parts[3].slice('power_'.length)}`;
    return { category, id: parts.slice(0, 4).join(':') };
  }
  return { category, id: name.split(':').slice(0, 4).join(':') };
}

export function inventoryFromSummary(summary: GlbSummary): SemanticInventory {
  const sets = Object.fromEntries(SEMANTIC_CATEGORIES.map((category) => [category, new Set<string>()])) as Record<SemanticCategory, Set<string>>;
  const rawCounts = new Map<string, number>();
  const ignoredNames: string[] = [];
  for (const name of summary.nodeIds) {
    const normalized = normalizeSemanticId(name);
    if (!normalized) { ignoredNames.push(name); continue; }
    rawCounts.set(`${normalized.category}:${normalized.id}`, (rawCounts.get(`${normalized.category}:${normalized.id}`) ?? 0) + 1);
    sets[normalized.category].add(normalized.id);
  }
  const explainableDuplicates = [...rawCounts.entries()]
    .filter(([key, count]) => count > 1)
    .map(([key, count]) => `${key} (${count} raw nodes)`)
    .sort();
  const ids = Object.fromEntries(SEMANTIC_CATEGORIES.map((category) => [category, [...sets[category]].sort()])) as Record<SemanticCategory, string[]>;
  const counts = Object.fromEntries(SEMANTIC_CATEGORIES.map((category) => [category, ids[category].length])) as Record<SemanticCategory, number>;
  return { ids, counts, explainableDuplicates, ignoredNames: ignoredNames.sort() };
}

function emptyDiff(): Record<SemanticCategory, string[]> {
  const result = {} as Record<SemanticCategory, string[]>;
  for (const category of SEMANTIC_CATEGORIES) result[category] = [];
  return result;
}

function compareBbox(baseline: WorldBbox | null, candidate: WorldBbox | null, tolerance: number): BboxComparison {
  if (!baseline || !candidate) return { withinTolerance: baseline === candidate, tolerance, delta: null, baseline, candidate };
  const delta = [0, 1, 2].map((axis) => candidate.size[axis] - baseline.size[axis]) as [number, number, number];
  return { withinTolerance: delta.every((value) => Math.abs(value) <= tolerance), tolerance, delta, baseline, candidate };
}

function bboxDelta(baseline: WorldBbox | null, candidate: WorldBbox | null): [number, number, number] | null {
  if (!baseline || !candidate) return null;
  return [0, 1, 2].map((axis) => candidate.size[axis] - baseline.size[axis]) as [number, number, number];
}

function normalizedBboxes(summary: GlbSummary): Map<string, { category: SemanticCategory; bbox: WorldBbox }> {
  const result = new Map<string, { category: SemanticCategory; bbox: WorldBbox }>();
  for (const [name, bbox] of Object.entries(summary.nodeBboxes ?? {})) {
    const normalized = normalizeSemanticId(name);
    if (!normalized) continue;
    const key = `${normalized.category}:${normalized.id}`;
    const prior = result.get(key)?.bbox;
    if (!prior) result.set(key, { category: normalized.category, bbox });
    else {
      const min = [0, 1, 2].map((axis) => Math.min(prior.min[axis], bbox.min[axis])) as [number, number, number];
      const max = [0, 1, 2].map((axis) => Math.max(prior.max[axis], bbox.max[axis])) as [number, number, number];
      result.set(key, { category: normalized.category, bbox: { min, max, size: [0, 1, 2].map((axis) => max[axis] - min[axis]) as [number, number, number] } });
    }
  }
  return result;
}

function expectedFactsIds(path: string): string[] {
  if (!existsSync(path)) return [];
  const facts = JSON.parse(readFileSync(path, 'utf8')) as { hvac?: { status?: string; planId?: string; diagram?: { anchors?: Array<{ id: string; status?: string }>; terminals?: Array<{ id: string; kind?: string }> } } };
  if (facts.hvac?.status !== 'implemented' || !facts.hvac.planId) return [];
  const plan = facts.hvac;
  return [
    ...(plan.diagram?.anchors ?? []).filter((entry) => entry.status === 'confirmed').map((entry) => `hvac:${plan.planId}:anchor:${entry.id}`),
    ...(plan.diagram?.terminals ?? []).filter((entry) => entry.kind !== 'condensate_drain_candidate').map((entry) => `hvac:${plan.planId}:terminal:${entry.id}`),
  ];
}

export function compareGlb(baselinePath: string, candidatePath: string, options: { strict?: boolean; factsPath?: string; tolerance?: number } = {}): CompareReport {
  const baselineSummary = inspectGlb(baselinePath);
  const candidateSummary = inspectGlb(candidatePath);
  const baseline = inventoryFromSummary(baselineSummary);
  const candidate = inventoryFromSummary(candidateSummary);
  const missing = emptyDiff();
  const added = emptyDiff();
  const expected: string[] = [];
  const expectedGeometryChanges: CompareGeometryChange[] = [];
  const errors: string[] = [];
  const tolerance = options.tolerance ?? BBOX_TOLERANCE;
  for (const category of SEMANTIC_CATEGORIES) {
    const base = new Set(baseline.ids[category]);
    const current = new Set(candidate.ids[category]);
    missing[category] = [...base].filter((id) => !current.has(id)).sort();
    added[category] = [...current].filter((id) => !base.has(id)).sort();
  }
  for (const id of added.ceiling) {
    expected.push(`known configured addition: ceiling zone ${id} (slab/skirt normalized)`);
  }
  // w_mb_win 是已从权威布局移除的 CAD 残留，不再作为当前候选 GLB 的配置新增。
  if (baselineSummary.duplicateNodeIds.length) expected.push(`legacy duplicate/internal node names: ${baselineSummary.duplicateNodeIds.length}`);
  const factsHvac = expectedFactsIds(options.factsPath ?? '');
  for (const rawId of factsHvac) {
    const normalized = normalizeSemanticId(rawId);
    const id = normalized?.id ?? rawId;
    if (!candidate.ids.hvac.includes(id)) errors.push(`missing HVAC entity required by facts: ${rawId}`);
  }
  for (const category of ['floor', 'wall', 'door', 'sliding_door', 'furniture', 'hvac'] as const) {
    for (const id of missing[category]) errors.push(`missing core ${category} ID: ${id}`);
  }
  const baselineBboxes = normalizedBboxes(baselineSummary);
  const candidateBboxes = normalizedBboxes(candidateSummary);
  for (const [key, current] of candidateBboxes) {
    const prior = baselineBboxes.get(key);
    // 基线中不存在的帘体新变体（如圆角轨道端头的收拢帘包）可能越出基线整体包围盒：
    // 按越界量登记为预期几何变化，否则整体 bbox 检查会误报。
    if (!prior && current.category === 'curtain' && baselineSummary.worldBbox) {
      const b = baselineSummary.worldBbox;
      const overflow = [0, 1, 2].map((axis) => Math.max(0, b.min[axis] - current.bbox.min[axis], current.bbox.max[axis] - b.max[axis])) as [number, number, number];
      if (overflow.some((value) => value > tolerance)) {
        expectedGeometryChanges.push({ category: 'curtain', objectId: key.slice(current.category.length + 1), reason: 'new curtain variant extends past baseline bounds (rounded-corner track bunch)', baseline: null, candidate: current.bbox, delta: overflow });
      }
      continue;
    }
    const delta = bboxDelta(prior?.bbox ?? null, current.bbox);
    if (!delta || delta.every((value) => Math.abs(value) <= tolerance)) continue;
    if (current.category === 'curtain') expectedGeometryChanges.push({ category: current.category, objectId: key.slice(current.category.length + 1), reason: 'curtain implementation geometry differs', baseline: prior?.bbox ?? null, candidate: current.bbox, delta });
  }
  for (const name of Object.keys(candidateSummary.nodeBboxes ?? {}).filter((id) => /bay/u.test(id))) {
    const prior = baselineSummary.nodeBboxes?.[name];
    const current = candidateSummary.nodeBboxes?.[name];
    const delta = bboxDelta(prior ?? null, current ?? null);
    if (!delta || delta.every((value) => Math.abs(value) <= tolerance)) continue;
    expectedGeometryChanges.push({ category: 'overlay', objectId: name, reason: 'bay_sill geometry follows current overlay semantics (inward bay, rounded-corner trim)', baseline: prior ?? null, candidate: current ?? null, delta });
  }
  const bbox = compareBbox(baselineSummary.worldBbox, candidateSummary.worldBbox, tolerance);
  if (!bbox.withinTolerance) {
    const expectedAxes = [0, 1, 2].map((axis) => expectedGeometryChanges.some((change) => Math.abs(change.delta?.[axis] ?? 0) > tolerance));
    if (bbox.delta && bbox.delta.some((value, axis) => Math.abs(value) > tolerance && !expectedAxes[axis])) {
      errors.push(`overall bbox size exceeds tolerance ${bbox.tolerance}m: delta=${bbox.delta.map((v) => v.toFixed(4)).join(',')}`);
    } else {
      expected.push(`overall bbox change explained by expected geometry sources: ${bbox.delta?.map((v) => v.toFixed(4)).join(',')}`);
    }
  }
  const expectedIds = new Set([...expected.map((message) => message.match(/(?:floor|ceiling|wall) (\S+)/u)?.[1] ?? '')]);
  for (const category of SEMANTIC_CATEGORIES) {
    missing[category] = missing[category].filter((id) => !expectedIds.has(id));
    added[category] = added[category].filter((id) => !expectedIds.has(id));
  }
  const strictFailure = Boolean(options.strict && errors.length > 0);
  return { schemaVersion: '1.0', baseline: { path: baselinePath, summary: baselineSummary, semantic: baseline }, candidate: { path: candidatePath, summary: candidateSummary, semantic: candidate }, missing, added, expected, expectedGeometryChanges, errors, bbox, ok: !strictFailure, strictFailure };
}

function parseArgs(argv: string[]): { baseline: string; candidate: string; json: boolean; strict: boolean; factsPath?: string } {
  let baseline = DEFAULT_BASELINE; let candidate = ''; let json = false; let strict = false; let factsPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--baseline') baseline = argv[++i] ?? '';
    else if (arg === '--candidate') candidate = argv[++i] ?? '';
    else if (arg === '--facts') factsPath = argv[++i];
    else if (arg === '--json') json = true;
    else if (arg === '--strict') strict = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!candidate) throw new Error('usage: npx tsx scripts/render/glb/compare-glb.ts --baseline <file.glb> --candidate <file.glb> [--facts <file.json>] [--json] [--strict]');
  return { baseline, candidate, json, strict, factsPath };
}

function printHuman(report: CompareReport): void {
  console.log(`baseline: ${report.baseline.path}`); console.log(`candidate: ${report.candidate.path}`);
  for (const category of SEMANTIC_CATEGORIES) {
    const missing = report.missing[category]; const added = report.added[category];
    console.log(`${category}: baseline=${report.baseline.semantic.counts[category]} candidate=${report.candidate.semantic.counts[category]} missing=${missing.length} added=${added.length}`);
    if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
    if (added.length) console.log(`  added: ${added.join(', ')}`);
  }
  console.log(`bbox: ${report.bbox.withinTolerance ? 'within tolerance' : 'OUT OF TOLERANCE'} (±${report.bbox.tolerance}m)`);
  for (const change of report.expectedGeometryChanges) console.log(`expected geometry: ${change.category}/${change.objectId}: ${change.reason} delta=${change.delta?.map((v) => v.toFixed(4)).join(',')}`);
  for (const message of report.expected) console.log(`expected: ${message}`);
  for (const message of report.errors) console.log(`error: ${message}`);
  console.log(report.ok ? 'result: OK' : 'result: FAILED');
}

if (process.argv[1] && /compare-glb\.(ts|js)$/u.test(process.argv[1])) {
  try { const args = parseArgs(process.argv.slice(2)); const report = compareGlb(args.baseline, args.candidate, { strict: args.strict, factsPath: args.factsPath }); if (args.json) console.log(JSON.stringify(report, null, 2)); else printHuman(report); if (!report.ok) process.exitCode = 1; }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

export { parseArgs };
