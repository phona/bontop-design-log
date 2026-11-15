import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  MepCoordinationSchema,
  MepRouteSchema,
  MepViaStepSchema,
  endpointSourcesFromFacts,
  isMepViaCoordinate,
  mepRoutePoints,
  parseMepCoordination,
  resolveMepRoutes,
  resolveMepViaSteps,
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
 * axis_corner 关系步 + route.via_height 单点声明（issue #98 MEP batch 7，风管家族）：
 * 送/回风 via y 是手写中间值（送风 2.66、回风 2.70、bottom 2.62），无可声明的派生规则
 * （from_height − 固定落差 / to_height + 固定值均不成立），故不套 from_face_jog
 * （取 from_height 会改几何）也不套 slope_run；平面每轴独立取 from / to / 数值字面，
 * 高度只取 route.via_height 单点声明，缺失/越权一律 fail-closed。
 * 8 条已迁、6 条留绝对（理由见各路由 reason 与下方 C1 测试）；验收六层见本文件 C1–C4。
 */

const layerNames = ['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'] as const;
const layers = Object.fromEntries(layerNames.map((id) => [id, { label: id, color: '#fff', height: 2.5 }])) as MepCoordination['layers'];
const emptySources: MepEndpointSources = { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };

function airRoute(id: string, via: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, layer: 'supply_air', status: 'inferred', source_status: 'preliminary',
    construction_status: 'pending', method: 'rectangular',
    width: 0.25, depth: 0.18, height: 0.20,
    from_height: 2.68, to_height: 2.65, via_height: 2.66,
    from: { x: 10.3, z: 4.75 }, to: { x: 11.45, z: 5.56 }, via,
    ...extra,
  };
}

function airConfig(routes: Array<Record<string, unknown>>): MepCoordination {
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

function planLength(points: ReadonlyArray<{ x: number; z: number }>): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  return total;
}

function length3d(points: ReadonlyArray<{ x: number; y?: number; z: number }>): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    total += Math.sqrt((points[i + 1].x - points[i].x) ** 2 + ((points[i + 1].y ?? 0) - (points[i].y ?? 0)) ** 2 + (points[i + 1].z - points[i].z) ** 2);
  }
  return total;
}

// ── 合成：机制 ──────────────────────────────────────────────────────────────

test('axis_corner 两轴各取 from/to/数值，落点逐位等于绝对旧点', () => {
  const config = airConfig([airRoute('syn-supply-living', [
    { kind: 'axis_corner', x: 'from', z: 5.35 },
    { kind: 'axis_corner', x: 'to', z: 5.35 },
  ])]);
  const entry = resolveMepRoutes(config, emptySources).routes[0];
  assert.deepEqual(entry.unresolved, []);
  assertPointsClose(entry.points, [
    [10.3, 2.68, 4.75],
    [10.3, 2.66, 5.35],
    [11.45, 2.66, 5.35],
    [11.45, 2.65, 5.56],
  ], 'syn-supply-living');
});

test('axis_corner 机端/终端竖降步（x/z 双 from 或双 to）', () => {
  const config = airConfig([airRoute('syn-return-living', [
    { kind: 'axis_corner', x: 'from', z: 'from' },
    { kind: 'axis_corner', x: 'to', z: 'to' },
  ], { layer: 'return_air', from_height: 2.72, to_height: 2.49, via_height: 2.70 })]);
  const entry = resolveMepRoutes(config, emptySources).routes[0];
  assert.deepEqual(entry.unresolved, []);
  assertPointsClose(entry.points, [
    [10.3, 2.72, 4.75],
    [10.3, 2.70, 4.75],
    [11.45, 2.70, 5.56],
    [11.45, 2.49, 5.56],
  ], 'syn-return-living');
});

