/**
 * Issue #98 MEP batch 2（强电干线切片）：10 条强电干线路由关系化。
 *
 * 真实 YAML + 内存改动；实验后不写盘。迁移等价证明（旧绝对几何逐点比对）已随
 * PR #248 合入归档在该 PR 记录与 git 历史里，不住测试套件——本文件断言的是
 * 持续不变式：端点与声明 from/to（+ from_height/to_height）一致、折线正交、
 * 无连续重复点、无往返折返、每个坐标/标高都来自当轮声明（端点/轴线/竖井/
 * via 目标/level），无诊断；算量断言改为自洽规则（takeoff 各输出由同一份
 * 解算结果独立重算）。容差 0.005m。
 * 覆盖：C1 关系化不变式、C2a–d 传动（改一处声明）、C3 算量自洽、
 * C4 反例 fail-closed（机制 + 真实配置）。
 * lint / 3D / DXF / verify 由全套件 + verify:all + 导出脚本覆盖（见 PR 描述）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  MepCoordinationSchema,
  endpointSourcesFromFacts,
  isMepViaCoordinate,
  parseMepCoordination,
  resolveMepRoutes,
  resolveMepViaSteps,
  validateMepCoordination,
  type MepCoordination,
  type MepEndpointSources,
  type MepRoute,
} from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination } from '../../shared/mep-hvac-lint.js';
import { computeMepTakeoff, unionPlanLength, type MepTakeoffRules, type TakeoffCircuit } from '../../shared/mep-takeoff.js';
import { buildProjectDxf } from '../../shared/dxf/project-dxf.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveFurniturePlacements } from '../../shared/furniture-placement.js';
import { resolvePointPlacementInWalls } from '../../shared/point-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';

const TOL = 0.005;
const SLICE_IDS = [
  'strong-main',
  'strong-ac-living',
  'strong-ac-dining',
  'strong-ac-master',
  'strong-ac-parent',
  'strong-ac-child',
  'strong-ac-study',
  'strong-ac-outdoor',
  'strong-power-weakbox',
  'strong-power-living-table',
] as const;
type SliceId = (typeof SLICE_IDS)[number];
/** 引用走廊轴的 8 条路由（table / weakbox 走竖井拓扑，不引用 axes 表）。 */
const AXIS_IDS = [
  'strong-main',
  'strong-ac-living',
  'strong-ac-dining',
  'strong-ac-master',
  'strong-ac-parent',
  'strong-ac-child',
  'strong-ac-study',
  'strong-ac-outdoor',
] as const;
/** 引用弱电轴的 7 条路由（issue #98 MEP batch 3；与 AXIS_IDS 并列，C4b 合并统计）。 */
const WEAK_AXIS_IDS = [
  'weak-main-living',
  'weak-master',
  'weak-parent',
  'weak-study',
  'weak-gateway',
  'weak-ap',
  'weak-ap-master',
] as const;
/** 引用冷媒轴的 5 条路由（issue #98 MEP batch 4；dining 只用方向型 axis_run，不查表）。 */
const REFRIGERANT_AXIS_IDS = [
  'refrigerant-trunk',
  'refrigerant-master',
  'refrigerant-parent',
  'refrigerant-study',
  'refrigerant-child',
] as const;
/** 本批迁移新增的 29 条轴路由（强电：专用 5 + 照明 9 + 普通 15；均引用 axes 表——
 *  C4b 实算：axes 表缺失时与原 20 条同断，合计 49 条）。 */
const NEW_STRONG_AXIS_IDS = [
  'strong-ded-bathheaters-gbath',
  'strong-ded-bathheaters-mbath',
  'strong-ded-dishwasher',
  'strong-ded-fridge-living',
  'strong-ded-washer-dryer',
  'strong-light-balcony',
  'strong-light-child',
  'strong-light-corridor',
  'strong-light-entry-base',
  'strong-light-kitchen',
  'strong-light-living',
  'strong-light-master',
  'strong-light-parent',
  'strong-light-study',
  'strong-power-garden',
  'strong-power-gbath',
  'strong-power-kitchen',
  'strong-power-kitchen-east',
  'strong-power-living',
  'strong-power-master',
  'strong-power-mbath-service',
  'strong-power-parent',
  'strong-power-parent-child-childbed',
  'strong-power-parent-child-guest-bed-r',
  'strong-power-parent-child-guest-north',
  'strong-power-parent-child-guest-west',
  'strong-power-parent-child-study-curtain',
  'strong-power-study',
  'strong-power-waterbar',
] as const;
/** 全部 49 条轴路由（强电 37 + 弱电 7 + 冷媒 5；issue #243 统一协议后 axes 表缺失即全断）。 */
const ALL_AXIS_IDS = [...AXIS_IDS, ...NEW_STRONG_AXIS_IDS, ...WEAK_AXIS_IDS, ...REFRIGERANT_AXIS_IDS] as const;
/** 进算量的轴路由（强电 37 + 弱电 7；冷媒 5 条在 mep-takeoff.yaml 的 excluded_layers 里，
 *  求解失败不进 takeoff unresolved——C4b 算量断言只钉这 44 条）。 */
const TAKEOFF_AXIS_IDS = [...AXIS_IDS, ...NEW_STRONG_AXIS_IDS, ...WEAK_AXIS_IDS] as const;
const EXPECTED_KINDS: Record<SliceId, string[]> = {
  'strong-main': ['axis_jog', 'axis_run'],
  'strong-ac-living': ['axis_jog', 'axis_run'],
  'strong-ac-dining': ['axis_jog', 'axis_run'],
  // 2026-11-23：末段拆成「贴墙南行到插座 z」+「纯竖向 0.05m」，不再一腿同时跑平面和升高。
  'strong-ac-master': ['axis_jog', 'axis_run', 'axis_run'],
  'strong-ac-parent': ['axis_jog', 'axis_run', 'axis_run'],
  'strong-ac-child': ['axis_jog', 'axis_run', 'axis_run', 'axis_run'],
  'strong-ac-study': ['axis_jog', 'axis_run', 'axis_run', 'axis_run', 'axis_run', 'axis_run'],
  'strong-ac-outdoor': ['axis_jog', 'axis_run', 'axis_run', 'level', 'axis_run', 'axis_run'],
  'strong-power-weakbox': ['from_face_jog', 'level', 'axis_run', 'axis_run'],
  'strong-power-living-table': ['from_face_jog', 'from_drop', 'shaft_run'],
};

