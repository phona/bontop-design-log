import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml, dump as dumpYaml } from 'js-yaml';
import {
  MepCoordinationSchema,
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
  resolveMepViaSteps,
  validateMepCoordination,
  type MepCoordination,
  type MepEndpointSources,
  type MepRoute,
} from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination } from '../../shared/mep-hvac-lint.js';
import { computeMepTakeoff, type MepTakeoffRules, type TakeoffCircuit } from '../../shared/mep-takeoff.js';
import { buildProjectDxf } from '../../shared/dxf/project-dxf.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, ProjectRenderFacts, VertexLayoutYaml } from '../../shared/types.js';

/**
 * axis_run 关系步（issue #98 MEP batch 5，给水家族）：
 * 沿单轴平跑——目标 to 为该轴上的数值坐标，或字面 'to'（to 端点在该轴上的坐标）；
 * 高度取当前标高游标（首步即 route.from_height，平跑不改标高），不得声明步内 y、
 * 不引用竖井。给水全程平标高（y=0.18/0.35/0.8），slope_run 须正数坡度、竖井步
 * 只能沿竖井 x 跑，都表达不了“平着沿一轴走到某坐标”；本步是该批唯一新步型，
 * 与 from_face_jog / slope_run 同口径：步内 y 与竖井引用在 schema 与求解器入口
 * 双重 fail-closed。
 */

const layerNames = ['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'] as const;
const layers = Object.fromEntries(layerNames.map((id) => [id, { label: id, color: '#fff', height: 2.5 }])) as MepCoordination['layers'];
const emptySources: MepEndpointSources = { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };

function axisRoute(id: string, via: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, layer: 'water_supply', status: 'pending', source_status: 'plan_supported',
    construction_status: 'pending', method: 'floor_branch', diameter: 0.025,
    from_height: 0.18, from: { x: 0.5, z: 2.76 }, to: { x: 0.575, z: 2.96 }, via,
    ...extra,
  };
}

function axisConfig(routes: Array<Record<string, unknown>>): MepCoordination {
  return MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes, junctions: [] });
}

function assertPointsClose(
  actual: ReadonlyArray<{ x: number; y?: number; z: number }>,
  expected: ReadonlyArray<[number, number, number]>,
  where: string,
  tolerance = 1e-9,
): void {
  assert.equal(actual.length, expected.length, `${where}: point count ${actual.length} !== ${expected.length}`);
  for (let index = 0; index < expected.length; index += 1) {
    const [x, y, z] = expected[index];
    assert.ok(Math.abs(actual[index].x - x) <= tolerance, `${where}[${index}].x ${actual[index].x} !== ${x}`);
    assert.ok(Math.abs((actual[index].y ?? NaN) - y) <= tolerance, `${where}[${index}].y ${actual[index].y} !== ${y}`);
    assert.ok(Math.abs(actual[index].z - z) <= tolerance, `${where}[${index}].z ${actual[index].z} !== ${z}`);
  }
}

// ── 合成机制 ────────────────────────────────────────────────────────────────

test('axis_run 平跑：沿 z 再沿 x，标高全程取 from_height 不变', () => {
  const config = axisConfig([axisRoute('syn-flat', [
    { kind: 'axis_run', axis: 'z', to: 2.8 },
    { kind: 'axis_run', axis: 'x', to: 'to' },
  ], { to: { x: 2.6, z: 1.5 }, to_height: 0.8 })]);
  validateMepCoordination(config, emptySources);
  const report = resolveMepRoutes(config, emptySources);
  assert.equal(report.unresolved, 0);
  assertPointsClose(report.routes[0].points, [
    [0.5, 0.18, 2.76],
    [0.5, 0.18, 2.8],
    [2.6, 0.18, 2.8],
    [2.6, 0.8, 1.5],
  ], 'syn-flat');
});

