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

const TOL = 1e-9;
/** 连续重复点去重。 */
function dedup(points: ReadonlyArray<{ x: number; y?: number; z: number }>): Array<{ x: number; y?: number; z: number }> {
  const out: Array<{ x: number; y?: number; z: number }> = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(p.x - last.x) <= TOL && Math.abs(p.z - last.z) <= TOL && Math.abs((p.y ?? 0) - (last.y ?? 0)) <= TOL) continue;
    out.push({ ...p });
  }
  return out;
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
  assertPointsClose([first], [[r.from!.x, r.route.from_height!, r.from!.z]], `${what} 起点须为 from + from_height`);
  assertPointsClose([last], [[r.to!.x, (r.route.to_height ?? r.to!.y)!, r.to!.z]], `${what} 终点须为 to + to_height`);
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
 * 本路由任一步的数值 to 目标，或任一 axis_corner 步的数值 x/z（风管行值即此类声明）。
 * 解算器只组合声明值，不编造新坐标。
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
    if (typeof step.x === 'number') xs.add(step.x);
    if (typeof step.z === 'number') zs.add(step.z);
  }
  for (const p of r.points) {
    assert.ok([...xs].some((v) => Math.abs(p.x - v) <= TOL), `${what} 点 x=${p.x} 不在任何声明值中`);
    assert.ok([...zs].some((v) => Math.abs(p.z - v) <= TOL), `${what} 点 z=${p.z} 不在任何声明值中`);
  }
}
/**
 * 无发明标高：折线每个点的 y 须来自当轮声明——from_height、to_height、via_height、
 * 任一绝对步的 y、或任一竖井的 y。解算器只组合声明标高，不编造新高度。
 */
function assertDeclaredHeights(
  r: ReturnType<typeof routeOf>,
  shafts: MepCoordination['shafts'],
  what: string,
): void {
  const ys = new Set<number>();
  if (r.route.from_height !== undefined) ys.add(r.route.from_height);
  if (r.route.to_height !== undefined) ys.add(r.route.to_height);
  if (typeof (r.route as { via_height?: unknown }).via_height === 'number') ys.add((r.route as { via_height: number }).via_height);
  for (const step of r.route.via as any[]) {
    if (typeof step.y === 'number') ys.add(step.y);
  }
  for (const s of shafts) ys.add(s.y);
  for (const p of r.points) {
    if (p.y === undefined) continue;
    assert.ok([...ys].some((v) => Math.abs(p.y! - v) <= TOL), `${what} 点 y=${p.y} 不在任何声明高度中`);
  }
}
/** 无连续重复点（风管末步落点在 via_height、端点在 to_height，高度恒不同，无末点追加重复）。 */
function assertNoDuplicates(points: ReadonlyArray<{ x: number; y?: number; z: number }>, what: string): void {
  assert.equal(dedup(points).length, points.length, `${what} 不得含连续重复点`);
}
/**
 * 风管路由持续不变式：端点 + 正交 + 点数（from + 每步一落点 + to）+ 无连续重复点
 * + 无往返折返 + 无发明坐标/标高。历史逐点等价证明在 batch 7 PR 记录与 git 历史里，不在套件里。
 */
function assertAirRouteInvariants(
  r: ReturnType<typeof routeOf>,
  coordination: MepCoordination,
  what: string,
): void {
  assert.deepEqual(r.unresolved, [], `${what} 须解出`);
  assert.deepEqual(r.diagnostics, [], `${what} 须无诊断`);
  assertEndpoints(r, what);
  assertOrthogonal(r.points, what);
  assert.equal(r.points.length, r.route.via.length + 2, `${what} 点数须为 from + 每步一落点 + to`);
  assertNoDuplicates(r.points, what);
  assertNoRetrace(r.points, what);
  assertNoInventedCoords(r, coordination.axes, coordination.shafts, what);
  assertDeclaredHeights(r, coordination.shafts, what);
}
function routeOf(report: ReturnType<typeof resolveMepRoutes>, id: string) {
  const r = report.routes.find((item) => item.route.id === id);
  assert.ok(r, `缺失路由 ${id}`);
  return r!;
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


function airPoints(report: ReturnType<typeof resolveMepRoutes>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of AIR_IDS) out[id] = JSON.stringify(report.routes.find((item) => item.route.id === id)!.points);
  return out;
}
/** DXF 路由标注由路由自身声明派生（id + 层 + from_height→to_height），不钉字面。 */
function dxfLabel(id: string): string {
  const route = project.routes.find((item) => item.id === id)!;
  return `${id} ${route.layer} H${route.from_height}->${route.to_height}`;
}