test('via_height 单点传播：改一处 via_height，全部 via 点同动、端点不动', () => {
  const base = airConfig([airRoute('syn-supply-living', [
    { kind: 'axis_corner', x: 'from', z: 5.35 },
    { kind: 'axis_corner', x: 'to', z: 5.35 },
  ])]);
  const moved = structuredClone(base);
  (moved.routes[0] as Record<string, unknown>).via_height = 2.60;
  const entry = resolveMepRoutes(MepCoordinationSchema.parse(moved), emptySources).routes[0];
  assert.deepEqual(entry.unresolved, []);
  assertPointsClose(entry.points, [
    [10.3, 2.68, 4.75],
    [10.3, 2.60, 5.35],
    [11.45, 2.60, 5.35],
    [11.45, 2.65, 5.56],
  ], 'syn-via-height-2.60');
});

test('axis_corner→slope_run 游标交接：后续坡度跑从 via_height 起算', () => {
  // 游标高度 = via_height 2.66（不是 from_height 2.68）：z 向跑 0.21m、1% 坡，
  // 终端 y = 2.66 − 0.01×0.21 = 2.6579；to_height 缺省时终端标高由末步落点派生。
  const config = airConfig([airRoute('syn-mixed', [
    { kind: 'axis_corner', x: 'to', z: 5.35 },
    { kind: 'slope_run', axis: 'z', to: 'to' },
  ], { slope: 0.01, to_height: undefined })]);
  const entry = resolveMepRoutes(config, emptySources).routes[0];
  assert.deepEqual(entry.unresolved, []);
  assertPointsClose(entry.points, [
    [10.3, 2.68, 4.75],
    [11.45, 2.66, 5.35],
    [11.45, 2.6579, 5.56],
    [11.45, 2.6579, 5.56],
  ], 'syn-mixed', 1e-9);
});

test('回归：全数值 axis_corner 步不是绝对坐标——须走关系分支取 via_height，兼容壳须拒绝', () => {
  // isMepViaCoordinate 只看 x/z 数值时会把 {kind:'axis_corner', x:10.3, z:5.35}
  // 误判为绝对步：求解器透传无 y 点、兼容壳静默接受。带 kind 的步一律是关系步。
  const route = airRoute('syn-numeric', [
    { kind: 'axis_corner', x: 10.3, z: 5.35 },
    { kind: 'axis_corner', x: 'to', z: 5.35 },
  ]);
  const config = airConfig([route]);
  const entry = resolveMepRoutes(config, emptySources).routes[0];
  assert.deepEqual(entry.unresolved, []);
  assert.equal(entry.viaPoints[0].y, 2.66, '数值 axis_corner 步必须带 via_height 高度，不是无 y 绝对点');
  assert.equal(entry.viaPoints[0].x, 10.3);
  assert.throws(
    () => mepRoutePoints(config.routes[0], { x: 10.3, z: 4.75 }, { x: 11.45, z: 5.56 }),
    /含关系型 via 步，须走 resolveMepRoutes/,
  );
});

// ── 合成：反例（fail-closed） ───────────────────────────────────────────────

test('反例：缺 via_height → schema 拒绝且求解器入口拒绝，不出半条几何（红/绿）', () => {
  const withoutHeight = airRoute('syn-supply-living', [
    { kind: 'axis_corner', x: 'from', z: 5.35 },
    { kind: 'axis_corner', x: 'to', z: 5.35 },
  ]);
  delete withoutHeight.via_height;
  assert.throws(() => MepRouteSchema.parse(withoutHeight), /MEP route syn-supply-living 含 axis_corner 步，必须声明 via_height/);
  const parsed = MepRouteSchema.parse(airRoute('syn-supply-living', [
    { kind: 'axis_corner', x: 'from', z: 5.35 },
    { kind: 'axis_corner', x: 'to', z: 5.35 },
  ]));
  delete (parsed as Record<string, unknown>).via_height;
  const via = resolveMepViaSteps(parsed, { x: 10.3, z: 4.75 }, { x: 11.45, z: 5.56 }, []);
  assert.deepEqual(via.points, []);
  assert.match(via.diagnostic ?? '', /缺少有效 via_height/);
});

