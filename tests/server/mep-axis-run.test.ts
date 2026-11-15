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
  assert.match(solved.diagnostic ?? '', /axis_run 不引用竖井/);
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
 * C1 基线：merge-base（211831e8，PR #233 已合）上 17 条给水路由的已解算点，
 * 由统一出口实跑导出（逐点数值，非手写）。迁移只改几何表达——本表钉死“几何
 * 不得漂移”，容差 0.005m。日后合法改线须同步更新本表并说明理由（与 PR #231
 * C1 同口径：钉的是合并基线几何，不是历史配置值）。
 */
const BASELINE_POINTS: Record<string, Array<[number, number, number]>> = {
  'water-master-bath': [[0.575, 0.18, 2.96], [0.575, 0.18, 2.8], [2.6, 0.18, 2.8], [2.6, 0.8, 1.5000000000000002]],
  'water-guest-bath': [[7.140000000000001, 0.18, 3.955], [7.2, 0.18, 3.9], [7.2, 0.18, 3.55], [6.7, 0.18, 3.55], [6.7, 0.18, 3.2], [7.2, 0.18, 3.2], [7.2, 0.18, 3.05], [7.2, 0.8, 3.05]],
  'water-balcony': [[7.3, 0.8, 1], [7.3, 0.8, 1.02], [6, 0.8, 1.02], [6, 0.8, 1.5], [5.6, 0.8, 1.5]],
  'water-kitchen-requirement': [[7.35, 0.18, 0.45], [8.6, 0.18, 0.45], [9.5, 0.18, 0.45], [9.5, 0.8, 0.3]],
  'water-garden-requirement': [[10.5, 0.5, 0.5], [10.5, 0.7, 1.42], [10.85, 0.72, 1.42], [10.85, 0.8, 1.5]],
  'water-water-heater-inlet-requirement': [[7.35, 0.18, 0.45], [7.35, 0.18, 1], [7.3, 0.18, 1]],
  'water-hot-water-mbath-requirement': [[0.5, 0.18, 2.76], [0.575, 0.18, 2.76], [0.575, 0.8, 2.96]],
  'water-hot-water-gbath-requirement': [[7.2, 0.18, 2.4499999999999997], [7.05, 0.18, 2.45], [7.140000000000001, 0.8, 3.955]],
  'water-water-heater-recirc-requirement': [[0.5, 0.35, 2.76], [0.4, 0.35, 2.76], [0.4, 0.35, 2.6]],
  'water-kitchen-dishwasher-branch': [[9.5, 0.3, 0.3], [8.8, 0.3, 0.3]],
  'water-v1-heater-to-mbath-hot': [[7.3, 0.18, 1], [7.3, 0.18, 2.76], [0.5, 0.18, 2.76]],
  'water-v1-entry-to-mbath-cold': [[7.35, 0.18, 0.45], [7.35, 0.18, 2.76], [0.5, 0.18, 2.76]],
  'water-v1-heater-to-gbath-hot': [[7.3, 0.18, 1], [7.3, 0.18, 2.45], [7.2, 0.18, 2.4499999999999997]],
  'water-v1-entry-to-gbath-cold': [[7.35, 0.18, 0.45], [7.35, 0.18, 2.45], [7.2, 0.18, 2.4499999999999997]],
  'water-purifier-branch': [[9.5, 0.8, 0.3], [9.5, 0.3, 0.3]],
  'water-v1-recirc-loop': [[0.5, 0.35, 2.76], [0.5, 0.35, 1], [7.3, 0.35, 1]],
  'water-entry-valve-requirement': [[9.5, 0.18, 0.3], [7.35, 0.18, 0.3], [7.35, 0.18, 0.45]],
};

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

test('C1：17 条给水路由逐点等价 merge-base（容差 0.005m），点数与诊断全同', () => {
  const report = resolveMepRoutes(project, realSources);
  assert.equal(report.unresolved, 0, `unresolved routes: ${JSON.stringify(report.diagnostics)}`);
  for (const id of WATER_IDS) {
    const entry = report.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, [], `${id} must resolve`);
    assert.deepEqual(entry.diagnostics, [], `${id} must have no diagnostics`);
    assertPointsClose(entry.points, BASELINE_POINTS[id], id, 0.005);
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
  assertPointsClose(movedPoints('water-v1-heater-to-mbath-hot'), [[7.5, 0.18, 1], [7.5, 0.18, 2.76], [0.5, 0.18, 2.76]], 'v1-heater-mbath moved', 1e-9);
  assertPointsClose(movedPoints('water-v1-heater-to-gbath-hot'), [[7.5, 0.18, 1], [7.5, 0.18, 2.45], [7.2, 0.18, 2.4499999999999997]], 'v1-heater-gbath moved', 1e-9);
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
  assert.ok(Math.abs(movedPoints('water-v1-heater-to-mbath-hot')[2].x - 0.7) <= 1e-9, 'v1-heater-mbath to must follow');
  assert.ok(Math.abs(movedPoints('water-v1-entry-to-mbath-cold')[2].x - 0.7) <= 1e-9, 'v1-entry-mbath to must follow');
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