/** strong-ded-bathheaters-mbath 的关系步型序列（本批 51 条迁移为关系步；旧绝对 via
 *  见 PR #248 记录与 git 历史）。步型是结构声明；步的具体目标（轴线 id、
 *  vertical_to 目标）由下方断言逐条核对，不再整段钉死 via 字面量。 */
// 2026-11-23：走廊轴之后先贴 w_nw_south（z=4.48）再西行到 x=2.43，然后才 vertical_to。
// 旧序列在 y=2.55 上直飞主卫，门头盒改梁后那一段没有吊顶。
const MBATH_KINDS = ['axis_jog', 'axis_run', 'axis_run', 'axis_run', 'vertical_to', 'axis_run', 'axis_run'];

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
function resolveChain(all: ReturnType<typeof loadAll>, furnishings: FurnishingsYaml, coordination?: MepCoordination) {
  const coord = coordination ?? all.coordination;
  const wallSegments = new Map<string, any[]>();
  for (const wall of all.layout.walls as any[]) {
    const list = wallSegments.get(wall.id ?? '') ?? [];
    list.push(wall);
    wallSegments.set(wall.id ?? '', list);
  }
  const items = Object.values(furnishings).flat();
  // 房间相对摆位（2026-11-16 DDD 模型约束）：房间包络随解算上下文传入；不传时 7 件
  // 房间相对家具诊断失败（不回落绝对坐标）。
  const rooms = new Map(all.layout.rooms.map((room) => [room.id, room]));
  const { placements, diagnostics } = resolveFurniturePlacements(items, wallSegments as any, { rooms });
  const { mountHosts } = buildPlacementIndexes({ geometry: { walls: all.layout.walls }, furnishings, anchors: { rooms } });
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
  const report = resolveMepRoutes(coord, sources);
  const takeoff = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: coord.routes,
    resolution: report,
    rules: all.rules,
  });
  return { placements, diagnostics, points, pointDiagnostics, sources, report, takeoff };
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
/** 端点须为声明 from/to（+ from_height/to_height）：解算不得改端点。 */
function assertEndpoints(r: ReturnType<typeof routeOf>, what: string): void {
  const first = r.points[0];
  const last = r.points[r.points.length - 1];
  assert.ok(first, `${what} 折线不得为空`);
  assertPointClose(first, { ...r.from!, y: r.route.from_height }, `${what} 起点须为 from + from_height`);
  assertPointClose(last, { ...r.to!, y: r.route.to_height ?? r.to!.y }, `${what} 终点须为 to + to_height`);
}
/** 无往返折返：同一线段（任一方向）不得出现两次（1mm 舍入去浮点尾巴）。 */
function assertNoRetrace(points: ReadonlyArray<{ x: number; y?: number; z: number }>, what: string): void {
  const key = (a: { x: number; y?: number; z: number }, b: { x: number; y?: number; z: number }): string =>
    `${a.x.toFixed(3)},${a.z.toFixed(3)},${(a.y ?? 0).toFixed(3)}|${b.x.toFixed(3)},${b.z.toFixed(3)},${(b.y ?? 0).toFixed(3)}`;
  const seen = new Set<string>();
  for (let i = 1; i < points.length; i++) {
    const k = key(points[i - 1], points[i]);
    const rev = key(points[i], points[i - 1]);
    assert.ok(!seen.has(k) && !seen.has(rev), `${what} 第 ${i} 段与前面重合（往返折返）`);
    seen.add(k);
  }
}
/**
 * 无发明坐标：折线每个点的 x/z 须来自当轮声明——端点、任一轴线值、任一竖井坐标、
 * 或本路由任一步的数值 to 目标。解算器只组合声明值，不编造新坐标。
 */
function assertNoInventedCoords(
  r: ReturnType<typeof routeOf>,
  axes: MepCoordination['axes'],
  shafts: MepCoordination['shafts'],
  what: string,
): void {
  const xs = new Set<number>([r.from!.x, r.to!.x]);
  const zs = new Set<number>([r.from!.z, r.to!.z]);
  for (const a of axes) (a.axis === 'x' ? xs : zs).add(a.value);
  for (const s of shafts) {
    xs.add(s.x);
    zs.add(s.z);
  }
  for (const step of r.route.via as any[]) {
    if (typeof step.to === 'number') {
      xs.add(step.to);
      zs.add(step.to);
    }
  }
  for (const p of r.points) {
    assert.ok([...xs].some((v) => Math.abs(p.x - v) <= TOL), `${what} 点 x=${p.x} 不在任何声明值中`);
    assert.ok([...zs].some((v) => Math.abs(p.z - v) <= TOL), `${what} 点 z=${p.z} 不在任何声明值中`);
  }
}
/**
 * 无发明标高：折线每个点的 y 须来自当轮声明——from_height、to_height、任一
 * level 步的 y、或任一竖井的 y。解算器只组合声明标高，不编造新高度。
 */
function assertDeclaredHeights(
  r: ReturnType<typeof routeOf>,
  shafts: MepCoordination['shafts'],
  what: string,
): void {
  const ys = new Set<number>();
  if (r.route.from_height !== undefined) ys.add(r.route.from_height);
  if (r.route.to_height !== undefined) ys.add(r.route.to_height);
  for (const step of r.route.via as any[]) {
    if (typeof step.y === 'number') ys.add(step.y);
  }
  for (const s of shafts) ys.add(s.y);
  for (const p of r.points) {
    if (p.y === undefined) continue;
    assert.ok([...ys].some((v) => Math.abs(p.y! - v) <= TOL), `${what} 点 y=${p.y} 不在任何声明高度中`);
  }
}
/** 无连续重复点，唯一例外是末点追加端点重复：解算器在末步已落到端点时仍追加
 *  端点，产生一条零长段（不产生长度，是已知良性 artifact）；其余连续重复皆为缺陷。 */