test('反例：axis_corner 声明步内 y → schema 拒绝且求解器入口拒绝，不出半条几何（红/绿）', () => {
  assert.throws(
    () => MepViaStepSchema.parse({ kind: 'axis_corner', x: 'from', z: 5.35, y: 2.66 }),
    /axis_corner 不得声明 y/,
  );
  const parsed = MepRouteSchema.parse(airRoute('syn-supply-living', [
    { kind: 'axis_corner', x: 'from', z: 5.35 },
  ]));
  (parsed.via[0] as Record<string, unknown>).y = 2.66;
  const via = resolveMepViaSteps(parsed, { x: 10.3, z: 4.75 }, { x: 11.45, z: 5.56 }, []);
  assert.deepEqual(via.points, []);
  assert.match(via.diagnostic ?? '', /不得声明 y/);
});

test('反例：axis_corner 越权声明（竖井 / axis / to）→ schema 拒绝（红/绿）', () => {
  assert.throws(
    () => MepViaStepSchema.parse({ kind: 'axis_corner', x: 'from', z: 5.35, shaft: 'shaft_entry' }),
    /axis_corner 不引用竖井/,
  );
  assert.throws(
    () => MepViaStepSchema.parse({ kind: 'axis_corner', x: 'from', z: 5.35, axis: 'x' }),
    /axis_corner 不走坡度/,
  );
  assert.throws(
    () => MepViaStepSchema.parse({ kind: 'axis_corner', x: 'from', z: 5.35, to: 'to' }),
    /axis_corner 不走坡度/,
  );
});

test('反例：axis_corner 缺 x/z → schema 拒绝且求解器入口拒绝，不出半条几何（红/绿）', () => {
  assert.throws(
    () => MepViaStepSchema.parse({ kind: 'axis_corner', z: 5.35 }),
    /axis_corner 必须声明 x/,
  );
  assert.throws(
    () => MepViaStepSchema.parse({ kind: 'axis_corner', x: 'from' }),
    /axis_corner 必须声明 z/,
  );
  const parsed = MepRouteSchema.parse(airRoute('syn-supply-living', [
    { kind: 'axis_corner', x: 'from', z: 5.35 },
  ]));
  delete (parsed.via[0] as Record<string, unknown>).z;
  const via = resolveMepViaSteps(parsed, { x: 10.3, z: 4.75 }, { x: 11.45, z: 5.56 }, []);
  assert.deepEqual(via.points, []);
  assert.match(via.diagnostic ?? '', /缺少 x\/z/);
});

test('反例：未含 axis_corner 的路由声明 via_height → schema 拒绝（未被消费的高度是静默事实）', () => {
  const absolute = airRoute('syn-absolute', [{ x: 10.3, z: 5.35, y: 2.66 }]);
  assert.throws(() => MepRouteSchema.parse(absolute), /MEP route syn-absolute 未含 axis_corner 步，不得声明 via_height/);
  const slopeOnly = airRoute('syn-slope-only', [
    { kind: 'slope_run', axis: 'z', to: 'to' },
  ], { slope: 0.01, to_height: undefined });
  assert.throws(() => MepRouteSchema.parse(slopeOnly), /MEP route syn-slope-only 未含 axis_corner 步，不得声明 via_height/);
});

test('反例：其他步型声明 x/z → schema 拒绝（x/z 只属于 axis_corner）', () => {
  assert.throws(
    () => MepViaStepSchema.parse({ kind: 'from_face_jog', shaft: 'shaft_entry', x: 10.74 }),
    /只有 axis_corner 步可声明 x\/z/,
  );
  assert.throws(
    () => MepViaStepSchema.parse({ kind: 'slope_run', axis: 'z', to: 'to', z: 5.35 }),
    /只有 axis_corner 步可声明 x\/z/,
  );
});