test('axis_run to:\'to\' 跟随 to 端点：端点东移 0.40m，落点同移、其余点不动', () => {
  const via = [
    { kind: 'axis_run', axis: 'z', to: 2.8 },
    { kind: 'axis_run', axis: 'x', to: 'to' },
  ];
  const base = resolveMepRoutes(axisConfig([axisRoute('syn-to', via, { to: { x: 2.6, z: 1.5 }, to_height: 0.8 })]), emptySources);
  const moved = resolveMepRoutes(axisConfig([axisRoute('syn-to', via, { to: { x: 3.0, z: 1.5 }, to_height: 0.8 })]), emptySources);
  assertPointsClose(moved.routes[0].points, [
    [0.5, 0.18, 2.76],
    [0.5, 0.18, 2.8],
    [3.0, 0.18, 2.8],
    [3.0, 0.8, 1.5],
  ], 'syn-to moved');
  assert.deepEqual(moved.routes[0].points.slice(0, 2), base.routes[0].points.slice(0, 2));
});

test('axis_run 零行程失败：目标与游标同轴坐标重合，不给半条路径', () => {
  const config = axisConfig([axisRoute('syn-zero', [{ kind: 'axis_run', axis: 'z', to: 2.76 }])]);
  const entry = resolveMepRoutes(config, emptySources).routes[0];
  assert.deepEqual(entry.unresolved, ['via']);
  assert.deepEqual(entry.points, []);
  assert.match(entry.diagnostics.join('；'), /零行程/);
});

test('axis_run 缺 from_height 失败：首步无起算标高，显式诊断不静默回退', () => {
  const route = axisRoute('syn-noheight', [{ kind: 'axis_run', axis: 'x', to: 'to' }]);
  delete (route as Record<string, unknown>).from_height;
  const entry = resolveMepRoutes(axisConfig([route]), emptySources).routes[0];
  assert.deepEqual(entry.unresolved, ['via']);
  assert.deepEqual(entry.points, []);
  assert.match(entry.diagnostics.join('；'), /缺少有效起算标高/);
});

test('axis_run 步内 y 在 schema 与求解器双重 fail-closed', () => {
  const via = [{ kind: 'axis_run', axis: 'x', to: 'to', y: 0.35 }];
  assert.throws(() => axisConfig([axisRoute('syn-y', via)]), /axis_run 不得声明 y/);
  // 求解器入口（绕过 schema 的拼装路由）同样拒绝，不输出不完整几何。
  const cast = axisRoute('syn-y', via) as unknown as MepRoute;
  const solved = resolveMepViaSteps(cast, { x: 0.5, z: 2.76 }, { x: 0.575, z: 2.96 }, []);
  assert.deepEqual(solved.points, []);
  assert.match(solved.diagnostic ?? '', /axis_run 不得声明 y/);
});

test('axis_run 不引用竖井：schema 与求解器均拒绝 shaft 声明', () => {
  const via = [{ kind: 'axis_run', axis: 'x', to: 'to', shaft: 'shaft_entry' }];
  assert.throws(() => axisConfig([axisRoute('syn-shaft', via)]), /axis_run 不引用竖井/);
  const cast = axisRoute('syn-shaft', via) as unknown as MepRoute;
  const solved = resolveMepViaSteps(cast, { x: 0.5, z: 2.76 }, { x: 0.575, z: 2.96 }, []);
  assert.deepEqual(solved.points, []);
  // 集成 #243：求解器侧文案为统一协议口径「不得声明 shaft」（schema 侧仍为「不引用竖井」）。
  assert.match(solved.diagnostic ?? '', /axis_run 不得声明 shaft/);
});

test('axis_run 缺 axis/to 在 schema 拒绝', () => {
  assert.throws(() => axisConfig([axisRoute('syn-noaxis', [{ kind: 'axis_run', to: 'to' }])]), /必须声明 axis/);
  assert.throws(() => axisConfig([axisRoute('syn-noto', [{ kind: 'axis_run', axis: 'x' }])]), /必须声明 to/);
});