function assertNoDuplicates(points: ReadonlyArray<{ x: number; y?: number; z: number }>, what: string): void {
  const d = dedup(points);
  const trailingDup =
    points.length >= 2 &&
    d.length === points.length - 1 &&
    Math.abs(points[points.length - 1].x - points[points.length - 2].x) <= TOL &&
    Math.abs(points[points.length - 1].z - points[points.length - 2].z) <= TOL &&
    Math.abs((points[points.length - 1].y ?? 0) - (points[points.length - 2].y ?? 0)) <= TOL;
  assert.ok(
    d.length === points.length || trailingDup,
    `${what} 不得含连续重复点（末点追加端点重复除外）：去重后 ${d.length} 点，原 ${points.length} 点`,
  );
}
/** 关系路由持续不变式：端点 + 正交 + 无连续重复点（末点追加端点重复除外）+ 无往返折返 + 无发明坐标/标高。 */
function assertRouteInvariants(
  r: ReturnType<typeof routeOf>,
  coordination: MepCoordination,
  what: string,
): void {
  assert.deepEqual(r.unresolved, [], `${what} 须解出`);
  assert.deepEqual(r.diagnostics, [], `${what} 须无诊断`);
  assertEndpoints(r, what);
  assertOrthogonal(r.points, what);
  assertNoDuplicates(r.points, what);
  assertNoRetrace(r.points, what);
  assertNoInventedCoords(r, coordination.axes, coordination.shafts, what);
  assertDeclaredHeights(r, coordination.shafts, what);
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
function slicePoints(report: ReturnType<typeof resolveMepRoutes>, id: string) {
  return routeOf(report, id).points;
}

test('C1：10 条路由关系化——axes/shafts 各只声明一次，解算折线满足持续不变式', () => {
  const all = loadAll();
  const { report, takeoff } = resolveChain(all, all.furnishings);
  assert.deepEqual(report.diagnostics, [], '全量路由解算须无诊断');
  assert.doesNotThrow(() => validateMepCoordination(all.coordination, resolveChain(all, all.furnishings).sources), '迁移后 coordination 须通过 schema 校验');

  // 共享基准只声明一次，各路由共同引用。轴表只验结构（id 与方向须为预期序列）：
  // 轴值不钉——值由路由不变式（引用轴的路由须落在声明轴值上）与 C2a 传动覆盖，
  // 改轴须改声明不改测试。
  assert.deepEqual(
    all.coordination.axes.map((a) => ({ id: a.id, axis: a.axis })),
    [
      { id: 'corridor_axis', axis: 'z' },
      { id: 'weak_axis_438', axis: 'z' },
      { id: 'weak_axis_455', axis: 'z' },
      { id: 'axis_trunk_x745', axis: 'x' },
      { id: 'axis_living_south_z555', axis: 'z' },
      { id: 'axis_be_west_x1340', axis: 'x' },
    ],
    'axes 表须恰为六条轴线（强电 corridor_axis + 弱电两条 + 冷媒三条；id 与方向须为预期序列，轴值不钉）',
  );
  assert.equal(all.coordination.shafts.length, 1, 'shafts 表须只有一口竖井声明');
  assert.equal(all.coordination.shafts[0].id, 'shaft_entry');

  // 强电分区规则：每条路由要么是关系型（via 含 kind 步），要么是非关系型且带记录
  // 理由；两类穷尽全部强电路由（条数不钉，关系型 + 非关系型 === 总数）。
  // 非关系型路由须解为单一直段（from→to 两点，正交或竖直）。
  const strong = all.coordination.routes.filter((r) => r.layer === 'strong_power');
  const isRelational = (route: MepRoute): boolean =>
    route.via.some((s: any) => typeof s === 'object' && 'kind' in s);
  const relational = strong.filter(isRelational);
  const absolute = strong.filter((r) => !isRelational(r));
  assert.equal(relational.length + absolute.length, strong.length, '关系型 + 非关系型须穷尽全部强电路由');
  assert.ok(relational.length > 0, '关系型路由须存在');
  assert.ok(absolute.length > 0, '非关系型路由须存在（未迁移部分须显形，不得静默归零）');
  for (const route of absolute) {
    assert.ok((route.reason ?? '').trim().length > 0, `${route.id} 非关系型须带记录理由`);
    const r = routeOf(report, route.id);
    assert.deepEqual(r.unresolved, [], `${route.id} 须解出`);
    assert.equal(r.points.length, 2, `${route.id} 无 via 路由须解为 from→to 单一直段`);
    const [a, b] = r.points;
    assert.ok(Math.abs(a.x - b.x) <= TOL || Math.abs(a.z - b.z) <= TOL, `${route.id} 单一直段须为正交或竖直段`);
    assertEndpoints(r, route.id);
  }

  for (const id of SLICE_IDS) {
    const route = all.coordination.routes.find((r) => r.id === id)!;
    assert.deepEqual(route.via.map((s: any) => s.kind), EXPECTED_KINDS[id], `${id} via 步型须为预期序列`);
    // 非 level 步不得声明 y（高度取标高游标）；level 的 y 是本步竖向目标。
    for (const step of route.via as any[]) {
      if (step.kind === 'level') assert.ok(Number.isFinite(step.y), `${id} level 须声明有限数 y`);
      else assert.equal(step.y, undefined, `${id} ${step.kind} 不得声明 y`);
    }
    assert.equal(route.construction_status, 'pending', `${id} 施工状态须留 pending`);
    assert.equal(route.status, 'inferred', `${id} 状态须为 inferred`);
    assert.equal(route.source_status, 'proposed', `${id} 来源状态须为 proposed`);
    assert.ok((route.reason ?? '').includes('2026-11-15 #98 MEP batch 2'), `${id} reason 须记 batch 2 迁移说明`);
  }
  // outdoor / weakbox 的 level 方向规则：level 目标值取声明本身，不钉具体数——
  // outdoor 是升位（level y 高于起算标高）、weakbox 是下引（level y 低于起算标高），
  // 且解算折线须实际到达该标高（有点的 y 等于声明的 level y）。
  const outdoor = all.coordination.routes.find((r) => r.id === 'strong-ac-outdoor')!;
  const outdoorLevelY = (outdoor.via as any[])[3].y as number;
  assert.ok(Number.isFinite(outdoorLevelY), 'outdoor level 须声明有限数 y');
  assert.ok(outdoorLevelY > outdoor.from_height!, 'outdoor level 须为升位（高于起算标高）');
  assert.ok(
    slicePoints(report, 'strong-ac-outdoor').some((p) => Math.abs((p.y ?? 0) - outdoorLevelY) <= TOL),
    'outdoor 解算折线须实际到达声明的升位标高',
  );
  const weakbox = all.coordination.routes.find((r) => r.id === 'strong-power-weakbox')!;
  const weakboxLevelY = (weakbox.via as any[])[1].y as number;
  assert.ok(Number.isFinite(weakboxLevelY), 'weakbox level 须声明有限数 y');
  assert.ok(weakboxLevelY < weakbox.from_height!, 'weakbox level 须为下引（低于起算标高）');
  assert.ok(
    slicePoints(report, 'strong-power-weakbox').some((p) => Math.abs((p.y ?? 0) - weakboxLevelY) <= TOL),
    'weakbox 解算折线须实际到达声明的下引标高',
  );
  // sofa 两路由原样不动。
  for (const id of ['strong-power-living-sofa-l', 'strong-power-living-sofa-r']) {
    const route = all.coordination.routes.find((r) => r.id === id)!;
    assert.deepEqual(route.via.map((s: any) => s.kind), ['from_face_jog', 'from_drop', 'shaft_run'], `${id} 须仍为三步`);
  }
  // mbath 已随本批 51 条迁移为关系步：步型序列 + 步目标规则，不再整段钉死 via。
  const mbath = all.coordination.routes.find((r) => r.id === 'strong-ded-bathheaters-mbath')!;
  assert.deepEqual(mbath.via.map((s: any) => s.kind), MBATH_KINDS, 'mbath via 步型须为预期序列');
  assert.ok(
    (mbath.via as any[]).every((s) => typeof s === 'object' && s !== null && 'kind' in s),
    'mbath via 不得含绝对坐标步（每步须为关系步）',
  );
  assert.deepEqual(
    (mbath.via as any[]).slice(0, 2).map((s) => s.axis),
    ['corridor_axis', 'corridor_axis'],
    'mbath 前两步须引用走廊轴',
  );
  assert.equal((mbath.via as any[])[2].axis, 'z', 'mbath 第三步须沿 z 离开走廊轴');
  assert.equal((mbath.via as any[])[2].to, 4.48, 'mbath 第三步须落到 z=4.48（w_nw_south 贴墙带）');
  assert.equal((mbath.via as any[])[3].to, 2.43, 'mbath 西行须落到 x=2.43（距 w_mbath_east 0.17m，在通顶柜以东）');
  assert.equal((mbath.via as any[])[4].height, 'to', 'mbath vertical_to 须以 to 端点为升位目标');
  const mbathResolved = routeOf(report, 'strong-ded-bathheaters-mbath');
  const corridorValue = all.coordination.axes.find((a) => a.id === 'corridor_axis')!.value;
  const onCorridor = mbathResolved.points.filter((p) => Math.abs(p.z - corridorValue) <= TOL);
  assert.ok(onCorridor.length >= 2, 'mbath 须仍有落在走廊轴上的段');
  const hugged = mbathResolved.points.filter((p) => Math.abs(p.z - 4.48) <= TOL && Math.abs(p.x - 2.43) <= TOL);
  assert.ok(hugged.length >= 1, 'mbath 须经过 (2.43, 4.48) 墙角');
  const northLeg = mbathResolved.points.filter((p) => Math.abs(p.x - 2.43) <= TOL && Math.abs((p.y ?? 0) - (mbath.to_height ?? 0)) <= TOL);
  assert.ok(northLeg.length >= 2, 'mbath 北行段须在 x=2.43、升到 to_height 之后');
  assertRouteInvariants(mbathResolved, all.coordination, 'strong-ded-bathheaters-mbath');
  // 台盆电源不穿通顶柜、不贴 w_mbath_east（那条墙是剪力墙，长距离并行会过 survey 上限）。
  // x=1.92 在柜西缘 1.975 以西、局部梁头东缘 1.90 以东；z=2.96 贴 w_mbath_south。
  const service = all.coordination.routes.find((r) => r.id === 'strong-power-mbath-service')!;
  assert.deepEqual(
    service.via.map((s: any) => s.kind),
    ['axis_jog', 'axis_run', 'axis_run', 'axis_run', 'axis_run', 'axis_run'],
    'mbath-service 不得再插入 level / vertical_to 去钻柜或降到垫层',
  );
  assert.deepEqual(
    (service.via as any[]).filter((s) => typeof s.to === 'number').map((s) => s.to),
    [4.1, 4.48, 1.92, 2.96],
    'mbath-service 数字转点须为走廊出口、w_nw_south、柜西、台盆南墙',
  );
  const serviceResolved = routeOf(report, 'strong-power-mbath-service');
  assert.ok(
    serviceResolved.points.some((p) => Math.abs(p.x - 1.92) <= TOL && Math.abs(p.z - 2.96) <= TOL),
    'mbath-service 须经过 (1.92, 2.96) 再西折下引',
  );
  assertRouteInvariants(serviceResolved, all.coordination, 'strong-power-mbath-service');

  // 逐路由持续不变式：端点 + 正交 + 无连续重复点 + 无往返折返 + 无发明坐标/标高。
  // 迁移等价证明（与旧绝对几何逐点比对）已随 PR #248 合入归档，不住测试套件。
  for (const id of SLICE_IDS) {
    assertRouteInvariants(routeOf(report, id), all.coordination, id);
    assert.ok(!takeoff.unresolved.some((u) => u.id === id), `算量 unresolved 不得含 ${id}`);
  }
});

test('C2a：走廊轴值 +0.1m——只改一处声明，8 条轴路由跟随，table/weakbox/sofa 不动', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  const moved = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  // 轴值当轮直读，改动量为相对增量：轴改值后轴上点须跟随同一增量。
  const axisBefore = all.coordination.axes[0].value;
  const axisAfter = axisBefore + 0.1;
  moved.axes[0].value = axisAfter;
  assert.deepEqual(leafDiffPaths(all.coordination, moved), ['axes.0.value'], '实验只能改动一处声明');
  const after = resolveChain(all, all.furnishings, moved);
  for (const id of AXIS_IDS) {
    const rb = routeOf(before.report, id);
    const ra = routeOf(after.report, id);
    assert.deepEqual(ra.unresolved, [], `${id} 改轴后须仍解出`);
    // 端点不动（from/to 跟随端点声明，不跟随轴线）；轴上中间点 z 须跟随同一增量，x 与 y 不变。
    assert.deepEqual([ra.points[0], ra.points[ra.points.length - 1]], [rb.points[0], rb.points[rb.points.length - 1]], `${id} 端点不得移动`);
    rb.points.slice(1, -1).forEach((p, i) => {
      const q = ra.points[i + 1];
      assert.ok(Math.abs(q.x - p.x) <= TOL && Math.abs((q.y ?? 0) - (p.y ?? 0)) <= TOL, `${id} 第 ${i + 1} 点 x/y 不得移动`);
      if (Math.abs(p.z - axisBefore) <= TOL) assert.ok(Math.abs(q.z - axisAfter) <= TOL, `${id} 第 ${i + 1} 点 z 须跟随到 ${axisAfter}`);
      else assert.ok(Math.abs(q.z - p.z) <= TOL, `${id} 第 ${i + 1} 点 z 不得移动`);
    });
  }
  // 不引用轴线的路由逐字节相同。
  for (const id of ['strong-power-weakbox', 'strong-power-living-table', 'strong-power-living-sofa-l', 'strong-power-living-sofa-r']) {
    assert.deepEqual(slicePoints(after.report, id), slicePoints(before.report, id), `${id} 不得移动`);
  }
});