test('反例：to/from 断引用 → unresolved 含 to/from 与 via、无不完整几何（红/绿）', () => {
  const brokenFrom = airConfig([airRoute('syn-broken-from', [
    { kind: 'axis_corner', x: 'from', z: 5.35 },
  ], { from: 'no_such_anchor' })]);
  const fromEntry = resolveMepRoutes(brokenFrom, emptySources).routes[0];
  assert.deepEqual(fromEntry.unresolved, ['from', 'via']);
  assert.deepEqual(fromEntry.points, []);
  const brokenTo = airConfig([airRoute('syn-broken-to', [
    { kind: 'axis_corner', x: 'from', z: 5.35 },
  ], { to: 'no_such_terminal' })]);
  const toEntry = resolveMepRoutes(brokenTo, emptySources).routes[0];
  assert.deepEqual(toEntry.unresolved, ['to', 'via']);
  assert.deepEqual(toEntry.points, []);
});

// ── 真实配置：C1 等价、C2 传动、C3 对账、C4 反例 ────────────────────────────

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
const realSources = endpointSourcesFromFacts(
  { electrical, plumbing, ceiling, hvac },
  pointWallIndexFromElements(realLayout.walls),
  realMountHosts,
);

const AIR_IDS = [
  'supply-air-living', 'return-air-living', 'supply-air-master', 'return-air-master',
  'supply-air-study', 'return-air-study', 'supply-air-parent', 'return-air-parent',
  'supply-air-child', 'return-air-child', 'supply-air-dining', 'return-air-dining',
  'supply-air-living-bottom', 'supply-air-dining-bottom',
] as const;
const MIGRATED_IDS = [
  'supply-air-living', 'return-air-living', 'supply-air-master', 'supply-air-child',
  'supply-air-dining', 'return-air-dining', 'supply-air-living-bottom', 'supply-air-dining-bottom',
] as const;

/** merge-base 实测点位（逐点等价基线，容差 1e-9；长度由同批点位算出，见下方钉值）。 */
const BASELINE_POINTS: Record<string, Array<[number, number, number]>> = {
  'supply-air-living': [[10.3, 2.68, 4.75], [10.3, 2.66, 5.35], [11.45, 2.66, 5.35], [11.45, 2.65, 5.56]],
  'return-air-living': [[10.3, 2.72, 4.75], [10.3, 2.70, 4.75], [10.3, 2.70, 4.725], [10.95, 2.70, 4.725], [10.95, 2.49, 4.725]],
  'supply-air-master': [[3.7, 2.68, 5.1], [3.7, 2.66, 5.35], [3.7, 2.65, 5.585]],
  'return-air-master': [[3.7, 2.72, 5.1], [3.7, 2.70, 5.15], [3.7, 2.49, 5.2]],
  'supply-air-study': [[15.1, 2.68, 5.85], [15.1, 2.66, 6.0], [15.1, 2.65, 6.16]],
  'return-air-study': [[15.1, 2.72, 5.85], [15.6, 2.70, 5.85], [15.7, 2.49, 5.85]],
  'supply-air-parent': [[6.5, 2.68, 6.0], [6.5, 2.65, 6.44]],
  'return-air-parent': [[6.5, 2.72, 6.0], [6.5, 2.72, 6.15], [6.5, 2.49, 6.15]],
  'supply-air-child': [[4.4, 2.68, 4.0], [3.7, 2.66, 4.0], [3.7, 2.65, 3.69]],
  'return-air-child': [[4.4, 2.72, 4.0], [4.8, 2.70, 4.0], [4.9, 2.49, 4.0]],
  'supply-air-dining': [[8.0, 2.68, 4.75], [8.0, 2.66, 4.35], [8.7, 2.66, 4.35], [8.7, 2.65, 4.3]],
  'return-air-dining': [[8.0, 2.72, 4.75], [8.0, 2.70, 4.75], [8.0, 2.70, 4.725], [9.65, 2.70, 4.725], [9.65, 2.49, 4.725]],
  'supply-air-living-bottom': [[10.3, 2.68, 4.75], [10.3, 2.62, 4.75], [10.3, 2.62, 5.125], [12.0, 2.62, 5.125], [12.0, 2.50, 5.125]],
  'supply-air-dining-bottom': [[8.0, 2.68, 4.75], [8.0, 2.62, 4.75], [8.0, 2.62, 5.125], [8.6, 2.62, 5.125], [8.6, 2.50, 5.125]],
};