test('C1：8 条已迁路由满足持续不变式（端点/正交/点数/无折返/无发明坐标·标高）', () => {
  const report = resolveMepRoutes(project, realSources);
  assert.equal(report.total, 139); // 2026-11-27 PR #270：机器人泊位上下水 +2，137→139
  assert.equal(report.unresolved, 0);
  for (const id of MIGRATED_IDS) {
    const entry = routeOf(report, id);
    assertAirRouteInvariants(entry, project, id);
    assert.ok(entry.route.via.every((step) => !isMepViaCoordinate(step)), `${id}: via 须全为关系步`);
  }
});

test('C1：6 条留绝对路由满足持续不变式（端点/正交/点数/无折返/无发明坐标·标高）', () => {
  const report = resolveMepRoutes(project, realSources);
  const absoluteIds = AIR_IDS.filter((id) => !(MIGRATED_IDS as ReadonlyArray<string>).includes(id));
  assert.equal(absoluteIds.length, 6);
  for (const id of absoluteIds) {
    const entry = routeOf(report, id);
    assertAirRouteInvariants(entry, project, id);
    assert.ok(entry.route.via.every((step) => isMepViaCoordinate(step)), `${id}: via 须全为绝对坐标步`);
    assert.ok((entry.route.reason ?? '').includes('batch 7'), `${id}: reason 须记留绝对的理由`);
  }
});

test('行一致性：回风行/下出风行居中对齐，行值取自终端与路由自身声明', () => {
  const report = resolveMepRoutes(project, realSources);
  const pointsOf = (id: string) => report.routes.find((item) => item.route.id === id)!.points;
  const routeOfProject = (id: string) => project.routes.find((item) => item.id === id)!;
  const terminalOf = (id: string) => realSources.hvacTerminals.find((t) => t.id === id)!;
  const declaredRowZ = (routeId: string): number[] => (routeOfProject(routeId).via as Array<Record<string, unknown>>)
    .filter((s) => s.kind === 'axis_corner' && typeof s.z === 'number')
    .map((s) => s.z as number);
  // 回风行 = 终端声明 z；终端声明 z 须为裁定值 4.725（DEC-2026-10-19-R02 居中行）。
  // 下出风行 = 路由 via 声明 z；声明值须为裁定值 5.125（同裁定）。
  // 两排相距 0.40m，边吊中心 4.925 ± 0.20。
  for (const [routeId, terminalId] of [['return-air-living', 'return_living'], ['return-air-dining', 'return_dining']] as const) {
    const terminal = terminalOf(terminalId);
    assert.equal(terminal.position!.z, 4.725, `${terminalId} 终端 z 须为裁定居中行 4.725（DEC-2026-10-19-R02）`);
    const pts = pointsOf(routeId);
    assert.ok(Math.abs(pts[pts.length - 1].z - terminal.position!.z) <= 1e-9, `${routeId} 回风行须为终端声明 z`);
    assert.ok(pts.slice(1, -1).every((p) => p.y === routeOfProject(routeId).via_height), `${routeId} via 高度须全为路由声明 via_height`);
  }
  for (const routeId of ['supply-air-living-bottom', 'supply-air-dining-bottom'] as const) {
    const declared = declaredRowZ(routeId);
    assert.ok(declared.length > 0, `${routeId} 须在 via 声明下出风行 z`);
    assert.ok(declared.every((z) => z === 5.125), `${routeId} 下出风行声明值须为裁定值 5.125（DEC-2026-10-19-R02）`);
    const pts = pointsOf(routeId);
    assert.ok(pts.slice(2, -1).every((p) => declared.some((z) => z === p.z)), `${routeId} 下出风行须为 via 声明 z`);
    assert.ok(pts.slice(1, -1).every((p) => p.y === routeOfProject(routeId).via_height), `${routeId} via 高度须全为路由声明 via_height`);
  }
  assert.ok(Math.abs(declaredRowZ('supply-air-living-bottom')[0]! - terminalOf('return_living').position!.z - 0.40) <= 1e-9, '两排相距 0.40m');
  // 侧送行值：中段 z 须为路由 via 声明的数字 z（living/master 各自声明，不共享）。
  for (const routeId of ['supply-air-living', 'supply-air-master', 'supply-air-dining'] as const) {
    const declared = declaredRowZ(routeId);
    assert.ok(declared.length > 0, `${routeId} 须在 via 声明侧送行 z`);
    assert.ok(pointsOf(routeId).slice(1, -1).every((p) => declared.includes(p.z)), `${routeId} 侧送行须为 via 声明 z`);
  }
});