test('C2b：客厅空调插座 x +0.30m——living 跟随，dining 不动', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  const movedElectrical = JSON.parse(JSON.stringify(all.electrical)) as any[];
  const sock = movedElectrical.find((p) => p.id === 'sock_living_ac')!;
  // sock_living_ac 为绝对点位（absolute: true，x/z 直声明）：沿 x 改 0.30m 即改 x。
  assert.ok(sock.absolute === true && typeof sock.x === 'number', '实验前置：sock_living_ac 须为绝对点位');
  sock.x = sock.x + 0.30;
  const changed = leafDiffPaths(all.electrical, movedElectrical);
  assert.equal(changed.length, 1, '实验只能改动一处声明');
  assert.ok(changed[0].endsWith('.x'), `改动须为 x 字段，实为 ${changed[0]}`);
  const movedAll = { ...all, electrical: movedElectrical };
  const after = resolveChain(movedAll, all.furnishings);
  const rb = routeOf(before.report, 'strong-ac-living');
  const ra = routeOf(after.report, 'strong-ac-living');
  assert.deepEqual(ra.unresolved, [], 'living 改端点后须仍解出');
  const beforeTo = rb.points[rb.points.length - 1];
  const afterTo = ra.points[ra.points.length - 1];
  assert.ok(Math.abs((afterTo.x - beforeTo.x) - 0.30) <= TOL, 'living 末点 x 须东移 0.30m');
  assert.ok(Math.abs(afterTo.z - beforeTo.z) <= TOL, 'living 末点 z 不得移动');
  // 轴上拐点跟随：axis_run 落点 x 亦 +0.30。
  assert.ok(Math.abs((ra.points[2].x - rb.points[2].x) - 0.30) <= TOL, 'living axis_run 落点 x 须东移 0.30m');
  assert.deepEqual(slicePoints(after.report, 'strong-ac-dining'), slicePoints(before.report, 'strong-ac-dining'), 'dining 不得移动');
});