/** 平面/3D 长度钉值（由 BASELINE_POINTS 算出，容差 1e-9）。 */
const BASELINE_LENGTHS: Record<string, [number, number]> = {
  'supply-air-living': [1.96, 1.9605712012],
  'return-air-living': [0.675, 0.905],
  'supply-air-master': [0.485, 0.4860113938],
  'return-air-master': [0.10, 0.2697219795],
  'supply-air-study': [0.31, 0.3116396549],
  'return-air-study': [0.60, 0.7329939071],
  'supply-air-parent': [0.44, 0.4410215414],
  'return-air-parent': [0.15, 0.38],
  'supply-air-child': [1.01, 1.0104469044],
  'return-air-child': [0.50, 0.6330937549],
  'supply-air-dining': [1.15, 1.151489883],
  'return-air-dining': [1.675, 1.905],
  'supply-air-living-bottom': [2.075, 2.255],
  'supply-air-dining-bottom': [0.975, 1.155],
};

function airPoints(report: ReturnType<typeof resolveMepRoutes>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of AIR_IDS) out[id] = JSON.stringify(report.routes.find((item) => item.route.id === id)!.points);
  return out;
}

test('C1：8 条已迁路由逐点等价（vs merge-base，≤1e-9）+ 平面/3D 长度钉值', () => {
  const report = resolveMepRoutes(project, realSources);
  assert.equal(report.total, 137);
  assert.equal(report.unresolved, 0);
  for (const id of MIGRATED_IDS) {
    const entry = report.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, [], `${id} must resolve`);
    assertPointsClose(entry.points, BASELINE_POINTS[id], id);
    const [plan, len3] = BASELINE_LENGTHS[id];
    assert.ok(Math.abs(planLength(entry.points) - plan) <= 1e-9, `${id} plan ${planLength(entry.points)} !== ${plan}`);
    assert.ok(Math.abs(length3d(entry.points) - len3) <= 1e-9, `${id} 3D ${length3d(entry.points)} !== ${len3}`);
    assert.ok(entry.route.via.every((step) => !isMepViaCoordinate(step)), `${id}: via 须全为关系步`);
  }
});

test('C1：6 条留绝对路由逐点等价（vs merge-base，≤1e-9）+ 平面/3D 长度钉值', () => {
  const report = resolveMepRoutes(project, realSources);
  const absoluteIds = AIR_IDS.filter((id) => !(MIGRATED_IDS as ReadonlyArray<string>).includes(id));
  assert.equal(absoluteIds.length, 6);
  for (const id of absoluteIds) {
    const entry = report.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, [], `${id} must resolve`);
    assertPointsClose(entry.points, BASELINE_POINTS[id], id);
    const [plan, len3] = BASELINE_LENGTHS[id];
    assert.ok(Math.abs(planLength(entry.points) - plan) <= 1e-9, `${id} plan ${planLength(entry.points)} !== ${plan}`);
    assert.ok(Math.abs(length3d(entry.points) - len3) <= 1e-9, `${id} 3D ${length3d(entry.points)} !== ${len3}`);
    assert.ok(entry.route.via.every((step) => isMepViaCoordinate(step)), `${id}: via 须全为绝对坐标步`);
    assert.ok((entry.route.reason ?? '').includes('batch 7'), `${id}: reason 须记留绝对的理由`);
  }
});