test('混合 via：带 y 绝对步推进游标、无 y 绝对步清游标致后继 axis_run 失败', () => {
  const withY = resolveMepRoutes(axisConfig([axisRoute('syn-mix-y', [
    { x: 1.0, z: 1.0, y: 0.35 },
    { kind: 'axis_run', axis: 'x', to: 2.0 },
  ], { to_height: 0.8 })]), emptySources).routes[0];
  assert.deepEqual(withY.unresolved, []);
  assertPointsClose(withY.points, [
    [0.5, 0.18, 2.76],
    [1.0, 0.35, 1.0],
    [2.0, 0.35, 1.0],
    [0.575, 0.8, 2.96],
  ], 'syn-mix-y');
  // 无 y 的绝对步没有真实高度可继承——清游标后继 axis_run 以「缺少有效起算标高」
  // 显式失败（与 slope_run 同口径，PR #233 二审 blocking 的教训：沿用旧游标会
  // 与层高回退形成虚构上坡/平跑）。
  const noY = resolveMepRoutes(axisConfig([axisRoute('syn-mix-noy', [
    { x: 1.0, z: 1.0 },
    { kind: 'axis_run', axis: 'x', to: 2.0 },
  ], { to_height: 0.8 })]), emptySources).routes[0];
  assert.deepEqual(noY.unresolved, ['via']);
  assert.deepEqual(noY.points, []);
  assert.match(noY.diagnostics.join('；'), /缺少有效起算标高/);
});

test('axis_run 不参与竖井存在性校验：无 shafts 表的配置可解析可解算', () => {
  const config = axisConfig([axisRoute('syn-noshaft', [{ kind: 'axis_run', axis: 'x', to: 'to' }])]);
  assert.deepEqual(config.shafts, []);
  validateMepCoordination(config, emptySources);
  assert.equal(resolveMepRoutes(config, emptySources).unresolved, 0);
});

// ── 真实配置：C1 等价、传动实验、C3 对账、C4 反例 ────────────────────────────

const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ProjectRenderFacts['electrical'];
const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as ProjectRenderFacts['plumbing'];
const ceiling = parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'];
const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
const project = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
const realLayout = resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);
const { mountHosts: realMountHosts } = buildPlacementIndexes({
  geometry: { walls: realLayout.walls },
  furnishings: (parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: FurnishingsYaml }).furnishings ?? {},
});
const pointWalls = pointWallIndexFromElements(realLayout.walls);
const realSources = endpointSourcesFromFacts({ electrical, plumbing, ceiling, hvac }, pointWalls, realMountHosts);

const WATER_IDS = [
  'water-master-bath', 'water-guest-bath', 'water-balcony', 'water-kitchen-requirement',
  'water-garden-requirement', 'water-water-heater-inlet-requirement', 'water-hot-water-mbath-requirement',
  'water-hot-water-gbath-requirement', 'water-water-heater-recirc-requirement', 'water-kitchen-dishwasher-branch',
  'water-v1-heater-to-mbath-hot', 'water-v1-entry-to-mbath-cold', 'water-v1-heater-to-gbath-hot',
  'water-v1-entry-to-gbath-cold', 'water-purifier-branch', 'water-v1-recirc-loop', 'water-entry-valve-requirement',
];
// 迁移 14 条（via 关系化）；留绝对 3 条：garden（内联端点 + 爬升标高的候选路由，
// 无锚点可跟随、无声明坡度，不迁）、dishwasher-branch 与 purifier-branch（无 via）。
const LEFT_ABSOLUTE_IDS = ['water-garden-requirement', 'water-kitchen-dishwasher-branch', 'water-purifier-branch'];

/**
 * C1：给水路由持续不变式（PR #253：逐点基线表转规则断言，口径同 PR #251
 * 的 mep-air-ducts / mep-drainage）：
 * - 起点 = from + from_height；末点 = to + to_height；
 * - 每点标高 ∈ {from_height, to_height} ∪ {绝对步声明的 y}（给水平跑，
 *   不声明坡度、不走竖井）；
 * - 点数 = from + 每步一落点 + 末点（via 为空的支管为 2 点）；
 * - axis_run 步的对应腿只沿该步声明的轴走；绝对步与末点 riser 不在此限——
 *   guest-bath 首步保留的绝对落点是斜向 jog，hot-water-gbath 的末点 riser
 *   平面位移随 to 端点走（dx 0.09 / dz 1.505），两者都不正交，不是缺陷，
 *   是保留的绝对表达；
 * - 无往返折返、无连续重复点、每个 x/z 来自声明（端点/数值 to/绝对步/轴线表）。
 * 逐点等价证明（merge-base 211831e8，PR #233）在 PR 记录与 git 历史里，
 * 不在套件里。C2 传播实验的 moved 逐点期望与 C3/C4 保持原样。
 */