test('C2c：parent 分支 x +0.1m——只改一处声明，parent 南行腿跟随，child 不动', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  const moved = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  const idx = moved.routes.findIndex((r) => r.id === 'strong-ac-parent');
  // 分支目标当轮直读，改动量为相对增量：南行腿两点 x 须跟随同一增量。
  const branchBefore = (moved.routes[idx].via as any[])[1].to as number;
  const branchAfter = branchBefore + 0.1;
  (moved.routes[idx].via as any[])[1].to = branchAfter;
  assert.deepEqual(leafDiffPaths(all.coordination, moved), [`routes.${idx}.via.1.to`], '实验只能改动一处声明');
  const after = resolveChain(all, all.furnishings, moved);
  const rb = routeOf(before.report, 'strong-ac-parent');
  const ra = routeOf(after.report, 'strong-ac-parent');
  assert.deepEqual(ra.unresolved, [], 'parent 改分支后须仍解出');
  // 南行腿两点 x 须跟随到新分支值，其余点不动。
  rb.points.forEach((p, i) => {
    const q = ra.points[i];
    if (Math.abs(p.x - branchBefore) <= TOL) assert.ok(Math.abs(q.x - branchAfter) <= TOL, `parent 第 ${i} 点 x 须跟随到 ${branchAfter}`);
    else assert.ok(Math.abs(q.x - p.x) <= TOL && Math.abs(q.z - p.z) <= TOL, `parent 第 ${i} 点不得移动`);
  });
  assert.deepEqual(slicePoints(after.report, 'strong-ac-child'), slicePoints(before.report, 'strong-ac-child'), 'child 不得移动');
});

test('C2d：outdoor 升位 y +0.05m——只改一处声明，升位腿跟随，低位腿不动', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  const moved = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  const idx = moved.routes.findIndex((r) => r.id === 'strong-ac-outdoor');
  // 升位目标当轮直读，改动量为相对增量：原在升位标高的点须跟随同一增量，其余点不动。
  const levelBefore = (moved.routes[idx].via as any[])[3].y as number;
  const levelAfter = levelBefore + 0.05;
  (moved.routes[idx].via as any[])[3].y = levelAfter;
  assert.deepEqual(leafDiffPaths(all.coordination, moved), [`routes.${idx}.via.3.y`], '实验只能改动一处声明');
  const after = resolveChain(all, all.furnishings, moved);
  const rb = routeOf(before.report, 'strong-ac-outdoor');
  const ra = routeOf(after.report, 'strong-ac-outdoor');
  assert.deepEqual(ra.unresolved, [], 'outdoor 改升位后须仍解出');
  // 原在升位标高的点 y 须跟随到新标高；其余点平面与标高均不动（末点 y 取 to_height，不跟随）。
  rb.points.forEach((p, i) => {
    const q = ra.points[i];
    assert.ok(Math.abs(q.x - p.x) <= TOL && Math.abs(q.z - p.z) <= TOL, `outdoor 第 ${i} 点平面不得移动`);
    if (Math.abs((p.y ?? 0) - levelBefore) <= TOL) assert.ok(Math.abs((q.y ?? 0) - levelAfter) <= TOL, `outdoor 第 ${i} 点 y 须跟随到 ${levelAfter}`);
    else assert.ok(Math.abs((q.y ?? 0) - (p.y ?? 0)) <= TOL, `outdoor 第 ${i} 点 y 不得移动`);
  });
});