test('行一致性：回风行/下出风行居中对齐，侧送行值为手写字面', () => {
  const report = resolveMepRoutes(project, realSources);
  const pointsOf = (id: string) => report.routes.find((item) => item.route.id === id)!.points;
  // 回风行 4.725 = 两条回风的 to.z（DEC-2026-10-19-R02 居中行）；下出风行 5.125；
  // 两排相距 0.40m，边吊中心 4.925 ± 0.20。
  for (const id of ['return-air-living', 'return-air-dining'] as const) {
    const pts = pointsOf(id);
    assert.ok(Math.abs(pts[pts.length - 1].z - 4.725) <= 1e-9, `${id} 回风行须为 4.725`);
    assert.ok(pts.slice(1, -1).every((p) => p.y === 2.70), `${id} via 高度须全为 via_height 2.70`);
  }
  for (const id of ['supply-air-living-bottom', 'supply-air-dining-bottom'] as const) {
    const pts = pointsOf(id);
    assert.ok(pts.slice(2, -1).every((p) => Math.abs(p.z - 5.125) <= 1e-9), `${id} 下出风行须为 5.125`);
    assert.ok(pts.slice(1, -1).every((p) => p.y === 2.62), `${id} via 高度须全为 via_height 2.62`);
  }
  assert.ok(Math.abs(5.125 - 4.725 - 0.40) <= 1e-9, '两排相距 0.40m');
  // 侧送行值是手写字面（无干净端点锚）：living/master 同值 5.35 但各为独立声明，
  // dining 4.35——仅断言现值，不派生。
  assert.ok(pointsOf('supply-air-living').slice(1, -1).every((p) => Math.abs(p.z - 5.35) <= 1e-9));
  assert.ok(pointsOf('supply-air-master').slice(1, -1).every((p) => Math.abs(p.z - 5.35) <= 1e-9));
  assert.ok(pointsOf('supply-air-dining').slice(1, -1).every((p) => Math.abs(p.z - 4.35) <= 1e-9));
});