test('C2：via_height 2.66→2.60 单点改动，两 via 点同动、其余 13 条逐字节不动；恢复逐字节还原', () => {
  const baseline = airPoints(resolveMepRoutes(project, realSources));
  const moved = structuredClone(project);
  (moved.routes.find((route) => route.id === 'supply-air-living')! as Record<string, unknown>).via_height = 2.60;
  const movedPoints = airPoints(resolveMepRoutes(moved, realSources));
  const living = JSON.parse(movedPoints['supply-air-living']) as Array<{ x: number; y?: number; z: number }>;
  const livingRoute = project.routes.find((route) => route.id === 'supply-air-living')!;
  assert.equal(living[1].y, 2.60, 'via1 高度须随 via_height 改动');
  assert.equal(living[2].y, 2.60, 'via2 高度须随 via_height 改动');
  assert.equal(living[0].y, livingRoute.from_height, 'from 高度不得动');
  assert.equal(living[3].y, livingRoute.to_height, 'to 高度不得动');
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
  const baseFromX = routeOf(resolveMepRoutes(project, realSources), 'supply-air-living').from!.x;
  const movedTerminalX = realSources.hvacTerminals.find((t) => t.id === 'supply_living')!.position!.x + 0.30;
  assert.ok(Math.abs(living.points[1].x - baseFromX) <= 1e-9, 'via1（from.x）不得动');
  assert.ok(Math.abs(living.points[2].x - movedTerminalX) <= 1e-9, 'via2（to.x）须跟随终端');
  assert.ok(Math.abs(living.points[3].x - movedTerminalX) <= 1e-9, 'to 端点须跟随终端');
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
  // 机端 x = 移动后的内机声明 x（本测试注入 +0.20）；终端 x = 各终端声明 x（不动）。
  const movedFromX = (movedCeiling.find((zone) => zone.id === 'ac_living') as { x: number }).x;
  const terminalX = (id: string) => realSources.hvacTerminals.find((t) => t.id === id)!.position!.x;
  for (const id of livingIds) {
    const entry = moved.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, [], `${id} must resolve`);
    assert.ok(Math.abs(entry.points[0].x - movedFromX) <= 1e-9, `${id} from x 须跟随内机`);
  }
  // 机端步（from.x）跟随、终端侧步不动：逐点核对 living 系三条的 x 序列。
  const living = moved.routes.find((item) => item.route.id === 'supply-air-living')!;
  assert.deepEqual(living.points.map((p) => p.x), [movedFromX, movedFromX, terminalX('supply_living'), terminalX('supply_living')]);
  const ret = moved.routes.find((item) => item.route.id === 'return-air-living')!;
  assert.deepEqual(ret.points.map((p) => p.x), [movedFromX, movedFromX, movedFromX, terminalX('return_living'), terminalX('return_living')]);
  const bottom = moved.routes.find((item) => item.route.id === 'supply-air-living-bottom')!;
  assert.deepEqual(bottom.points.map((p) => p.x), [movedFromX, movedFromX, movedFromX, terminalX('supply_living_bottom'), terminalX('supply_living_bottom')]);
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
    'supply-air-living': 0, 'return-air-living': 4, 'supply-air-master': 0, 'return-air-master': 0, // 2026-11-23 通长假梁：送回风支管收进梁内，supply 的 supply_return_overlap + route_clearance 与 return 的 route_clearance 同批消失（两管 z 向仅在 5.30 相接、不再重叠）；2026-11-26/27 量房回填：ceiling_master_beam 完成面 2.50→2.40，return-air-master 低点（≈2.40）不再低于完成面，其 ceiling_clearance_unverified 亦消失
    'supply-air-study': 1, 'return-air-study': 2, 'supply-air-parent': 2, 'return-air-parent': 0, // 2026-11-26/27 量房回填：走廊完成面 2.50→2.39，return-air-parent 的 ceiling_clearance_unverified 亦消失（与 return-air-master 同机制）
    'supply-air-child': 1, 'return-air-child': 1, 'supply-air-dining': 4, 'return-air-dining': 4, // 2026-11-26/27 量房回填：supply-air-dining +1（weak-ap-master 2.51→2.65 升位新增 route_overlap）
    'supply-air-living-bottom': 1, 'supply-air-dining-bottom': 1,
  };
  const expectedCodes: Record<string, string[]> = {
    'return-air-living': ['ceiling_clearance_unverified', 'route_clearance_unverified', 'route_clearance_unverified', 'route_clearance_unverified'],
    'supply-air-master': [], // 2026-11-23 通长假梁：支管收进梁内，findings 清零
    'return-air-master': [], // 2026-11-23 通长假梁：route_clearance_unverified 随支管进梁消失；2026-11-26/27 回填：ceiling_master_beam 完成面 2.50→2.40，ceiling_clearance_unverified 亦消失，findings 清零
    'supply-air-study': ['route_clearance_unverified'],
    'return-air-study': ['ceiling_clearance_unverified', 'route_overlap'],
    'supply-air-parent': ['route_clearance_unverified', 'supply_return_overlap'],
    'return-air-parent': [], // 2026-11-26/27 量房回填：走廊完成面 2.50→2.39，ceiling_clearance_unverified 消失，findings 清零
    'supply-air-child': ['route_clearance_unverified'], // 2026-11-26/27 量房回填：旧 route_overlap（vs strong-light-bedrooms-child-door seg#1，0.029m）随儿童房灯位改道消失；新 route_clearance_unverified（vs strong-power-parent-child-childbed seg#3，净距 <0.03m），条数仍为 1
    'return-air-child': ['ceiling_clearance_unverified'],  // 2026-11-16 第四轮：strong-light-child 往返折返消除，与 return-air-child 的 1 处 route_overlap warning 同批消失
    'supply-air-dining': ['route_clearance_unverified', 'route_clearance_unverified', 'route_clearance_unverified', 'route_overlap'], // 2026-11-26/27 回填：+1 route_overlap（vs weak-ap-master seg#4，0.020m；其 2.51→2.65 升位所致）
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
  assert.equal(total, 21, '14 条风管 findings 合计须为 21（2026-11-23 通长假梁：主卧送回风 3 处同批消失；2026-11-26/27 量房回填：return-air-master 与 return-air-parent 的 ceiling_clearance_unverified 各 1 处随完成面下调消失，supply-air-dining +1 处 weak-ap-master 升位重叠；净 22→21）');

  // DXF 与 lint/takeoff 同读统一出口：健康态 errors 为空、含本批路线标注。
  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const dxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(dxf.errors, []);
  assert.ok(dxf.dxf.includes(dxfLabel('supply-air-living')), 'healthy DXF must export supply-air-living');
  assert.ok(dxf.dxf.includes(dxfLabel('return-air-dining')), 'healthy DXF must export return-air-dining');

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
  assert.ok(healthyDxf.dxf.includes(dxfLabel('supply-air-living')), 'healthy DXF must export supply-air-living');
  const corruptedDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: corrupted, sources: realSources }, labels: 'ascii' });
  assert.ok(corruptedDxf.errors.some((error) => error.includes('mep route supply-air-living: 端点未解析（via）——不导出该路线，修复声明后重导')),
    `corrupted DXF must name the broken route, got ${JSON.stringify(corruptedDxf.errors)}`);
  assert.equal(corruptedDxf.dxf.includes(dxfLabel('supply-air-living')), false, 'corrupted DXF must not export supply-air-living');

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