test('C3：算量自洽——takeoff 各输出由同一份解算结果独立重算', () => {
  const all = loadAll();
  const { report, takeoff } = resolveChain(all, all.furnishings);

  // 1. 确定性：同一份输入重算，结果逐项一致。
  const again = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: all.coordination.routes,
    resolution: report,
    rules: all.rules,
  });
  assert.deepEqual(again, takeoff, '同一份输入重算 takeoff 须逐项一致');

  // 2. 各总量由解算结果独立重算（与 takeoff 同口径的过滤：covered 层、已解出、
  //    physical、端点未延期；下引仅当 rules.include_terminal_drop 开启）。
  const covered = new Set(all.rules.covered_layers);
  const elecById = new Map(all.electrical.map((p: any) => [p.id, p]));
  const pointHeights = new Map<string, number>();
  for (const p of [...all.electrical, ...all.plumbing]) {
    if (p.height !== undefined) pointHeights.set(p.id, p.height);
  }
  // 只有 position_status/status 都为 pending 的点位才延期（与 takeoff 同口径）。
  const isDeferred = (p: any): boolean => p !== undefined && p.position_status === 'pending' && p.status === 'pending';
  const counted = (route: MepRoute): { drawn: number; drop: number; fromStub: number; points: Array<{ x: number; z: number; y?: number }> } | null => {
    if (!covered.has(route.layer)) return null;
    const res = report.routes.find((item) => item.route.id === route.id);
    if (!res || res.unresolved.length > 0 || !res.metadata.physicalRoute) return null;
    if ([route.from, route.to].some((e) => typeof e === 'string' && isDeferred(elecById.get(e)))) return null;
    const drawn = length3d(res.points);
    let drop = 0;
    if (all.rules.include_terminal_drop && typeof route.to === 'string' && pointHeights.has(route.to)) {
      const lastY = res.points[res.points.length - 1]?.y;
      const h = pointHeights.get(route.to)!;
      if (lastY !== undefined && lastY > h) drop = lastY - h;
    }
    // 起点竖直 stub（terminalDrop 的镜像，量价算法审计 D3）：折线起点标高
    // 高于起点位安装高度时，位点到折线起点那段竖直管/线同样进层长与
    // terminalDropM（takeoff 侧 fromDrop）；只计 to 端会少算 13 条路由
    // 共 0.2962m（强电 3 条 0.15m）。
    let fromStub = 0;
    if (all.rules.include_terminal_drop && typeof route.from === 'string' && pointHeights.has(route.from)) {
      const firstY = res.points[0]?.y;
      const h = pointHeights.get(route.from)!;
      if (firstY !== undefined && firstY > h) fromStub = firstY - h;
    }
    return { drawn, drop, fromStub, points: res.points };
  };
  let strongSum = 0;
  let dropSum = 0;
  const drawnPaths: Array<Array<{ x: number; z: number }>> = [];
  const strongPaths: Array<Array<{ x: number; z: number }>> = [];
  let livingSum = 0;
  for (const route of all.coordination.routes) {
    const c = counted(route);
    if (!c) continue;
    if (route.layer === 'strong_power') {
      strongSum += c.drawn + c.drop + c.fromStub;
      strongPaths.push(c.points.map((p) => ({ x: p.x, z: p.z })));
    }
    dropSum += c.drop + c.fromStub;
    drawnPaths.push(c.points.map((p) => ({ x: p.x, z: p.z })));
    if (typeof route.to === 'string' && elecById.get(route.to)?.room === 'living_dining') livingSum += c.drawn;
  }
  const close = (a: number, b: number, what: string): void => {
    assert.ok(Math.abs(a - b) <= 1e-6, `${what}：takeoff ${a} vs 独立重算 ${b}`);
  };
  close(takeoff.conduit.strongPowerM, strongSum, '强电管长须等于各条已画线强电路由（三维长 + 终端下引）之和');
  close(takeoff.conduit.terminalDropM, dropSum, '终端下引总量须等于各条路由下引之和');
  close(takeoff.conduit.drawnRouteUnionM, unionPlanLength(drawnPaths), '画线并集总长须等于已画线路由平面路径的网格并集');
  close(takeoff.conduit.strongPowerUnionAllM, unionPlanLength(strongPaths), '强电画线并集须等于强电路由平面路径的网格并集');
  close(takeoff.coverage.byRoom.living_dining?.drawnRouteM ?? 0, livingSum, '客餐厅画线长须等于终点在客餐厅的路由三维长之和');

  // 3. 报价门与 blocker 清单同源：可报价当且仅当 blocker 为空；error 级不得存在。
  assert.equal(takeoff.feasibleForQuote, takeoff.blockers.length === 0, '可报价标志须与 blocker 清单同源');
  assert.ok(takeoff.blockers.every((b) => b.kind !== 'error'), `error 级 blocker 不得存在：${JSON.stringify(takeoff.blockers.filter((b) => b.kind === 'error'))}`);
  assert.ok(takeoff.unresolved.every((u) => u.kind !== 'error'), `error 级 unresolved 不得存在：${JSON.stringify(takeoff.unresolved.filter((u) => u.kind === 'error'))}`);
});

/** 合成反例用的最小 coordination（与 mep-slope-run.test.ts 同口径）。 */
const axisLayers = Object.fromEntries(
  ['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air']
    .map((id) => [id, { label: id, color: '#fff', height: 2.5 }]),
) as MepCoordination['layers'];
const emptySources: MepEndpointSources = { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };
const AXIS_TABLE = [{ id: 'corridor_axis', axis: 'z' as const, value: 4.6 }];
function axisRoute(id: string, via: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, layer: 'strong_power', status: 'inferred', source_status: 'proposed',
    construction_status: 'pending', method: 'conduit',
    diameter: 0.025,
    from_height: 2.55,
    from: { x: 10.8, z: 2.98 }, to: { x: 7.2, z: 4.3 }, via,
    ...extra,
  };
}
function axisConfig(routes: Array<Record<string, unknown>>, axes: unknown = AXIS_TABLE): MepCoordination {
  return MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers: axisLayers, routes, junctions: [], shafts: [], axes });
}
const AXIS_VIA = [
  { kind: 'axis_jog', axis: 'corridor_axis' },
  { kind: 'axis_run', axis: 'corridor_axis', to: 'to' },
];
const OUTDOOR_VIA = [
  { kind: 'axis_jog', axis: 'corridor_axis' },
  { kind: 'axis_run', axis: 'corridor_axis', to: 7.45 },
  { kind: 'axis_run', axis: 'z', to: 3.0 },
  { kind: 'level', y: 2.7 },
  { kind: 'axis_run', axis: 'z', to: 'to' },
  { kind: 'axis_run', axis: 'x', to: 'to' },
];