test('C2：via_height 2.66→2.60 单点改动，两 via 点同动、其余 13 条逐字节不动；恢复逐字节还原', () => {
  const baseline = airPoints(resolveMepRoutes(project, realSources));
  const moved = structuredClone(project);
  (moved.routes.find((route) => route.id === 'supply-air-living')! as Record<string, unknown>).via_height = 2.60;
  const movedPoints = airPoints(resolveMepRoutes(moved, realSources));
  const living = JSON.parse(movedPoints['supply-air-living']) as Array<{ x: number; y?: number; z: number }>;
  assert.equal(living[1].y, 2.60, 'via1 高度须随 via_height 改动');
  assert.equal(living[2].y, 2.60, 'via2 高度须随 via_height 改动');
  assert.equal(living[0].y, 2.68, 'from 高度不得动');
  assert.equal(living[3].y, 2.65, 'to 高度不得动');
  for (const id of AIR_IDS.filter((item) => item !== 'supply-air-living')) {
    assert.equal(movedPoints[id], baseline[id], `${id} must not move`);
  }
  const restored = airPoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2：terminal supply_living 东移 0.30m，终端侧步跟随、机端步不动；其余 13 条逐字节不动', () => {
  const baseline = airPoints(resolveMepRoutes(project, realSources));
  const movedSources: MepEndpointSources = {
    ...realSources,
    hvacTerminals: realSources.hvacTerminals.map((terminal) => terminal.id === 'supply_living'
      ? { ...terminal, position: { ...terminal.position, x: terminal.position.x + 0.30 } }
      : terminal),
  };
  const moved = resolveMepRoutes(project, movedSources);
  const living = moved.routes.find((item) => item.route.id === 'supply-air-living')!;
  assert.deepEqual(living.unresolved, []);
  assert.ok(Math.abs(living.points[1].x - 10.3) <= 1e-9, 'via1（from.x）不得动');
  assert.ok(Math.abs(living.points[2].x - 11.75) <= 1e-9, 'via2（to.x）须跟随终端');
  assert.ok(Math.abs(living.points[3].x - 11.75) <= 1e-9, 'to 端点须跟随终端');
  const movedPoints = airPoints(moved);
  for (const id of AIR_IDS.filter((item) => item !== 'supply-air-living')) {
    assert.equal(movedPoints[id], baseline[id], `${id} must not move`);
  }
  const restored = airPoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2：内机 ac_living 东移 0.20m，living 系三条 from 与机端步跟随、终端侧步不动；非 living 风管不动', () => {
  const baseline = airPoints(resolveMepRoutes(project, realSources));
  const movedCeiling = (ceiling as unknown as Array<Record<string, unknown>>).map((zone) => zone.id === 'ac_living'
    ? { ...zone, x: (zone.x as number) + 0.20 }
    : zone);
  const movedSources = endpointSourcesFromFacts(
    { electrical, plumbing, ceiling: movedCeiling as unknown as ProjectRenderFacts['ceiling'], hvac },
    pointWallIndexFromElements(realLayout.walls),
    realMountHosts,
  );
  const moved = resolveMepRoutes(project, movedSources);
  const livingIds = ['supply-air-living', 'return-air-living', 'supply-air-living-bottom'] as const;
  const expectedFromX: Record<string, number> = {
    'supply-air-living': 10.5, 'return-air-living': 10.5, 'supply-air-living-bottom': 10.5,
  };
  for (const id of livingIds) {
    const entry = moved.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, [], `${id} must resolve`);
    assert.ok(Math.abs(entry.points[0].x - 10.5) <= 1e-9, `${id} from x 须跟随内机`);
  }
  // 机端步（from.x）跟随、终端侧步不动：逐点核对 living 系三条的 x 序列。
  const living = moved.routes.find((item) => item.route.id === 'supply-air-living')!;
  assert.deepEqual(living.points.map((p) => p.x), [10.5, 10.5, 11.45, 11.45]);
  const ret = moved.routes.find((item) => item.route.id === 'return-air-living')!;
  assert.deepEqual(ret.points.map((p) => p.x), [10.5, 10.5, 10.5, 10.95, 10.95]);
  const bottom = moved.routes.find((item) => item.route.id === 'supply-air-living-bottom')!;
  assert.deepEqual(bottom.points.map((p) => p.x), [10.5, 10.5, 10.5, 12.0, 12.0]);
  assert.equal(expectedFromX['supply-air-living'], 10.5);
  const movedPoints = airPoints(moved);
  for (const id of AIR_IDS.filter((item) => !(livingIds as ReadonlyArray<string>).includes(item))) {
    assert.equal(movedPoints[id], baseline[id], `${id} must not move`);
  }
  const restored = airPoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C3：14 条风管 lint findings 计数+码与基线一致，DXF 与算量同源', () => {
  const lintResult = lintMepCoordination(project, realSources);
  const findingsOf = (id: string) => [...lintResult.errors, ...lintResult.warnings].filter((issue) => issue.routeId === id);
  const expectedCounts: Record<string, number> = {
    'supply-air-living': 0, 'return-air-living': 4, 'supply-air-master': 2, 'return-air-master': 2,
    'supply-air-study': 1, 'return-air-study': 2, 'supply-air-parent': 2, 'return-air-parent': 1,
    'supply-air-child': 1, 'return-air-child': 2, 'supply-air-dining': 3, 'return-air-dining': 4,
    'supply-air-living-bottom': 1, 'supply-air-dining-bottom': 1,
  };
  const expectedCodes: Record<string, string[]> = {
    'return-air-living': ['ceiling_clearance_unverified', 'route_clearance_unverified', 'route_clearance_unverified', 'route_clearance_unverified'],
    'supply-air-master': ['route_clearance_unverified', 'supply_return_overlap'],
    'return-air-master': ['ceiling_clearance_unverified', 'route_clearance_unverified'],
    'supply-air-study': ['route_clearance_unverified'],
    'return-air-study': ['ceiling_clearance_unverified', 'route_overlap'],
    'supply-air-parent': ['route_clearance_unverified', 'supply_return_overlap'],
    'return-air-parent': ['ceiling_clearance_unverified'],
    'supply-air-child': ['route_overlap'],
    'return-air-child': ['ceiling_clearance_unverified', 'route_overlap'],
    'supply-air-dining': ['route_clearance_unverified', 'route_clearance_unverified', 'route_clearance_unverified'],
    'return-air-dining': ['ceiling_clearance_unverified', 'route_clearance_unverified', 'route_clearance_unverified', 'route_clearance_unverified'],
    'supply-air-living-bottom': ['ceiling_clearance_unverified'],
    'supply-air-dining-bottom': ['ceiling_clearance_unverified'],
  };
  let total = 0;
  for (const id of AIR_IDS) {
    const found = findingsOf(id);
    total += found.length;
    assert.equal(found.length, expectedCounts[id], `${id} findings ${found.length} !== ${expectedCounts[id]}`);
    if (expectedCodes[id]) assert.deepEqual(found.map((issue) => issue.code).sort(), [...expectedCodes[id]].sort(), `${id} codes`);
  }
  assert.equal(total, 26, '14 条风管 findings 合计须为 26');

  // DXF 与 lint/takeoff 同读统一出口：健康态 errors 为空、含本批路线标注。
  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const dxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(dxf.errors, []);
  assert.ok(dxf.dxf.includes('supply-air-living supply_air H2.68->2.65'), 'healthy DXF must export supply-air-living');
  assert.ok(dxf.dxf.includes('return-air-dining return_air H2.72->2.49'), 'healthy DXF must export return-air-dining');

  // 算量同源：全仓 unresolved 仍只有 trunk_strong_main（风管层 excluded，不进算量门禁）。
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
});

