// verify-facts.ts
// 非几何数据对账门禁入口：load 登记表 → 构造 workspace → 调引擎 → 打印 → exit。
// 与 12 道几何/机电门禁的分工见 shared/facts-lint.ts 头部注释。
// 维护铁律：本脚本只报告问题，不修数据；任何修改都必须落到 config/*.yaml / docs / schedule
// 的对应条目上，再由业主/设计侧确认后重新跑本门禁。
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { lintFacts, type FactsRegistry, type FactsWorkspace } from '../../../shared/facts-lint.js';
import { endpointSourcesFromFacts, resolveMepEndpoint } from '../../../shared/mep-hvac-coordination-schema.js';

const REGISTRY = 'config/facts.yaml';
const REPO_ROOT = process.cwd();

const load = (p: string): any => yaml.load(fs.readFileSync(p, 'utf8'));

function rel(relPath: string): string { return path.join(REPO_ROOT, relPath); }

function readText(relPath: string): string | null {
  try { return fs.readFileSync(rel(relPath), 'utf8'); } catch { return null; }
}

function loadDoc(relPath: string): unknown | null {
  const text = readText(relPath);
  if (text === null) return null;
  try { return relPath.endsWith('.json') ? JSON.parse(text) : yaml.load(text); } catch { return null; }
}

function grepText(relPath: string, re: RegExp): RegExpExecArray[] {
  const text = readText(relPath);
  if (text === null) return [];
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  global.lastIndex = 0;
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    out.push(m);
    if (m[0].length === 0) global.lastIndex += 1;
  }
  return out;
}