const TOL = 1e-9;

function dedup(points: ReadonlyArray<{ x: number; y?: number; z: number }>): Array<{ x: number; y?: number; z: number }> {
  return points.filter((point, index) => index === 0
    || point.x !== points[index - 1].x || point.y !== points[index - 1].y || point.z !== points[index - 1].z);
}

function assertNoRetrace(points: ReadonlyArray<{ x: number; y?: number; z: number }>, what: string): void {
  const seen = new Set<string>();
  for (let i = 1; i < points.length; i += 1) {
    const key = `${points[i - 1].x},${points[i - 1].y ?? 0},${points[i - 1].z}|${points[i].x},${points[i].y ?? 0},${points[i].z}`;
    assert.ok(!seen.has(key), `${what} 第 ${i} 段不得与更早的段重合（往返折返）`);
    seen.add(key);
  }
}

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

/**
 * 本路由每个 x/z 须来自声明：本路由 from/to 端点（已解出）、本路由任一步的数值 to
 * 或绝对步坐标、轴线表。'to' 目标取 to 端点值，已由 entry.to 覆盖。
 */
function assertNoInventedCoords(
  points: ReadonlyArray<{ x: number; y?: number; z: number }>,
  entry: ReturnType<typeof resolveMepRoutes>['routes'][number],
  coordination: MepCoordination,
  what: string,
): void {
  const axes = coordination.axes ?? [];
  const allowedX = new Set<number>();
  const allowedZ = new Set<number>();
  if (entry.from) { allowedX.add(entry.from.x); allowedZ.add(entry.from.z); }
  if (entry.to) { allowedX.add(entry.to.x); allowedZ.add(entry.to.z); }
  for (const step of entry.route.via) {
    if ('to' in step && typeof step.to === 'number') {
      if (step.axis === 'x') allowedX.add(step.to);
      if (step.axis === 'z') allowedZ.add(step.to);
    }
    if ('x' in step && typeof step.x === 'number') allowedX.add(step.x);
    if ('z' in step && typeof step.z === 'number') allowedZ.add(step.z);
  }
  for (const axis of axes) {
    if (axis.axis === 'x') allowedX.add(axis.value);
    if (axis.axis === 'z') allowedZ.add(axis.value);
  }
  for (const point of points) {
    assert.ok(allowedX.has(point.x), `${what} x=${point.x} 不在任何声明值里（端点/轴线/数值 to）`);
    assert.ok(allowedZ.has(point.z), `${what} z=${point.z} 不在任何声明值里（端点/轴线/数值 to）`);
  }
}