test('C4：删 via_height → unresolved、lint 报错、DXF 拒导且不导出该路线；算量 unresolved 不变', () => {
  const corrupted = structuredClone(project);
  delete (corrupted.routes.find((route) => route.id === 'supply-air-living')! as Record<string, unknown>).via_height;
  const corruptedResolution = resolveMepRoutes(corrupted, realSources);
  const entry = corruptedResolution.routes.find((item) => item.route.id === 'supply-air-living')!;
  assert.deepEqual(entry.unresolved, ['via']);
  assert.deepEqual(entry.points, []);
  assert.match(entry.diagnostics.join('；'), /缺少有效 via_height/);

  const lintResult = lintMepCoordination(corrupted, realSources);
  const livingErrors = lintResult.errors.filter((issue) => issue.routeId === 'supply-air-living');
  assert.ok(livingErrors.some((issue) => issue.code === 'endpoint_unresolved' && issue.message.includes('缺少有效 via_height')),
    `expected an endpoint_unresolved error for supply-air-living, got ${JSON.stringify(livingErrors.map((issue) => issue.code))}`);

  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const healthyDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(healthyDxf.errors, []);
  assert.ok(healthyDxf.dxf.includes('supply-air-living supply_air H2.68->2.65'), 'healthy DXF must export supply-air-living');
  const corruptedDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: corrupted, sources: realSources }, labels: 'ascii' });
  assert.ok(corruptedDxf.errors.some((error) => error.includes('mep route supply-air-living: 端点未解析（via）——不导出该路线，修复声明后重导')),
    `corrupted DXF must name the broken route, got ${JSON.stringify(corruptedDxf.errors)}`);
  assert.equal(corruptedDxf.dxf.includes('supply-air-living supply_air H2.68->2.65'), false, 'corrupted DXF must not export supply-air-living');

  const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules;
  const topology = parseYaml(readFileSync('config/electrical-topology.yaml', 'utf8')) as {
    circuits: TakeoffCircuit[];
    controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
  };
  const takeoffInput = (coordination: MepCoordination) => ({
    electrical: electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
    circuits: topology.circuits,
    controls: topology.controls ?? [],
    routes: coordination.routes,
    resolution: resolveMepRoutes(coordination, realSources),
    rules,
  });
  const healthy = computeMepTakeoff(takeoffInput(project));
  const broken = computeMepTakeoff(takeoffInput(corrupted));
  assert.deepEqual(broken.unresolved, healthy.unresolved);
  assert.deepEqual(broken.unresolved.map((item) => item.id), ['trunk_strong_main']);
});
