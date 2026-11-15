/**
 * Issue #98 MEP batch 4 真实配置回归：冷媒家族关系化（6 条 refrigerant 路由）。
 *
 * 真实 YAML + 内存改动；期望值从当前配置推导（解算端点、from_height/to_height），
 * 不写死历史绝对坐标；唯一例外是轴线/标高层值：corridor_axis=4.6、
 * axis_trunk_x745=7.45、axis_living_south_z555=5.55、axis_be_west_x1340=13.4、
 * level_kitchen_b_270=2.7 作为独立期望钉在 C1（钉声明非历史——轴线/标高层
 * 合法改值须随声明同步更新本常量；量房后同理）。实验后不写盘。
 * 覆盖：C0 新步型语义与 fail-closed（schema + 求解器 + validate 三层）、
 * C1 迁移前后逐点等价、C2 单声明传动、C3 算量等价、C4 反例 fail-closed
 * （路由级断引用、算量、DXF）。
 * lint / 3D / verify 由全套件 + verify:all 覆盖（见 PR 描述）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  endpointSourcesFromFacts,
  isMepViaCoordinate,
  MepCoordinationSchema,
  MepViaCoordinateSchema,
  MepViaStepSchema,
  parseMepCoordination,
  resolveMepRoutes,
  resolveMepViaSteps,
  validateMepCoordination,
  type MepCoordination,
  type MepRoute,
} from '../../shared/mep-hvac-coordination-schema.js';
import { computeMepTakeoff, type MepTakeoffRules, type TakeoffCircuit } from '../../shared/mep-takeoff.js';
import { buildProjectDxf } from '../../shared/dxf/project-dxf.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveFurniturePlacements } from '../../shared/furniture-placement.js';
import { resolvePointPlacementInWalls, pointMountHostIndex } from '../../shared/point-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';

const TOL = 0.005;
const ROUTES = [
  'refrigerant-trunk',
  'refrigerant-master',
  'refrigerant-parent',
  'refrigerant-study',
  'refrigerant-child',
  'refrigerant-dining',
] as const;
/**
 * 轴线/标高层独立期望（2026-11-15 issue #98 MEP batch 4 声明值）：
 * 钉的是声明（设计决策），不是历史坐标——合法改轴/改层须随声明同步更新本常量；
 * 除此之外，其余期望仍从当前配置推导。
 * corridor_axis：z=4.6 走廊轴（batch 2 声明），强电/弱电/冷媒共用；本批自带的
 * corridor_axis 与之重复、集成 #243 时删除、引用改指 corridor_axis。
 */
const CORRIDOR_AXIS_Z = 4.6;
const AXIS_TRUNK_X745 = 7.45;
const AXIS_LIVING_SOUTH_Z555 = 5.55;
const AXIS_BE_WEST_X1340 = 13.4;
const LEVEL_KITCHEN_B_270 = 2.7;

function loadAll() {
  const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: FurnishingsYaml };
  const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as any[];
  const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as any[];
  const ceiling = parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as any[];
  const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as any;
  const topology = parseYaml(readFileSync('config/electrical-topology.yaml', 'utf8')) as {
    circuits: TakeoffCircuit[];
    controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
  };
  const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules;
  const coordination = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
  const layout = resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);
  const pointWalls = pointWallIndexFromElements(layout.walls);
  return { furnishings: house.furnishings ?? {}, electrical, plumbing, ceiling, hvac, topology, rules, coordination, layout, pointWalls };
}

/** 全链路解算：家具 → 点位 → MEP 路由 → 算量（同一份输入，同一份解算结果）。 */
function resolveChain(all: ReturnType<typeof loadAll>, furnishings: FurnishingsYaml) {
  const wallSegments = new Map<string, any[]>();
  for (const wall of all.layout.walls as any[]) {
    const list = wallSegments.get(wall.id ?? '') ?? [];
    list.push(wall);
    wallSegments.set(wall.id ?? '', list);
  }
  const items = Object.values(furnishings).flat();
  const { placements, diagnostics } = resolveFurniturePlacements(items, wallSegments as any);
  const { mountHosts } = buildPlacementIndexes({ geometry: { walls: all.layout.walls }, furnishings });
  const sources = endpointSourcesFromFacts(
    { electrical: all.electrical, plumbing: all.plumbing, ceiling: all.ceiling, hvac: all.hvac } as any,
    all.pointWalls,
    mountHosts,
  );
  const points = new Map<string, { x: number; z: number }>();
  const pointDiagnostics: string[] = [];
  for (const pt of all.electrical as any[]) {
    const r = resolvePointPlacementInWalls(pt, all.pointWalls, mountHosts);
    if (r.placement) points.set(pt.id, { x: r.placement.x, z: r.placement.z });
    else pointDiagnostics.push(`${pt.id}: ${r.diagnostic}`);
  }
  const report = resolveMepRoutes(all.coordination, sources);
  const takeoff = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: all.coordination.routes,
    resolution: report,
    rules: all.rules,
  });
  return { placements, diagnostics, points, pointDiagnostics, sources, report, takeoff };
}

/** 仅 MEP 解算（C2 传动实验：改 axes/levels/ceiling 端点后重解，不动家具链）。 */
function resolveMepOnly(
  all: ReturnType<typeof loadAll>,
  coordination: MepCoordination,
  ceilingOverride?: unknown,
) {
  const { mountHosts } = buildPlacementIndexes({ geometry: { walls: all.layout.walls }, furnishings: all.furnishings });
  const sources = endpointSourcesFromFacts(
    { electrical: all.electrical, plumbing: all.plumbing, ceiling: (ceilingOverride ?? all.ceiling) as any, hvac: all.hvac } as any,
    all.pointWalls,
    mountHosts,
  );
  return { sources, report: resolveMepRoutes(coordination, sources) };
}