function assertWaterRouteInvariants(
  entry: ReturnType<typeof resolveMepRoutes>['routes'][number],
  coordination: MepCoordination,
  what: string,
): void {
  const route = entry.route;
  const pts = entry.points;
  assert.deepEqual(entry.unresolved, [], `${what} 须解出`);
  assert.deepEqual(entry.diagnostics, [], `${what} 须无诊断`);
  assert.ok(pts.length >= 2, `${what} 至少须有起点与末点`);
  assert.ok(Math.abs(pts[0].x - entry.from!.x) <= TOL && Math.abs(pts[0].y! - route.from_height!) <= TOL && Math.abs(pts[0].z - entry.from!.z) <= TOL,
    `${what} 起点须为 from + from_height`);
  const terminal = pts[pts.length - 1];
  assert.ok(Math.abs(terminal.x - entry.to!.x) <= TOL && Math.abs(terminal.y! - route.to_height!) <= TOL && Math.abs(terminal.z - entry.to!.z) <= TOL,
    `${what} 末点须为 to + to_height`);
  assert.equal(pts.length, route.via.length + 2, `${what} 点数须为 from + 每步一落点 + 末点`);
  const allowedY = new Set<number>([route.from_height!, route.to_height!]);
  for (const step of route.via) {
    if ('y' in step && typeof step.y === 'number') allowedY.add(step.y);
  }
  for (let i = 0; i < pts.length; i += 1) {
    assert.ok([...allowedY].some((y) => Math.abs(pts[i].y! - y) <= TOL),
      `${what} 第 ${i + 1} 点标高 ${pts[i].y} 不在任何声明标高里`);
  }
  // axis_run 步的对应腿只沿该步声明的轴走；绝对步与末点 riser 不在此限（见本段头注）。
  for (let i = 0; i < route.via.length; i += 1) {
    const step = route.via[i];
    if (!('kind' in step) || step.kind !== 'axis_run') continue;
    const prev = pts[i];
    const landing = pts[i + 1];
    if (step.axis === 'x') {
      assert.ok(Math.abs(landing.z - prev.z) <= TOL, `${what} 第 ${i + 1} 步 axis_run x 不得改 z`);
    } else if (step.axis === 'z') {
      assert.ok(Math.abs(landing.x - prev.x) <= TOL, `${what} 第 ${i + 1} 步 axis_run z 不得改 x`);
    }
  }
  assertNoRetrace(pts, what);
  assertNoDuplicates(pts, what);
  assertNoInventedCoords(pts, entry, coordination, what);
}

function waterPoints(report: ReturnType<typeof resolveMepRoutes>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of WATER_IDS) out[id] = JSON.stringify(report.routes.find((item) => item.route.id === id)!.points);
  return out;
}

/** 按稳定对象 id 结构化改 plumbing 点位字段（js-yaml 解析/改字段/写回），不做 YAML 文本匹配。 */
function movePlumbingPoint(id: string, mutate: (entry: Record<string, unknown>) => void): ProjectRenderFacts['plumbing'] {
  const list = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as Array<Record<string, unknown>>;
  const entry = list.find((item) => item.id === id);
  assert.ok(entry, `plumbing point ${id} must exist`);
  mutate(entry);
  return parseYaml(dumpYaml(list)) as ProjectRenderFacts['plumbing'];
}

test('C1：17 条给水路由满足持续不变式（端点/标高/点数/轴腿/无折返/无编造坐标）', () => {
  const report = resolveMepRoutes(project, realSources);
  assert.equal(report.unresolved, 0, `unresolved routes: ${JSON.stringify(report.diagnostics)}`);
  for (const id of WATER_IDS) {
    const entry = report.routes.find((item) => item.route.id === id)!;
    assertWaterRouteInvariants(entry, project, id);
  }
  // 迁移后 via 形式：14 条全关系步（含 guest-bath 首步保留的 1 个绝对落点），3 条留绝对。
  for (const id of WATER_IDS.filter((item) => !LEFT_ABSOLUTE_IDS.includes(item))) {
    const route = project.routes.find((item) => item.id === id)!;
    assert.ok(route.via.some((step) => !('x' in step)), `${id} must have relational steps`);
  }
  for (const id of LEFT_ABSOLUTE_IDS) {
    const route = project.routes.find((item) => item.id === id)!;
    assert.ok(route.via.every((step) => 'x' in step), `${id} must stay absolute`);
  }
});