test('C4a：合成反例——断引用/越权字段/零行程/离轴/缺 y 一律 fail-closed（红/绿）', () => {
  const from = { x: 10.8, z: 2.98, y: 2.55 };
  const to = { x: 7.2, z: 4.3, y: 2.55 };
  const failClosed = (route: MepRoute, pattern: RegExp, axes: MepCoordination['axes'] = AXIS_TABLE) => {
    const red = resolveMepViaSteps(route, from, to, [], axes);
    assert.deepEqual(red.points, [], `${route.id} 反例不得出半条几何`);
    assert.match(red.diagnostic ?? '', pattern, `${route.id} 诊断须点名原因`);
  };
  // 断引用：未知轴线（schema 不查存在性，validate 与求解器入口双重拦）。
  const unknown = axisConfig([axisRoute('syn-unknown', AXIS_VIA)], [{ id: 'other_axis', axis: 'z', value: 4.6 }]);
  failClosed(unknown.routes[0], /引用未知轴线 "corridor_axis"/, unknown.axes);
  assert.throws(() => validateMepCoordination(unknown, emptySources), /引用未知轴线 "corridor_axis"/);
  const green = resolveMepRoutes(axisConfig([axisRoute('syn-ok', AXIS_VIA)]), emptySources);
  assert.equal(green.unresolved, 0, '对照组须解出');
  // 越权字段：axis_jog 声明 y / shaft（schema 拒绝 + 求解器入口拒绝）。
  assert.throws(() => axisConfig([axisRoute('syn-y', [{ kind: 'axis_jog', axis: 'corridor_axis', y: 2.55 }, AXIS_VIA[1]])]), /axis_jog 不得声明 y/);
  failClosed(axisRoute('syn-y', [{ kind: 'axis_jog', axis: 'corridor_axis', y: 2.55 }, AXIS_VIA[1]]) as MepRoute, /不得声明 y/);
  assert.throws(() => axisConfig([axisRoute('syn-shaft', [{ kind: 'axis_jog', axis: 'corridor_axis', shaft: 'shaft_entry' }, AXIS_VIA[1]])]), /axis_jog 不引用竖井/);
  failClosed(axisRoute('syn-shaft', [{ kind: 'axis_jog', axis: 'corridor_axis', shaft: 'shaft_entry' }, AXIS_VIA[1]]) as MepRoute, /不得声明 shaft/);
  // 离轴 axis_run（缺 axis_jog）：不静默沿错误线位跑。
  failClosed(axisRoute('syn-offaxis', [AXIS_VIA[1]]) as MepRoute, /不在轴线 "corridor_axis" 上/);
  // 零行程：axis_jog 已在轴上；axis_run 目标即当前点；axis_run 目标即当前点。
  const onAxis = resolveMepViaSteps(axisRoute('syn-zero-entry', AXIS_VIA) as MepRoute, { x: 10.8, z: 4.6, y: 2.55 }, to, [], AXIS_TABLE);
  assert.deepEqual(onAxis.points, []);
  assert.match(onAxis.diagnostic ?? '', /axis_jog 零行程/);
  failClosed(axisRoute('syn-zero-run', [{ kind: 'axis_jog', axis: 'corridor_axis' }, { kind: 'axis_run', axis: 'corridor_axis', to: 10.8 }]) as MepRoute, /axis_run 零行程/);
  failClosed(axisRoute('syn-zero-runto', [{ kind: 'axis_jog', axis: 'corridor_axis' }, { kind: 'axis_run', axis: 'corridor_axis', to: 7.2 }, { kind: 'axis_run', axis: 'z', to: 4.6 }]) as MepRoute, /axis_run 零行程/);
  // 缺 to 的 axis_run（schema 拒绝 + 求解器入口拒绝）。
  assert.throws(() => axisConfig([axisRoute('syn-noto', [AXIS_VIA[0], { kind: 'axis_run', axis: 'corridor_axis' }])]), /axis_run 必须声明 to/);
  failClosed(axisRoute('syn-noto', [AXIS_VIA[0], { kind: 'axis_run', axis: 'corridor_axis' }]) as MepRoute, /缺少 to/);
  // axis_run 缺 axis / 缺 to / 带 shaft（schema 拒绝）；axis_jog 的 axis 不得为方向
  // （统一协议后 axis 单字段重载：方向与轴线 id 不能同存一字段，旧“axis_run 带 axis_id”
  // 越权情形已无写法，本行改为 axis_jog 取方向的拒绝用例）。
  assert.throws(() => axisConfig([axisRoute('syn-noaxis', [{ kind: 'axis_run', to: 5.5 }])]), /axis_run 必须声明 axis/);
  assert.throws(() => axisConfig([axisRoute('syn-noto2', [{ kind: 'axis_run', axis: 'z' }])]), /axis_run 必须声明 to/);
  assert.throws(() => axisConfig([axisRoute('syn-rshaft', [{ kind: 'axis_run', axis: 'z', to: 5.5, shaft: 'shaft_entry' }])]), /axis_run 不引用竖井/);
  assert.throws(() => axisConfig([axisRoute('syn-jogdir', [{ kind: 'axis_jog', axis: 'z' }, AXIS_VIA[1]])]), /axis_jog 的 axis 须为轴线 id/);
  // 非轴线步声明轴线 id（schema 拒绝 + 求解器入口拒绝）：axis 为全步型共用可选字段，
  // 竖井步带 axis 会静默忽略——Codex major；竖井步以 shaft_run 为代表（四种共用
  // 同一 schema 分支与同一入口检查点）；slope_run 的 axis 须为方向，带轴线 id 同样拒绝。
  assert.throws(() => axisConfig([axisRoute('syn-shaftrun-axisid', [{ kind: 'shaft_run', shaft: 'shaft_entry', axis: 'corridor_axis' }])]), /shaft_run 不引用轴线表/);
  failClosed(axisRoute('syn-shaftrun-axisid', [{ kind: 'shaft_run', shaft: 'shaft_entry', axis: 'corridor_axis' }]) as MepRoute, /不引用轴线表/);
  assert.throws(() => axisConfig([axisRoute('syn-sloperun-axisid', [{ kind: 'slope_run', axis: 'corridor_axis', to: 5.0 }], { slope: 0.01 })]), /slope_run 的 axis 须为方向/);
  failClosed(axisRoute('syn-sloperun-axisid', [{ kind: 'slope_run', axis: 'corridor_axis', to: 5.0 }], { slope: 0.01 }) as MepRoute, /的 axis 须为方向/);
  // level 缺 y / 带 shaft / 零行程 / 非有限数 y（schema 拒绝 + 求解器入口拒绝）。
  assert.throws(() => axisConfig([axisRoute('syn-noy', [{ kind: 'level' }])]), /level 必须声明 y/);
  failClosed(axisRoute('syn-noy', [{ kind: 'level' }]) as MepRoute, /必须声明有限数 y/);
  assert.throws(() => axisConfig([axisRoute('syn-vshaft', [{ kind: 'level', y: 2.7, shaft: 'shaft_entry' }])]), /level 不引用竖井/);
  failClosed(axisRoute('syn-vzero', [{ kind: 'level', y: 2.55 }]) as MepRoute, /level 零行程/);
  failClosed(axisRoute('syn-vnan', [{ kind: 'level', y: Number.NaN }]) as MepRoute, /必须声明有限数 y/);
  // 缺 from_height：axis_jog 无起算标高。
  const noHeight = axisRoute('syn-noheight', AXIS_VIA, { from_height: undefined }) as MepRoute;
  delete (noHeight as Record<string, unknown>).from_height;
  const redHeight = resolveMepViaSteps(noHeight, { x: 10.8, z: 2.98 }, to, [], AXIS_TABLE);
  assert.deepEqual(redHeight.points, []);
  assert.match(redHeight.diagnostic ?? '', /缺少有效起算标高/);
  // 补回即恢复（红/绿）。
  const fixed = resolveMepRoutes(axisConfig([axisRoute('syn-ok2', AXIS_VIA)]), emptySources);
  assert.equal(fixed.unresolved, 0, '补回后须解出');
});