function planLength(points: ReadonlyArray<{ x: number; z: number }>): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
}
function length3d(points: ReadonlyArray<{ x: number; y?: number; z: number }>): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, (p.y ?? 0) - (points[i].y ?? 0), p.z - points[i].z), 0);
}
/** 连续重复点去重（旧绝对 via 末点与 to 端点重复，容差内算同一点）。 */
function dedup(points: ReadonlyArray<{ x: number; y?: number; z: number }>): Array<{ x: number; y?: number; z: number }> {
  const out: Array<{ x: number; y?: number; z: number }> = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(p.x - last.x) <= TOL && Math.abs(p.z - last.z) <= TOL && Math.abs((p.y ?? 0) - (last.y ?? 0)) <= TOL) continue;
    out.push({ ...p });
  }
  return out;
}
function assertPointClose(a: { x: number; y?: number; z: number }, b: { x: number; y?: number; z: number }, what: string): void {
  assert.ok(Math.abs(a.x - b.x) <= TOL && Math.abs(a.z - b.z) <= TOL && Math.abs((a.y ?? 0) - (b.y ?? 0)) <= TOL,
    `${what} 偏差超 ${TOL}m：(${a.x},${a.z},${a.y}) vs (${b.x},${b.z},${b.y})`);
}
function assertOrthogonal(points: ReadonlyArray<{ x: number; z: number }>, what: string): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    assert.ok(Math.abs(a.x - b.x) <= TOL || Math.abs(a.z - b.z) <= TOL, `${what} 第 ${i} 段不是正交段`);
  }
}
/** 收集两棵 plain 对象的叶路径差异（证明只改了一处声明）。 */
function leafDiffPaths(a: unknown, b: unknown, prefix = ''): string[] {
  if (a === b) return [];
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return [prefix || '(root)'];
  const out: string[] = [];
  for (const key of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
    out.push(...leafDiffPaths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
  }
  return out;
}
function routeOf(report: ReturnType<typeof resolveMepRoutes>, id: string) {
  const r = report.routes.find((item) => item.route.id === id);
  assert.ok(r, `缺失路由 ${id}`);
  return r!;
}

// ───────── C0：新步型语义与 fail-closed（schema + 求解器 + validate 三层） ─────────

test('C0：axis_jog / axis_run / vertical_to 合成语义——落点、高度来源、游标推进', () => {
  const axes = [
    { id: 'ax', axis: 'x', value: 5, reason: 'test' },
    { id: 'az', axis: 'z', value: 4, reason: 'test' },
  ] as any;
  const levels = [{ id: 'lv', y: 2.7, reason: 'test' }] as any;
  const shell = { id: 'test-route', from_height: 2.6, to_height: 2.75, slope: 0.01, via: [] } as unknown as MepRoute;
  const from = { x: 1, z: 2, y: 2.6 };
  const to = { x: 9, z: 7, y: 2.75 };

  // axis_jog：横移至 x=5 轴线，高度取标高游标（首步为 from_height）。
  let out = resolveMepViaSteps({ ...shell, via: [{ kind: 'axis_jog', axis: 'ax' }] } as unknown as MepRoute, from, to, [], axes, levels);
  assert.deepEqual(out, { points: [{ x: 5, z: 2, y: 2.6 }] });
  // axis_run 方向型：沿 z 跑到 4（改 z 保 x）；再沿 x 跑到 to.x（字面 'to' 跟随 to 端点）。
  out = resolveMepViaSteps({ ...shell, via: [
    { kind: 'axis_jog', axis: 'ax' },
    { kind: 'axis_run', axis: 'z', to: 4 },
    { kind: 'axis_run', axis: 'x', to: 'to' },
  ] } as unknown as MepRoute, from, to, [], axes, levels);
  assert.deepEqual(out, { points: [{ x: 5, z: 2, y: 2.6 }, { x: 5, z: 4, y: 2.6 }, { x: 9, z: 4, y: 2.6 }] });
  // axis_run 具名型：游标已在 z=4 轴线上，沿该轴东行至 x=9。
  out = resolveMepViaSteps({ ...shell, via: [
    { kind: 'axis_jog', axis: 'ax' },
    { kind: 'axis_run', axis: 'z', to: 4 },
    { kind: 'axis_run', axis: 'az', to: 9 },
  ] } as unknown as MepRoute, from, to, [], axes, levels);
  assert.deepEqual(out, { points: [{ x: 5, z: 2, y: 2.6 }, { x: 5, z: 4, y: 2.6 }, { x: 9, z: 4, y: 2.6 }] });
  // vertical_to：height 'to' 取 to_height；height 'from' 取 from_height；level 取标高层。
  out = resolveMepViaSteps({ ...shell, via: [{ kind: 'vertical_to', height: 'to' }] } as unknown as MepRoute, from, to, [], axes, levels);
  assert.deepEqual(out, { points: [{ x: 1, z: 2, y: 2.75 }] });
  out = resolveMepViaSteps({ ...shell, via: [
    { kind: 'vertical_to', height: 'to' },
    { kind: 'vertical_to', height: 'from' },
  ] } as unknown as MepRoute, from, to, [], axes, levels);
  assert.deepEqual(out, { points: [{ x: 1, z: 2, y: 2.75 }, { x: 1, z: 2, y: 2.6 }] });
  out = resolveMepViaSteps({ ...shell, via: [{ kind: 'vertical_to', level: 'lv' }] } as unknown as MepRoute, from, to, [], axes, levels);
  assert.deepEqual(out, { points: [{ x: 1, z: 2, y: 2.7 }] });
  // vertical_to 不由游标派生高度：from 无 y 且 from_height 缺失时，level 步仍可落点。
  const noHeightShell = { id: 'test-route', via: [] } as unknown as MepRoute;
  out = resolveMepViaSteps({ ...noHeightShell, via: [{ kind: 'vertical_to', level: 'lv' }] } as unknown as MepRoute, { x: 1, z: 2 }, to, [], axes, levels);
  assert.deepEqual(out, { points: [{ x: 1, z: 2, y: 2.7 }] });
});

test('C0：新步型反例——求解器入口 fail-closed（缺失/越权/断引用一律 points [] + 显式诊断）', () => {
  const axes = [
    { id: 'ax', axis: 'x', value: 5, reason: 'test' },
    { id: 'az', axis: 'z', value: 4, reason: 'test' },
  ] as any;
  const levels = [{ id: 'lv', y: 2.7, reason: 'test' }] as any;
  const shell = { id: 'test-route', from_height: 2.6, to_height: 2.75, slope: 0.01, via: [] } as unknown as MepRoute;
  const from = { x: 1, z: 2, y: 2.6 };
  const to = { x: 9, z: 7, y: 2.75 };
  const cases: Array<{ via: unknown; match: RegExp; what: string }> = [
    { via: [{ kind: 'axis_jog', axis: 'missing' }], match: /引用未知轴线 "missing"/, what: 'axis_jog 未知轴线' },
    { via: [{ kind: 'axis_jog', axis: 'ax' }], match: /零行程/, what: 'axis_jog 已在轴线上（零行程）' },
    { via: [{ kind: 'axis_run', axis: 'az', to: 9 }], match: /不在轴线 "az" 上/, what: '具名 axis_run 游标不在轴线上' },
    { via: [{ kind: 'axis_run', axis: 'x', to: 1 }], match: /零行程/, what: 'axis_run 零行程' },
    { via: [{ kind: 'vertical_to', height: 'to', level: 'lv' }], match: /不得同时声明 height 与 level/, what: 'vertical_to height 与 level 并存' },
    { via: [{ kind: 'vertical_to' }], match: /缺少有效目标标高/, what: 'vertical_to height 与 level 俱缺' },
    { via: [{ kind: 'vertical_to', level: 'missing' }], match: /引用未知标高层 "missing"/, what: 'vertical_to 未知标高层' },
    { via: [{ kind: 'vertical_to', height: 'from' }], match: /零行程/, what: 'vertical_to 目标与当前同高（零行程）' },
    { via: [{ kind: 'axis_jog', axis: 'ax', y: 2.6 }], match: /不得声明 y/, what: 'axis_jog 步内 y 越权' },
    { via: [{ kind: 'axis_run', axis: 'x', to: 9, y: 2.6 }], match: /不得声明 y/, what: 'axis_run 步内 y 越权' },
    { via: [{ kind: 'vertical_to', height: 'to', y: 2.75 }], match: /不得声明 y/, what: 'vertical_to 步内 y 越权' },
    { via: [{ kind: 'axis_jog', axis: 'x' }], match: /缺少有效 axis/, what: 'axis_jog axis 为方向 x/z' },
    { via: [{ kind: 'slope_run', axis: 'ax', to: 9 }], match: /须为方向/, what: 'slope_run axis 引用轴线 id' },
    { via: [{ x: 5, z: 2, level: 'missing' }], match: /引用未知标高层 "missing"/, what: '绝对弯点未知标高层' },
    { via: [{ x: 5, z: 2, y: 2.6, level: 'lv' }], match: /不得同时声明 y 与 level/, what: '绝对弯点 y 与 level 并存' },
  ];
  for (const c of cases) {
    // 零行程用例（axis_jog 已在轴线、axis_run 零行程、vertical_to 同高）须从已在目标的游标出发。
    const start = c.what.includes('已在轴线上') ? { x: 5, z: 2, y: 2.6 } : from;
    const out = resolveMepViaSteps({ ...shell, via: c.via } as unknown as MepRoute, start, to, [], axes, levels);
    assert.deepEqual(out.points, [], `${c.what} 不得出局部几何`);
    assert.ok(out.diagnostic !== undefined && c.match.test(out.diagnostic), `${c.what} 诊断须显式（实际：${out.diagnostic})`);
  }
  // 健康对照：绝对弯点取 level 时高度即 level.y，标高游标同步推进、后续关系步跟随。
  const levelOk = resolveMepViaSteps({ ...shell, via: [{ x: 5, z: 2, level: 'lv' }, { kind: 'axis_run', axis: 'x', to: 9 }] } as unknown as MepRoute, from, to, [], axes, levels);
  assert.deepEqual(levelOk.diagnostic, undefined, '绝对弯点取 level 须解出');
  assert.equal(levelOk.points[0]!.y, 2.7, '绝对弯点高度须为 level.y');
  assert.equal(levelOk.points[1]!.y, 2.7, '后续关系步须跟随 level 高度');
  // 缺起算标高：from 无 y 且 from_height 缺失时，axis_jog / axis_run 不得沿用旧标高。
  const noHeightShell = { id: 'test-route', via: [] } as unknown as MepRoute;
  for (const via of [[{ kind: 'axis_jog', axis: 'ax' }], [{ kind: 'axis_run', axis: 'x', to: 9 }]]) {
    const out = resolveMepViaSteps({ ...noHeightShell, via } as unknown as MepRoute, { x: 1, z: 2 }, to, [], axes, levels);
    assert.deepEqual(out.points, [], '缺起算标高不得出局部几何');
    assert.match(out.diagnostic!, /缺少有效起算标高/, '缺起算标高诊断须显式');
  }
  // vertical_to height 指向缺失的路由高度字段时同样 fail-closed。
  const out = resolveMepViaSteps({ ...noHeightShell, via: [{ kind: 'vertical_to', height: 'from' }] } as unknown as MepRoute, { x: 1, z: 2 }, to, [], axes, levels);
  assert.deepEqual(out.points, [], 'vertical_to 目标标高缺失不得出局部几何');
  assert.match(out.diagnostic!, /缺少有效目标标高/, 'vertical_to 目标标高缺失诊断须显式');
});

test('C0：新步型反例——schema 层拒绝越权/缺失声明（parse 即失败，不进求解器）', () => {
  const bad: Array<{ step: unknown; match: RegExp; what: string }> = [
    { step: { kind: 'axis_jog', axis: 'ax', y: 2.6 }, match: /axis_jog 不得声明 y/, what: 'axis_jog 步内 y' },
    { step: { kind: 'axis_run', axis: 'x' }, match: /axis_run 必须声明 to/, what: 'axis_run 缺 to' },
    { step: { kind: 'axis_run', axis: 'x', to: 9, y: 2.6 }, match: /axis_run 不得声明 y/, what: 'axis_run 步内 y' },
    { step: { kind: 'axis_jog', axis: 'x' }, match: /axis_jog 的 axis 须为轴线 id/, what: 'axis_jog axis 为方向' },
    { step: { kind: 'axis_jog' }, match: /axis_jog 必须声明 axis/, what: 'axis_jog 缺 axis' },
    { step: { kind: 'vertical_to', height: 'to', level: 'lv' }, match: /height（from\/to）或 level/, what: 'vertical_to height 与 level 并存' },
    { step: { kind: 'vertical_to' }, match: /height（from\/to）或 level/, what: 'vertical_to height 与 level 俱缺' },
    { step: { kind: 'vertical_to', height: 'to', y: 2.75 }, match: /vertical_to 不得声明 y/, what: 'vertical_to 步内 y' },
    { step: { kind: 'slope_run', axis: 'ax', to: 9 }, match: /slope_run 的 axis 须为方向/, what: 'slope_run axis 引用轴线 id' },
    { step: { kind: 'slope_run', axis: 'x', to: 9, height: 'to' }, match: /不得声明 height\/level/, what: 'slope_run 声明 height' },
  ];
  for (const b of bad) {
    assert.throws(() => MepViaStepSchema.parse(b.step), b.match, `${b.what} 须在 schema 层拒绝`);
  }
  // 健康对照：三类新步型须通过 schema。
  assert.doesNotThrow(() => MepViaStepSchema.parse({ kind: 'axis_jog', axis: 'ax' }));
  assert.doesNotThrow(() => MepViaStepSchema.parse({ kind: 'axis_run', axis: 'z', to: 'to' }));
  assert.doesNotThrow(() => MepViaStepSchema.parse({ kind: 'vertical_to', height: 'to' }));
  assert.doesNotThrow(() => MepViaStepSchema.parse({ kind: 'vertical_to', level: 'lv' }));
  // 绝对弯点 level 口径（2026-11-15 修 Codex major）：平面仍字面，高度只取 y 或 level 其一。
  assert.throws(() => MepViaCoordinateSchema.parse({ x: 7.05, z: 0.55, y: 2.7, level: 'lv' }), /不得同时声明 y 与 level/, '绝对弯点 y 与 level 并存须在 schema 层拒绝');
  assert.doesNotThrow(() => MepViaCoordinateSchema.parse({ x: 7.05, z: 0.55, level: 'lv' }));
  assert.doesNotThrow(() => MepViaCoordinateSchema.parse({ x: 7.05, z: 0.55, y: 2.7 }));
});

test('C0：validate 层——轴线/标高层断引用与重复 id 一律拒绝', () => {
  const all = loadAll();
  const base = resolveChain(all, all.furnishings);
  assert.deepEqual(base.report.diagnostics, [], '基线须无诊断');
  assert.doesNotThrow(() => validateMepCoordination(all.coordination, base.sources), '迁移后 coordination 须通过 validate');

  const unknownAxis = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  unknownAxis.routes.find((r) => r.id === 'refrigerant-master')!.via = [{ kind: 'axis_jog', axis: 'axis_missing' }] as any;
  assert.throws(() => validateMepCoordination(unknownAxis, base.sources), /引用未知轴线 "axis_missing"/, 'axis_jog 断引用须在 validate 层拒绝');
  const unknownLevel = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  unknownLevel.routes.find((r) => r.id === 'refrigerant-trunk')!.via = [{ kind: 'vertical_to', level: 'level_missing' }] as any;
  assert.throws(() => validateMepCoordination(unknownLevel, base.sources), /引用未知标高层 "level_missing"/, 'vertical_to 断引用须在 validate 层拒绝');
  const unknownLevelJog = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  unknownLevelJog.routes.find((r) => r.id === 'refrigerant-trunk')!.via[1] = { x: 7.05, z: 0.55, level: 'level_missing' } as any;
  assert.throws(() => validateMepCoordination(unknownLevelJog, base.sources), /引用未知标高层 "level_missing"/, '绝对弯点断引用须在 validate 层拒绝');
  const dupAxis = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  dupAxis.axes.push({ id: 'corridor_axis', axis: 'z', value: 4.6, reason: 'dup' });
  assert.throws(() => validateMepCoordination(dupAxis, base.sources), /Duplicate MEP axis id/, '重复轴线 id 须拒绝');
  const dupLevel = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  dupLevel.levels.push({ id: 'level_kitchen_b_270', y: 2.7, reason: 'dup' });
  assert.throws(() => validateMepCoordination(dupLevel, base.sources), /Duplicate MEP level id/, '重复标高层 id 须拒绝');
  // 全量 schema 解析亦须接受新表（reason 为可选字段：统一协议 #243 保留 #236 口径，
  // 弱电轴即无 reason 声明；缺 reason 不得拒绝）。
  assert.doesNotThrow(() => MepCoordinationSchema.parse({ ...JSON.parse(JSON.stringify(all.coordination)), axes: [{ id: 'a', axis: 'z', value: 4.6 }] }),
    '无 reason 的轴线声明须在 schema 层接受（统一协议：reason 可选）');
});

// ───────── C1：六路由关系化——逐点等价 ─────────

test('C1：六条冷媒路由关系化——轴线/标高层只声明一次，解算折线与旧绝对几何逐点等价', () => {
  const all = loadAll();
  const { report, takeoff } = resolveChain(all, all.furnishings);
  assert.deepEqual(report.diagnostics, [], '全量路由解算须无诊断');
  assert.doesNotThrow(() => validateMepCoordination(all.coordination, resolveChain(all, all.furnishings).sources), '迁移后 coordination 须通过 schema 校验');

  // 轴线/标高层只声明一次，六路由共同引用；竖井表仍只有一口 shaft_entry（本批不增竖井）。
  assert.equal(all.coordination.shafts.length, 1, 'shafts 表须仍只有一口竖井声明');
  assert.deepEqual(all.coordination.axes.map((a) => a.id), ['corridor_axis', 'weak_axis_438', 'weak_axis_455', 'axis_trunk_x745', 'axis_living_south_z555', 'axis_be_west_x1340'], 'axes 表须恰为六条轴线（强电 corridor_axis + 弱电两条 + 冷媒三条）');
  assert.deepEqual(all.coordination.levels.map((l) => l.id), ['level_kitchen_b_270'], 'levels 表须恰为本批一个标高层');
  // 声明值独立断言：轴线/标高层值须等于本批声明常量。C1 的逐点等价若全从当前声明推导，
  // 轴值误改会双侧同移而测不出（#231 Codex major 同款）——本断言是独立的第二道防线。
  const axisById = new Map(all.coordination.axes.map((a) => [a.id, a]));
  assert.equal(axisById.get('corridor_axis')!.axis, 'z');
  assert.equal(axisById.get('corridor_axis')!.value, CORRIDOR_AXIS_Z, '走廊轴须为声明值 4.6');
  assert.equal(axisById.get('axis_trunk_x745')!.axis, 'x');
  assert.equal(axisById.get('axis_trunk_x745')!.value, AXIS_TRUNK_X745, '冷媒主管轴须为声明值 7.45');
  assert.equal(axisById.get('axis_living_south_z555')!.axis, 'z');
  assert.equal(axisById.get('axis_living_south_z555')!.value, AXIS_LIVING_SOUTH_Z555, '客厅边吊南缘轴须为声明值 5.55');
  assert.equal(axisById.get('axis_be_west_x1340')!.axis, 'x');
  assert.equal(axisById.get('axis_be_west_x1340')!.value, AXIS_BE_WEST_X1340, 'w_be_west 墙线轴须为声明值 13.4');
  assert.equal(all.coordination.levels[0]!.y, LEVEL_KITCHEN_B_270, '厨房标高层须为声明值 2.7');
  for (const axis of all.coordination.axes.filter((a) => a.id === 'corridor_axis' || a.id.startsWith('axis_'))) assert.ok((axis.reason ?? '').length > 0, `${axis.id} 须写清归属与来源`);
  assert.ok((all.coordination.levels[0]!.reason ?? '').length > 0, '标高层须写清来源');
  assert.match(axisById.get('corridor_axis')!.reason!, /走廊\/客厅边吊主干轴线/, '走廊轴 reason 须写清主干轴线来源');

  const expectedKinds: Record<string, string[]> = {
    'refrigerant-trunk': ['vertical_to', 'absolute', 'axis_jog', 'axis_run', 'vertical_to', 'axis_run', 'axis_run'],
    'refrigerant-master': ['axis_jog', 'axis_run', 'axis_run', 'axis_run'],
    'refrigerant-parent': ['axis_jog', 'axis_run', 'axis_run', 'axis_run', 'vertical_to', 'axis_run'],
    'refrigerant-study': ['axis_jog', 'axis_run', 'axis_run', 'axis_run', 'axis_run', 'axis_run'],
    'refrigerant-child': ['axis_jog', 'axis_run', 'axis_run', 'axis_run'],
    'refrigerant-dining': ['axis_run'],
  };
  for (const id of ROUTES) {
    const route = all.coordination.routes.find((r) => r.id === id)!;
    assert.deepEqual(route.via.map((s: any) => (isMepViaCoordinate(s) ? 'absolute' : s.kind)), expectedKinds[id], `${id} via 步型须为本批设计`);
    assert.ok(route.via.every((s: any) => isMepViaCoordinate(s) || s.y === undefined), `${id} 关系步不得重复声明高度`);
    // 工程状态原样保留。
    assert.equal(route.status, 'inferred');
    assert.equal(route.source_status, 'preliminary');
    assert.equal(route.construction_status, 'pending');
    assert.match(route.reason!, /2026-11-15 issue #98 MEP batch 4/, `${id} reason 须记迁移注记`);
  }
  // trunk 唯一剩余绝对点：外机接管斜 jog (7.05,0.55)，无已声明锚点可复用；平面绝对、
  // 高度取 level_kitchen_b_270（2026-11-15 修 Codex major：字面 y 会把标高游标重置）。
  const trunk = all.coordination.routes.find((r) => r.id === 'refrigerant-trunk')!;
  assert.equal(trunk.via.filter(isMepViaCoordinate).length, 1, 'trunk 须恰剩一个绝对步');
  assert.deepEqual(trunk.via.filter(isMepViaCoordinate), [{ x: 7.05, z: 0.55, level: 'level_kitchen_b_270' }], 'trunk 剩余绝对点须为外机接管斜 jog（平面绝对、高度取标高层）');
  // 其余五条须全关系化。
  for (const id of ROUTES.filter((x) => x !== 'refrigerant-trunk')) {
    assert.ok(all.coordination.routes.find((r) => r.id === id)!.via.every((s) => !isMepViaCoordinate(s)), `${id} 须全关系化`);
  }

  // 旧绝对几何：端点/from_height/to_height 取当前声明，轴线值取本批声明常量（独立期望），
  // 其余转点取旧绝对既有转点值（字面目标，slope_run 同款口径）。
  const expectedOld: Record<string, Array<{ x: number; y?: number; z: number }>> = {};
  for (const id of ROUTES) {
    const r = routeOf(report, id);
    const from = r.from!;
    const to = r.to!;
    const fh = r.route.from_height!;
    const th = r.route.to_height!;
    const F = { ...from, y: fh };
    const T = { ...to, y: th };
    if (id === 'refrigerant-trunk') {
      expectedOld[id] = [
        F,
        { x: from.x, z: from.z, y: LEVEL_KITCHEN_B_270 },
        { x: 7.05, z: 0.55, y: LEVEL_KITCHEN_B_270 },
        { x: AXIS_TRUNK_X745, z: 0.55, y: LEVEL_KITCHEN_B_270 },
        { x: AXIS_TRUNK_X745, z: 3, y: LEVEL_KITCHEN_B_270 },
        { x: AXIS_TRUNK_X745, z: 3, y: th },
        { x: AXIS_TRUNK_X745, z: CORRIDOR_AXIS_Z, y: th },
        { x: to.x, z: CORRIDOR_AXIS_Z, y: th },
        T,
      ];
    } else if (id === 'refrigerant-master') {
      expectedOld[id] = [F, { x: from.x, z: CORRIDOR_AXIS_Z, y: fh }, { x: 4.6, z: CORRIDOR_AXIS_Z, y: fh }, { x: 4.05, z: CORRIDOR_AXIS_Z, y: fh }, { x: to.x, z: CORRIDOR_AXIS_Z, y: fh }, T];
    } else if (id === 'refrigerant-parent') {
      expectedOld[id] = [
        F,
        { x: from.x, z: CORRIDOR_AXIS_Z, y: fh },
        { x: 5.5, z: CORRIDOR_AXIS_Z, y: fh },
        { x: 5.5, z: 5.45, y: fh },
        { x: 5.5, z: to.z, y: fh },
        { x: 5.5, z: to.z, y: th },
        { x: to.x, z: to.z, y: th },
        T,
      ];
    } else if (id === 'refrigerant-study') {
      expectedOld[id] = [
        F,
        { x: from.x, z: CORRIDOR_AXIS_Z, y: fh },
        { x: 12.71, z: CORRIDOR_AXIS_Z, y: fh },
        { x: 12.71, z: AXIS_LIVING_SOUTH_Z555, y: fh },
        { x: AXIS_BE_WEST_X1340, z: AXIS_LIVING_SOUTH_Z555, y: fh },
        { x: AXIS_BE_WEST_X1340, z: 5.9, y: fh },
        { x: 13.6, z: 5.9, y: fh },
        T,
      ];
    } else if (id === 'refrigerant-child') {
      expectedOld[id] = [
        F,
        { x: from.x, z: CORRIDOR_AXIS_Z, y: fh },
        { x: 4.35, z: CORRIDOR_AXIS_Z, y: fh },
        { x: 4.35, z: 4.35, y: fh },
        { x: 4.35, z: to.z, y: fh },
        T,
      ];
    } else {
      expectedOld[id] = [F, { x: to.x, z: from.z, y: fh }, T];
    }
  }
  for (const id of ROUTES) {
    const r = routeOf(report, id);
    assert.deepEqual(r.unresolved, [], `${id} 须解出`);
    assert.deepEqual(r.diagnostics, [], `${id} 须无诊断`);
    const expected = dedup(expectedOld[id]);
    // 原始点数（含 parent 末点与 to 端点的重复）须与旧几何一致；逐点比较用去重后序列
    //（resolveMepRoute 不去重，重复点原样保留，见 #231 C1 同款口径）。
    assert.equal(r.points.length, expectedOld[id].length, `${id} 折线原始点数须与旧几何一致`);
    assert.equal(dedup(r.points).length, expected.length, `${id} 去重点数须与旧几何一致`);
    dedup(r.points).forEach((p, i) => assertPointClose(p, expected[i], `${id} 第 ${i} 点`));
    // trunk 第 2 段（points[1]→[2]）为外机接管斜 jog（6.4,0.5)→(7.05,0.55)，平面斜向——
    // 本批唯一留绝对的点，无已声明锚点可正交化；其余段（含其余五条全段）须正交。
    if (id === 'refrigerant-trunk') {
      for (let i = 1; i < r.points.length; i++) {
        if (i === 2) continue;
        const a = r.points[i - 1]!;
        const b = r.points[i]!;
        assert.ok(Math.abs(a.x - b.x) <= TOL || Math.abs(a.z - b.z) <= TOL, `${id} 第 ${i} 段不是正交段`);
      }
      const jog = r.points[2]!;
      assert.deepEqual([jog.x, jog.z], [7.05, 0.55], 'trunk 斜 jog 点须为旧绝对值 (7.05,0.55)');
    } else if (id === 'refrigerant-study') {
      // study 末段 (13.6,5.9)→(15.1,5.85) 在旧绝对几何里本就是斜向（内机不在 z=5.9 线上），
      // 本批原样保留、不引入新斜段；其余段须正交。
      for (let i = 1; i < r.points.length - 1; i++) {
        const a = r.points[i - 1]!;
        const b = r.points[i]!;
        assert.ok(Math.abs(a.x - b.x) <= TOL || Math.abs(a.z - b.z) <= TOL, `${id} 第 ${i} 段不是正交段`);
      }
      const last = r.points[r.points.length - 1]!;
      const prev = r.points[r.points.length - 2]!;
      assert.ok(Math.abs((last.x - prev.x) - 1.5) <= TOL && Math.abs((last.z - prev.z) + 0.05) <= TOL, 'study 末段须为旧绝对斜向 (Δx=1.5, Δz=−0.05)，不得改值');
    } else {
      assertOrthogonal(r.points, id);
    }
    assert.ok(Math.abs(planLength(r.points) - planLength(expected)) <= TOL, `${id} 平面长度须等于旧几何`);
    assert.ok(Math.abs(length3d(r.points) - length3d(expected)) <= TOL, `${id} 三维长度须等于旧几何`);
    assert.ok(!takeoff.unresolved.some((u) => u.id === id), `算量 unresolved 不得含 ${id}`);
  }
});

// ───────── C2：单声明传动 ─────────

test('C2：走廊轴 4.6→4.7——只改一处声明，四条支路入口跟随、trunk fail-closed、dining 不动', () => {
  const all = loadAll();
  const before = resolveMepOnly(all, all.coordination);
  assert.deepEqual(before.report.diagnostics, [], '基线须无诊断');
  const moved = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  const axis = moved.axes.find((a) => a.id === 'corridor_axis')!;
  axis.value = 4.7;
  assert.deepEqual(leafDiffPaths(all.coordination, moved), ['axes.0.value'], '实验只能改动一处声明');

  const after = resolveMepOnly(all, moved);
  // 四条支路：入口 jog 落点与沿轴跑段跟随到 4.7；其余拐点不动。
  for (const id of ['refrigerant-master', 'refrigerant-parent', 'refrigerant-study', 'refrigerant-child'] as const) {
    const rb = routeOf(before.report, id);
    const ra = routeOf(after.report, id);
    assert.deepEqual(ra.unresolved, [], `${id} 移动后须解出`);
    assert.ok(Math.abs((ra.viaPoints[0]!.z - rb.viaPoints[0]!.z) - 0.1) <= TOL, `${id} 入口点须南移 0.10m`);
    assert.equal(ra.points.length, rb.points.length, `${id} 移动前后点数须一致`);
  }
  // trunk：末步沿走廊轴跑，游标经 x=7.45 轴跑到字面 4.6 后不在新轴上——声明不一致须
  // fail-closed，不静默贴轴、不出局部几何。
  const trunkAfter = routeOf(after.report, 'refrigerant-trunk');
  assert.deepEqual(trunkAfter.unresolved, ['via'], 'trunk 走廊轴移动后须 via 未解');
  assert.deepEqual(trunkAfter.points, [], 'trunk 走廊轴移动后不得出局部几何');
  assert.match(trunkAfter.diagnostics[0], /不在轴线 "corridor_axis" 上/, 'trunk 诊断须点名走廊轴');
  // dining：不引用走廊轴，全程不动。
  assert.deepEqual(routeOf(after.report, 'refrigerant-dining').points, routeOf(before.report, 'refrigerant-dining').points, 'dining 不得移动');
  // 恢复：用原始配置重解，几何与诊断完全复原。
  const restored = resolveMepOnly(all, all.coordination);
  for (const id of ROUTES) {
    assert.deepEqual(routeOf(restored.report, id).points, routeOf(before.report, id).points, `${id} 恢复后折线须与实验前完全一致`);
    assert.deepEqual(routeOf(restored.report, id).diagnostics, [], `${id} 恢复后须无诊断`);
  }
});

test('C2：主管轴 7.45→7.55——只改一处声明，trunk 跟随、其余五条不动', () => {
  const all = loadAll();
  const before = resolveMepOnly(all, all.coordination);
  const moved = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  moved.axes.find((a) => a.id === 'axis_trunk_x745')!.value = 7.55;
  assert.deepEqual(leafDiffPaths(all.coordination, moved), ['axes.3.value'], '实验只能改动一处声明');
  const after = resolveMepOnly(all, moved);
  const rb = routeOf(before.report, 'refrigerant-trunk');
  const ra = routeOf(after.report, 'refrigerant-trunk');
  assert.deepEqual(ra.unresolved, [], 'trunk 移动后须解出');
  assert.equal(ra.points.length, rb.points.length, 'trunk 移动前后点数须一致');
  for (const i of [3, 4, 5, 6]) {
    assert.ok(Math.abs((ra.points[i]!.x - rb.points[i]!.x) - 0.1) <= TOL, `trunk 第 ${i} 点 x 须东移 0.10m`);
  }
  assert.deepEqual(ra.points[0], rb.points[0], 'trunk 起升点（外机端）不得移动');
  assert.deepEqual(ra.points[1], rb.points[1], 'trunk 绝对 jog 点不得移动');
  // 平面/三维总长不变：入轴 jog 段 +0.10m 与末段沿走廊轴东延 −0.10m 相抵。
  assert.ok(Math.abs(planLength(ra.points) - planLength(rb.points)) <= TOL, 'trunk 平面长度须不变（两段 ±0.10m 相抵）');
  assert.ok(Math.abs(length3d(ra.points) - length3d(rb.points)) <= TOL, 'trunk 三维长度须不变');
  for (const id of ROUTES.filter((x) => x !== 'refrigerant-trunk')) {
    assert.deepEqual(routeOf(after.report, id).points, routeOf(before.report, id).points, `${id} 不得移动`);
  }
});

test('C2：标高层 2.7→2.8——只改一处声明，trunk 厨房段跟随、落点后不动、其余五条不动', () => {
  const all = loadAll();
  const before = resolveMepOnly(all, all.coordination);
  const moved = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  moved.levels.find((l) => l.id === 'level_kitchen_b_270')!.y = 2.8;
  assert.deepEqual(leafDiffPaths(all.coordination, moved), ['levels.0.y'], '实验只能改动一处声明');
  const after = resolveMepOnly(all, moved);
  const rb = routeOf(before.report, 'refrigerant-trunk');
  const ra = routeOf(after.report, 'refrigerant-trunk');
  assert.deepEqual(ra.unresolved, [], 'trunk 移动后须解出');
  // 厨房段统一跟随标高层：起升点升 0.10m；绝对 jog (7.05,0.55) 平面仍字面、高度取
  // level_kitchen_b_270（2026-11-15 修 Codex major），故入轴/南下各点同升 0.10m；
  // vertical_to 落至 to_height 2.6 的各点不动，起升段 2.00m→2.10m 与竖降段 0.10m→0.20m 各 +0.10m。
  for (const i of [0, 1, 2, 3]) {
    assert.ok(Math.abs((ra.viaPoints[i]!.y! - rb.viaPoints[i]!.y!) - 0.1) <= TOL, `trunk 第 ${i} 点须升 0.10m（厨房段跟随标高层）`);
  }
  assert.deepEqual(ra.viaPoints.slice(4), rb.viaPoints.slice(4), 'trunk 落至 to_height 后的各点不得移动');
  assert.ok(Math.abs(planLength(ra.points) - planLength(rb.points)) <= TOL, 'trunk 平面长度须不变');
  assert.ok(Math.abs((length3d(ra.points) - length3d(rb.points)) - 0.2) <= TOL, 'trunk 三维长度须 +0.20m（起升段与竖降段各 +0.10m）');
  for (const id of ROUTES.filter((x) => x !== 'refrigerant-trunk')) {
    assert.deepEqual(routeOf(after.report, id).points, routeOf(before.report, id).points, `${id} 不得移动`);
  }
});

test('C2：客厅内机 x 10.3→10.5——只改一处端点声明，trunk 末步跟随、dining 不动', () => {
  const all = loadAll();
  const before = resolveMepOnly(all, all.coordination);
  const movedCeiling = JSON.parse(JSON.stringify(all.ceiling)) as any[];
  const acLiving = movedCeiling.find((p) => p.id === 'ac_living')!;
  acLiving.x = 10.5;
  assert.deepEqual(leafDiffPaths(all.ceiling, movedCeiling), ['1.x'], '实验只能改动一处声明');
  const after = resolveMepOnly(all, all.coordination, movedCeiling);
  const rb = routeOf(before.report, 'refrigerant-trunk');
  const ra = routeOf(after.report, 'refrigerant-trunk');
  assert.deepEqual(ra.unresolved, [], 'trunk 移动后须解出');
  assert.ok(Math.abs((ra.to!.x - rb.to!.x) - 0.2) <= TOL, 'trunk 末端须东移 0.20m');
  assert.ok(Math.abs((ra.viaPoints[ra.viaPoints.length - 1]!.x - rb.viaPoints[rb.viaPoints.length - 1]!.x) - 0.2) <= TOL, 'trunk 末步（to:to）须跟随末端');
  assert.deepEqual(ra.viaPoints.slice(0, -1), rb.viaPoints.slice(0, -1), 'trunk 其余拐点不得移动');
  assert.ok(Math.abs((planLength(ra.points) - planLength(rb.points)) - 0.2) <= TOL, 'trunk 平面长度须 +0.20m');
  for (const id of ROUTES.filter((x) => x !== 'refrigerant-trunk')) {
    assert.deepEqual(routeOf(after.report, id).points, routeOf(before.report, id).points, `${id} 不得移动`);
  }
});

// ───────── C3：算量等价 ─────────

test('C3：算量等价——旧绝对 via 与新关系 via 的 takeoff 关键输出一致', () => {
  const all = loadAll();
  const migrated = resolveChain(all, all.furnishings);
  // 旧几何由当前解算推导（与 C1 同构）：把六路由 via 换回绝对坐标，其余一字不动。
  const oldCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  for (const id of ROUTES) {
    const r = routeOf(migrated.report, id);
    const route = oldCoord.routes.find((x) => x.id === id)!;
    route.via = r.viaPoints.map((p) => ({ x: p.x, z: p.z, y: p.y })) as any;
  }
  const oldReport = resolveMepRoutes(oldCoord, migrated.sources);
  assert.deepEqual(oldReport.diagnostics, [], '旧绝对几何须解出（对照组）');
  const oldTakeoff = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: oldCoord.routes,
    resolution: oldReport,
    rules: all.rules,
  });
  assert.deepEqual(oldTakeoff.conduit, migrated.takeoff.conduit, 'conduit 各层总长须与旧几何一致');
  assert.deepEqual(oldTakeoff.coverage, migrated.takeoff.coverage, 'coverage 须与旧几何一致');
  assert.deepEqual(oldTakeoff.unresolved, migrated.takeoff.unresolved, '算量 unresolved 清单须与旧几何一致');
  assert.equal(oldTakeoff.feasibleForQuote, migrated.takeoff.feasibleForQuote, '可报价标志须与旧几何一致');
  assert.equal(oldTakeoff.trunkConduitM, migrated.takeoff.trunkConduitM, '主干管长须与旧几何一致');
});