test('传播实验：热水器锚点东移 0.20m，五条热侧路由跟随、其余 12 条逐字节不动；复原则恢复', () => {
  const baseline = waterPoints(resolveMepRoutes(project, realSources));
  const movedPlumbing = movePlumbingPoint('water_heater', (entry) => { entry.x = 7.5; });
  const movedSources = endpointSourcesFromFacts({ electrical, plumbing: movedPlumbing, ceiling, hvac }, pointWalls, realMountHosts);
  const moved = waterPoints(resolveMepRoutes(project, movedSources));
  const followers = ['water-balcony', 'water-v1-heater-to-mbath-hot', 'water-v1-heater-to-gbath-hot', 'water-v1-recirc-loop', 'water-water-heater-inlet-requirement'];
  for (const id of WATER_IDS.filter((item) => !followers.includes(item))) {
    assert.equal(moved[id], baseline[id], `${id} must not move when water_heater moves`);
  }
  const movedPoints = (id: string) => JSON.parse(moved[id]) as Array<{ x: number; y?: number; z: number }>;
  // balcony：起点与首落点随 heater 东移，x=6.0 以东全不动。
  assertPointsClose(movedPoints('water-balcony'), [[7.5, 0.8, 1], [7.5, 0.8, 1.02], [6, 0.8, 1.02], [6, 0.8, 1.5], [5.6, 0.8, 1.5]], 'balcony moved', 1e-9);
  // 两条热干管：起点与 axis_run 落点随 heater 东移，终点（花洒）不动。
  // D4 起末段为 0.82m 纯竖直立管：终点在花洒高 1.00m（平面位同 [2]）。
  assertPointsClose(movedPoints('water-v1-heater-to-mbath-hot'), [[7.5, 0.18, 1], [7.5, 0.18, 2.76], [0.5, 0.18, 2.76], [0.5, 1, 2.76]], 'v1-heater-mbath moved', 1e-9);
  assertPointsClose(movedPoints('water-v1-heater-to-gbath-hot'), [[7.5, 0.18, 1], [7.5, 0.18, 2.45], [7.2, 0.18, 2.4499999999999997], [7.2, 1, 2.4499999999999997]], 'v1-heater-gbath moved', 1e-9);
  // 回水环：axis_run 落点 (0.5,1.0) 不动（to.z 未变），只有终点随 heater 东移。
  assertPointsClose(movedPoints('water-v1-recirc-loop'), [[0.5, 0.35, 2.76], [0.5, 0.35, 1], [7.5, 0.35, 1]], 'v1-recirc-loop moved', 1e-9);
  // 进水需求：axis_run 沿 z 跑、落点 x 取 from.x=7.35 不动，只有终点（热水器）东移。
  assertPointsClose(movedPoints('water-water-heater-inlet-requirement'), [[7.35, 0.18, 0.45], [7.35, 0.18, 1], [7.5, 0.18, 1]], 'heater-inlet moved', 1e-9);
  const restored = waterPoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('传播实验：主卫花洒沿墙东移 0.20m，五条主卫路由起/终点跟随、其余 12 条不动；复原则恢复', () => {
  const baseline = waterPoints(resolveMepRoutes(project, realSources));
  const movedPlumbing = movePlumbingPoint('shower_mbath', (entry) => { entry.along = 0.7; });
  // 冷水进口是同一混水阀的另一进水口（沿 0.35，与热水口间距 150mm），花洒整体东移时同移 0.20m。
  const coldInlet = (movedPlumbing as unknown as Array<Record<string, unknown>>).find((item) => item.id === 'shower_mbath_cold_inlet');
  assert.ok(coldInlet, 'shower_mbath_cold_inlet 必须存在');
  coldInlet.along = 0.55;
  const movedSources = endpointSourcesFromFacts({ electrical, plumbing: movedPlumbing, ceiling, hvac }, pointWalls, realMountHosts);
  const moved = waterPoints(resolveMepRoutes(project, movedSources));
  const followers = ['water-hot-water-mbath-requirement', 'water-water-heater-recirc-requirement', 'water-v1-recirc-loop', 'water-v1-heater-to-mbath-hot', 'water-v1-entry-to-mbath-cold'];
  for (const id of WATER_IDS.filter((item) => !followers.includes(item))) {
    assert.equal(moved[id], baseline[id], `${id} must not move when shower_mbath moves`);
  }
  const movedPoints = (id: string) => JSON.parse(moved[id]) as Array<{ x: number; y?: number; z: number }>;
  // 花洒作 from 的三条：起点东移；落点取 to 坐标的不动，只有 recirc-loop 的落点
  // (0.5,1.0)→(0.7,1.0) 随 from.x 走（axis_run 由游标出发）。
  assert.ok(Math.abs(movedPoints('water-hot-water-mbath-requirement')[0].x - 0.7) <= 1e-9, 'hot-water-mbath from must follow');
  assert.ok(Math.abs(movedPoints('water-water-heater-recirc-requirement')[0].x - 0.7) <= 1e-9, 'recirc-requirement from must follow');
  assertPointsClose(movedPoints('water-v1-recirc-loop'), [[0.7, 0.35, 2.76], [0.7, 0.35, 1], [7.3, 0.35, 1]], 'v1-recirc-loop moved', 1e-9);
  // 花洒作 to 的两条：终点东移，axis_run 落点（取 to.z）不动。
  // D4 起热干管终点为第 4 点（[2] 为 via-x 中间点，花洒平面位；[3] 为立管顶端）。
  assert.ok(Math.abs(movedPoints('water-v1-heater-to-mbath-hot')[3].x - 0.7) <= 1e-9, 'v1-heater-mbath to must follow');
  // 冷干管终点为第 5 点：冷进口随花洒同移 0.20m（沿 0.35→0.55），[2] 为 bypass 腿西端、
  // [3] 为 bypass 腿顶端、[4] 为立管终点，三者 x 均为冷进口沿位。
  assert.ok(Math.abs(movedPoints('water-v1-entry-to-mbath-cold')[3].x - 0.55) <= 1e-9, 'v1-entry-mbath bypass top must follow cold inlet');
  assert.ok(Math.abs(movedPoints('water-v1-entry-to-mbath-cold')[4].x - 0.55) <= 1e-9, 'v1-entry-mbath to must follow cold inlet');
  const restored = waterPoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C3：DXF 导出 17 条给水路由全在、算量无新增阻塞', () => {
  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const dxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(dxf.errors, []);
  for (const id of WATER_IDS) assert.ok(dxf.dxf.includes(id), `DXF must export ${id}`);
  const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules;
  const topology = parseYaml(readFileSync('config/electrical-topology.yaml', 'utf8')) as {
    circuits: TakeoffCircuit[];
    controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
  };
  const takeoff = computeMepTakeoff({
    electrical: electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
    circuits: topology.circuits,
    controls: topology.controls ?? [],
    routes: project.routes,
    resolution: resolveMepRoutes(project, realSources),
    rules,
  });
  assert.deepEqual(takeoff.unresolved.map((item) => item.id), ['trunk_strong_main']);
  assert.ok(takeoff.conduit.waterSupplyM > 0, 'water supply takeoff must be positive');
});

test('C4：主卧给水 from_height 缺失 → lint 报 endpoint_unresolved、DXF 拒导且不导出该路线', () => {
  const corrupted = structuredClone(project);
  const master = corrupted.routes.find((route) => route.id === 'water-master-bath')!;
  delete (master as Record<string, unknown>).from_height;
  const entry = resolveMepRoutes(corrupted, realSources).routes.find((item) => item.route.id === 'water-master-bath')!;
  assert.deepEqual(entry.unresolved, ['via']);
  assert.deepEqual(entry.points, []);
  assert.match(entry.diagnostics.join('；'), /缺少有效起算标高/);

  const lintResult = lintMepCoordination(corrupted, realSources);
  const masterErrors = lintResult.errors.filter((issue) => issue.routeId === 'water-master-bath');
  assert.ok(masterErrors.some((issue) => issue.code === 'endpoint_unresolved' && issue.message.includes('缺少有效起算标高')),
    `expected an endpoint_unresolved error for water-master-bath, got ${JSON.stringify(masterErrors.map((issue) => issue.code))}`);

  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const healthyDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(healthyDxf.errors, []);
  assert.ok(healthyDxf.dxf.includes('water-master-bath'), 'healthy DXF must export water-master-bath');
  const corruptedDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: corrupted, sources: realSources }, labels: 'ascii' });
  assert.ok(corruptedDxf.errors.some((error) => error.includes('water-master-bath')),
    `corrupted DXF must name the broken route, got ${JSON.stringify(corruptedDxf.errors)}`);
  assert.equal(corruptedDxf.dxf.includes('water-master-bath'), false, 'corrupted DXF must not export the broken route');
});