test('C4b：真实配置反例——axes 表缺失时 49 条轴路由 unresolved、其余 88 条照常解出', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  assert.deepEqual(before.report.diagnostics, [], '基线须无诊断');
  const broken = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  broken.axes = [];
  const after = resolveChain(all, all.furnishings, broken);
  const unresolvedIds = after.report.routes.filter((r) => r.unresolved.length > 0).map((r) => r.route.id).sort();
  assert.deepEqual(unresolvedIds, [...ALL_AXIS_IDS].sort(), '恰好 49 条轴路由 unresolved（强电 37 + 弱电 7 + 冷媒 5）');
  for (const id of ALL_AXIS_IDS) {
    const r = routeOf(after.report, id);
    assert.deepEqual(r.unresolved, ['via'], `${id} unresolved 须为 via`);
    assert.deepEqual(r.points, [], `${id} 不得出半条几何`);
    assert.ok(r.diagnostics.some((d) => d.includes('引用未知轴线')), `${id} 诊断须点名所引轴线`);
  }
  assert.equal(after.report.resolved, before.report.total - 49, '其余路由须照常解出');
  // lint：49 条各报一条 endpoint_unresolved error。
  const lint = lintMepCoordination(broken, before.sources);
  const endpointErrors = lint.errors.filter((e) => e.code === 'endpoint_unresolved');
  assert.equal(endpointErrors.length, 49, 'lint 须报 49 条 endpoint_unresolved');
  assert.deepEqual(endpointErrors.map((e) => e.routeId).sort(), [...ALL_AXIS_IDS].sort());
  assert.ok(endpointErrors.every((e) => e.message.includes('引用未知轴线')), 'lint 诊断须点名所引轴线');
  // takeoff：broken 的新 unresolved 恰好为 44 条（kind error）。
  const brokenUnresolved = after.takeoff.unresolved.filter((u) => u.kind === 'error').map((u) => u.id).sort();
  const healthyUnresolved = before.takeoff.unresolved.filter((u) => u.kind === 'error').map((u) => u.id).sort();
  assert.deepEqual(brokenUnresolved.filter((id) => !healthyUnresolved.includes(id)), [...TAKEOFF_AXIS_IDS].sort(), 'takeoff 新增 error unresolved 恰好为 44 条进算量轴路由（冷媒 5 条 excluded，不进算量）');
  // DXF：errors 点名 broken 路由且不含其几何；健康 DXF 无 errors 且含切片路由。
  // labels:'ascii'（utf8 模式写 route.label 中文名，id 只作 fallback；ascii 模式显式用 id）。
  const dxfInput = (coord: MepCoordination) => ({
    house: { rooms: [], furnishings: {}, electrical: [], ceilingZones: [], sceneElements: [] },
    mep: { coordination: coord, sources: before.sources },
    labels: 'ascii' as const,
  });
  const brokenDxf = buildProjectDxf(dxfInput(broken) as any);
  assert.equal(brokenDxf.errors.length, 49, 'DXF 须报 49 条路由错误');
  // 子串匹配会把 healthy 长 id（如 strong-power-living-sofa-l）误判为 broken 的
  // strong-power-living：须按 token 边界匹配（前后都不是 id 字符）。
  const dxfHasToken = (text: string, id: string): boolean => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(text);
  };
  for (const id of ALL_AXIS_IDS) {
    assert.ok(brokenDxf.errors.some((e) => e.includes(id)), `DXF 错误须点名 ${id}`);
    assert.ok(!dxfHasToken(brokenDxf.dxf, id), `DXF 不得含 broken 路由 ${id} 的几何`);
  }
  const healthyDxf = buildProjectDxf(dxfInput(all.coordination) as any);
  assert.deepEqual(healthyDxf.errors, [], '健康 DXF 须无 errors');
  for (const id of SLICE_IDS) assert.ok(healthyDxf.dxf.includes(id), `健康 DXF 须含 ${id}`);
});

test('C4c：真实配置反例——outdoor level 删 y 时整条 unresolved，schema 即拒绝', () => {
  const all = loadAll();
  const broken = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  const idx = broken.routes.findIndex((r) => r.id === 'strong-ac-outdoor');
  delete ((broken.routes[idx].via as any[])[3] as Record<string, unknown>).y;
  assert.throws(() => MepCoordinationSchema.parse(JSON.parse(JSON.stringify(broken))), /level 必须声明 y/);
  // 绕过 schema 直接解算：同样 fail-closed。
  const before = resolveChain(all, all.furnishings);
  const after = resolveChain(all, all.furnishings, broken as MepCoordination);
  const r = routeOf(after.report, 'strong-ac-outdoor');
  assert.deepEqual(r.unresolved, ['via']);
  assert.deepEqual(r.points, []);
  assert.ok(r.diagnostics.some((d) => d.includes('level') && d.includes('y')), '诊断须点名 level 缺 y');
  assert.deepEqual(slicePoints(after.report, 'strong-ac-living'), slicePoints(before.report, 'strong-ac-living'), 'living 不得受影响');
});