// ───────── C4：路由级反例 fail-closed ─────────

test('C4：反例——轴线/标高层缺失一律 fail-closed，不出局部几何、不牵连他路由', () => {
  const all = loadAll();
  const base = resolveChain(all, all.furnishings);
  assert.deepEqual(base.report.diagnostics, [], '基线须无诊断');

  // (1) axes 表整体缺失：二十条具名轴线路由（强电 8 + 弱电 7 + 冷媒 5）全部 via 未解；
  // dining 只用方向型 axis_run（axis 'x'，不查表），仍解出；解出总数 117 条。
  const noAxesCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  noAxesCoord.axes = [];
  const noAxes = resolveMepRoutes(noAxesCoord, base.sources);
  for (const id of ROUTES.filter((x) => x !== 'refrigerant-dining')) {
    const r = routeOf(noAxes, id);
    assert.deepEqual(r.unresolved, ['via'], `${id} 轴线缺失须 via 未解`);
    assert.deepEqual(r.points, [], `${id} 轴线缺失不得出局部几何`);
    assert.match(r.diagnostics[0], /引用未知轴线/, `${id} 诊断须点名轴线`);
  }
  assert.deepEqual(routeOf(noAxes, 'refrigerant-dining').unresolved, [], 'dining 只用方向型 axis_run，不查 axes 表，须仍解出');
  assert.equal(noAxes.routes.filter((r) => r.unresolved.length === 0).length, 117, '其余路由不得被牵连（137 − 20 条具名轴线路由）');

  // (2) 只删走廊轴：四条支路 + trunk（末步沿走廊轴）失败；dining 不引用走廊轴，仍解出。
  const noCorridorCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  noCorridorCoord.axes = noCorridorCoord.axes.filter((a) => a.id !== 'corridor_axis');
  const noCorridor = resolveMepRoutes(noCorridorCoord, base.sources);
  for (const id of ['refrigerant-trunk', 'refrigerant-master', 'refrigerant-parent', 'refrigerant-study', 'refrigerant-child'] as const) {
    const r = routeOf(noCorridor, id);
    assert.deepEqual(r.unresolved, ['via'], `${id} 走廊轴缺失须 via 未解`);
    assert.deepEqual(r.points, [], `${id} 走廊轴缺失不得出局部几何`);
  }
  assert.deepEqual(routeOf(noCorridor, 'refrigerant-dining').unresolved, [], 'dining 不引用走廊轴，须仍解出');

  // (3) 只删标高层：仅 trunk（vertical_to 引用）失败；其余五条仍解出。
  const noLevelCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  noLevelCoord.levels = [];
  const noLevel = resolveMepRoutes(noLevelCoord, base.sources);
  const trunkBroken = routeOf(noLevel, 'refrigerant-trunk');
  assert.deepEqual(trunkBroken.unresolved, ['via'], 'trunk 标高层缺失须 via 未解');
  assert.deepEqual(trunkBroken.points, [], 'trunk 标高层缺失不得出局部几何');
  assert.match(trunkBroken.diagnostics[0], /引用未知标高层 "level_kitchen_b_270"/, 'trunk 诊断须点名标高层');
  for (const id of ROUTES.filter((x) => x !== 'refrigerant-trunk')) {
    assert.deepEqual(routeOf(noLevel, id).unresolved, [], `${id} 不引用标高层，须仍解出`);
  }

  // (4) 算量：冷媒层在 mep-takeoff.yaml 的 excluded_layers 里（铜管与保温由中央空调
  // 合同承担 COST-030-02），takeoff 从不收冷媒路由——求解失败亦不进 unresolved、
  // 不动 feasibleForQuote（迁移前旧绝对路由同款口径，非本批引入的盲区）。
  // 冷媒 fail-closed 的显形面是统一出口诊断（上 (1)–(3)）与 DXF errors（下 (5)）
  // 及 verify:mep（全套件）。
  // 集成 #243：走廊轴为强电/弱电/冷媒共用，整表删除会连带强电/弱电路由（进算量）
  // 一并失败；此处只删本批独占的三条轴（trunk / study 失败，均为冷媒层），隔离验证。
  const noRefAxesCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  noRefAxesCoord.axes = noRefAxesCoord.axes.filter((a) => !['axis_trunk_x745', 'axis_living_south_z555', 'axis_be_west_x1340'].includes(a.id));
  const noRefAxes = resolveMepRoutes(noRefAxesCoord, base.sources);
  const brokenTakeoff = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: noRefAxesCoord.routes,
    resolution: noRefAxes,
    rules: all.rules,
  });
  assert.deepEqual(brokenTakeoff, base.takeoff, '冷媒求解失败时算量须全等不变（冷媒层本就不进算量）');

  // (5) DXF：同一求解失败进装配 errors，该路由折线不进图；健康对照出图。
  const dxfSources = {
    electrical: [],
    plumbing: [],
    ceiling: [{ id: 'ac_master', room: 'master_bedroom', type: 'ac_indoor', x: 3.7, z: 5.1, height: 2.85 }],
    hvacAnchors: [
      { id: 'bend_corridor', status: 'inferred', system: 'refrigerant', position: { x: 7.2, y: 2.5, z: 4.3 } },
      { id: 'indoor_master', status: 'confirmed', system: 'refrigerant', ref: { source: 'ceiling', id: 'ac_master' } },
    ],
    hvacTerminals: [],
    outdoor: [],
  } as any;
  const dxfLayers = Object.fromEntries(['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'].map((id) => [id, { label: id, color: '#fff', height: 2.55 }]));
  const masterRoute = all.coordination.routes.find((r) => r.id === 'refrigerant-master')!;
  const dxfCoord = {
    version: 'test', status: 'test', layers: dxfLayers, junctions: [],
    routes: [JSON.parse(JSON.stringify(masterRoute))],
    shafts: [],
    axes: [],
    levels: [],
  } as unknown as MepCoordination;
  const brokenDxf = buildProjectDxf({ house: { furnishings: {}, sceneElements: [] }, mep: { coordination: dxfCoord, sources: dxfSources } });
  assert.ok(brokenDxf.errors.some((e) => e.includes('refrigerant-master')), 'DXF errors 须点名失败路由');
  assert.ok(!brokenDxf.dxf.includes('4050'), 'DXF 不得出失败路由的折线（x=4.05 转点的毫米坐标不得出现）');
  // 健康对照：轴线在表时同一通道出图、errors 为空、折线在图内。
  const healthyCoord = JSON.parse(JSON.stringify(dxfCoord)) as MepCoordination;
  healthyCoord.axes = [{ id: 'corridor_axis', axis: 'z', value: 4.6, reason: 'test' }];
  const healthyDxf = buildProjectDxf({ house: { furnishings: {}, sceneElements: [] }, mep: { coordination: healthyCoord, sources: dxfSources } });
  assert.deepEqual(healthyDxf.errors, [], '健康轴线时 DXF 须无 errors');
  assert.ok(healthyDxf.dxf.includes('4050'), '健康轴线时 DXF 须含 x=4.05 转点折线');
});