function walk(roots: string[], skip: RegExp): string[] {
  const out: string[] = [];
  const queue = roots.map((r) => rel(r)).filter((p) => fs.existsSync(p));
  const seen = new Set<string>();
  while (queue.length) {
    const abs = queue.shift()!;
    if (seen.has(abs)) continue;
    seen.add(abs);
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.isDirectory()) {
      if (skip.test(path.basename(abs))) continue;
      for (const entry of fs.readdirSync(abs)) queue.push(path.join(abs, entry));
      continue;
    }
    out.push(path.relative(REPO_ROOT, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

// ── datasets：入口预计算的派生数据 ──────────────────────────────────────────
const geometry = loadDoc('config/layout/model-geometry.yaml') as any;
const overlay = loadDoc('config/layout/overlay.yaml') as any;

const vertices = new Map<string, { x: number; z: number }>(
  ((geometry?.vertices ?? []) as any[]).map((v) => [v.id, { x: v.x, z: v.z }]),
);
const polyOf = (boundary: unknown): Array<{ x: number; z: number }> =>
  (Array.isArray(boundary) ? boundary : [])
    .map((id) => (typeof id === 'string' ? vertices.get(id) : undefined))
    .filter((p): p is { x: number; z: number } => Boolean(p));

const layoutRooms: Array<{ id: string; polygon: Array<{ x: number; z: number }> }> = [];
for (const room of (geometry?.rooms ?? []) as any[]) layoutRooms.push({ id: room.id, polygon: polyOf(room.boundary) });
if (geometry?.platform) layoutRooms.push({ id: geometry.platform.id, polygon: polyOf(geometry.platform.boundary) });

const layoutFloorRegions = ((overlay?.elements ?? []) as any[])
  .filter((e) => e?.type === 'floor_region')
  .map((e) => ({
    id: e.id,
    // follow：有意声明「跟随某房间地材」的子区域，与房间重叠是设计而非缺陷（引擎按约定忽略）
    follow: typeof e.follow === 'string' ? e.follow : null,
    points: (e.points ?? []).map((p: any) => ({ x: p.x, z: p.z })),
  }));

// ── mep 契约用的端点坐标 / 房间净高（c.mep_layer_below_drop_bottom 的输入）────────
// 端点解析直接复用 shared/mep-hvac-coordination-schema.ts 的
// endpointSourcesFromFacts + resolveMepEndpoint——与 scripts/verify/mep/verify-mep-lint.ts
// 走**同一套**解析逻辑，保证 facts 契约与 verify:mep 的吊顶净空告警对同一批点位给出同一结论。
// 房间净高复刻 SceneBuilder.addCeilingZones：`rooms.find(r => r.id === zone.room)?.height ?? 2.8`，
// 与 CeilingZoneBuilder 的 topY = ceilingHeight − thickness + SLAB_EPS 同口径。
const mepDocs = ['config/electrical.yaml', 'config/plumbing.yaml', 'config/ceiling.yaml', 'config/hvac.yaml']
  .map((p) => ({ p, doc: loadDoc(p) as any }));

const mepEndpoints: Record<string, { x: number; z: number; y?: number }> = {};
const mepSources = mepDocs.length ? endpointSourcesFromFacts({
  electrical: mepDocs[0].doc,
  plumbing: mepDocs[1].doc,
  ceiling: mepDocs[2].doc,
  hvac: mepDocs[3].doc,
}) : undefined;
if (mepSources) {
  const mepConfig = loadDoc('config/mep-hvac-coordination.yaml') as { routes?: unknown[] } | null;
  const wanted = new Set<string>();
  for (const route of (mepConfig?.routes ?? []) as Array<Record<string, unknown>>) {
    if (!route || typeof route !== 'object') continue;
    for (const side of [route.from, route.to]) if (typeof side === 'string') wanted.add(side);
    for (const via of (Array.isArray(route.via) ? route.via : [])) {
      if (via && typeof via === 'object' && typeof (via as { id?: unknown }).id === 'string') wanted.add((via as { id: string }).id);
    }
  }
  for (const id of [...wanted].sort()) {
    const at = resolveMepEndpoint(id, mepSources);
    if (at) mepEndpoints[id] = at;
  }
}
const mepRoomHeights: Record<string, number> = {};
for (const room of (geometry?.rooms ?? []) as any[]) {
  if (room?.id && typeof room.height === 'number') mepRoomHeights[room.id] = room.height;
}
if (geometry?.platform?.id && typeof geometry.platform.height === 'number') {
  mepRoomHeights[geometry.platform.id] = geometry.platform.height;
}

const coverageFiles = [
  ...fs.readdirSync(rel('config')).filter((f) => f.endsWith('.yaml')).map((f) => `config/${f}`),
  ...fs.readdirSync(rel('config/layout')).filter((f) => f.endsWith('.yaml')).map((f) => `config/layout/${f}`),
  ...fs.readdirSync(rel('config/render')).filter((f) => f.endsWith('.yaml')).map((f) => `config/render/${f}`),
  ...fs.readdirSync(rel('data')).filter((f) => f.endsWith('.json')).map((f) => `data/${f}`),
].sort();

const registryDoc = loadDoc(REGISTRY) as FactsRegistry | null;
if (registryDoc === null) {
  console.error(`FAIL facts registry 不可解析：${REGISTRY}`);
  process.exit(1);
}

const workspace: FactsWorkspace = {
  read: readText,
  load: loadDoc,
  grep: grepText,
  datasets: {
    // T1 scan 与 T3 fk/mutex 的文件全集（引擎再按 include/exclude/scope 过滤）。
    // 注意：登记表自身（config/facts.yaml）引用事实而不承载事实，必须从扫描域里排除，
    // 否则它写的每一个 `ref: 'DEC-045'` / 反引号 id 都会被当成真引用，既虚增计数又污染定位。
    'scan.files': walk(['config', 'docs', 'schedule'], /^(node_modules|\.git)$/).filter((f) => f !== REGISTRY),
    'contract.files': [...walk(['config', 'shared', 'docs', 'schedule', 'server', 'tests', 'data'], /^(node_modules|\.git)$/), 'README.md'].filter((f) => f !== REGISTRY),
    'coverage.files': coverageFiles,
    'layout.rooms': layoutRooms,
    'layout.floor_regions': layoutFloorRegions,
    // MEP 契约（c.mep_layer_below_drop_bottom）的端点坐标与房间净高。
    'mep.endpoints': mepEndpoints,
    'mep.room_heights': mepRoomHeights,
  },
};

const result = lintFacts(registryDoc, workspace);
const byCode = (issues: typeof result.errors) => {
  const map = new Map<string, number>();
  for (const i of issues) map.set(i.code, (map.get(i.code) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

console.log('facts 对账（T1 发现 / T2 事实 / T3 契约 / T4 覆盖）：');
console.log(`  登记表 ${REGISTRY}：facts ${(registryDoc.facts ?? []).length} 条、contracts ${(registryDoc.contracts ?? []).length} 条、coverage ${(registryDoc.coverage ?? []).length} 条、scalars ${(registryDoc.scan?.scalars ?? []).length} 个`);
for (const issue of result.errors) console.log(`FAIL [${issue.code}] ${issue.location ?? '-'} ${issue.message}`);
for (const issue of result.warnings) console.log(`WARN [${issue.code}] ${issue.location ?? '-'} ${issue.message}`);
console.log(`  错误码分布：${byCode(result.errors).map(([c, n]) => `${c}=${n}`).join(', ') || '无'}`);
console.log(`  警告码分布：${byCode(result.warnings).map(([c, n]) => `${c}=${n}`).join(', ') || '无'}`);
for (const line of result.notes ?? []) console.log(`  INFO ${line}`);

console.log(result.errors.length
  ? `verify-facts: ${result.errors.length} fail(s), ${result.warnings.length} warning(s)`
  : `verify-facts: OK (${result.warnings.length} warning(s))`);
process.exit(result.errors.length ? 1 : 0);
