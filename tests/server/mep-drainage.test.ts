import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
  type MepCoordination,
  type MepEndpointSources,
} from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination } from '../../shared/mep-hvac-lint.js';
import { computeMepTakeoff, type MepTakeoffRules, type TakeoffCircuit } from '../../shared/mep-takeoff.js';
import { buildProjectDxf } from '../../shared/dxf/project-dxf.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, ProjectRenderFacts, VertexLayoutYaml } from '../../shared/types.js';

/**
 * issue #98 MEP batch 6（排水家族）：10 条路由 via 由绝对坐标改 slope_run 关系步
 * （沿轴按 route.slope 派生高度，末步 to:'to' 跟随端点），to_height 删除、终端标高由
 * 末步落点派生；3 条带 via 路由因坡度链与 1% 派生差超 0.005m 留绝对，4 条无 via 路由
 * 本就是端点驱动。slope_run 机制本身（schema + 求解器双重 fail-closed、红绿反例）
 * 已由 tests/server/mep-slope-run.test.ts 覆盖；本文件只钉本批的传动/消费方对账，
 * 逐点等价证明在批 6 PR 记录与 git 历史里（merge-base 211831e8 实测基线已删），不在套件里。
 */

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
const wallIndex = pointWallIndexFromElements(realLayout.walls);
const realSources = endpointSourcesFromFacts(
  { electrical, plumbing, ceiling, hvac },
  wallIndex,
  realMountHosts,
);

const DRAIN_IDS = [
  'drain-master-bath', 'drain-guest-bath', 'drain-balcony', 'drain-kitchen-requirement',
  'drain-garden-requirement', 'drain-mbath-vanity-to-riser', 'drain-gbath-vanity-to-riser',
  'drain-kitchen-sink-to-riser', 'drain-kitchen-dishwasher-to-riser', 'drain-mbath-toilet-to-riser',
  'drain-mbath-shower-to-riser', 'drain-mbath-floor-to-riser', 'drain-gbath-shower-to-riser',
  'drain-gbath-floor-to-riser', 'drain-balcony-floor-to-riser', 'drain-mbath-secondary-requirement',
  'drain-gbath-secondary-requirement',
];

/** 批 6 迁移的 10 条路由（逐点基线已删，见文件头注释）。 */
const MIGRATED_IDS = [
  'drain-master-bath', 'drain-guest-bath', 'drain-garden-requirement',
  'drain-mbath-toilet-to-riser', 'drain-mbath-shower-to-riser', 'drain-mbath-floor-to-riser',
  'drain-gbath-shower-to-riser', 'drain-gbath-floor-to-riser',
  'drain-mbath-secondary-requirement', 'drain-gbath-secondary-requirement',
];

function routePoints(report: ReturnType<typeof resolveMepRoutes>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of DRAIN_IDS) out[id] = JSON.stringify(report.routes.find((item) => item.route.id === id)!.points);
  return out;
}

const TOL = 1e-9;

function dedup(points: ReadonlyArray<{ x: number; y?: number; z: number }>): Array<{ x: number; y?: number; z: number }> {
  return points.filter((point, index) => index === 0
    || point.x !== points[index - 1].x || point.y !== points[index - 1].y || point.z !== points[index - 1].z);
}

function assertOrthogonal(points: ReadonlyArray<{ x: number; z: number }>, what: string): void {
  for (let i = 1; i < points.length; i += 1) {
    const dx = Math.abs(points[i].x - points[i - 1].x);
    const dz = Math.abs(points[i].z - points[i - 1].z);
    assert.ok(dx <= TOL || dz <= TOL, `${what} 第 ${i} 段须正交（dx ${dx}, dz ${dz}）`);
  }
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

/**
 * 排水迁移路由持续不变式：起点 = from + from_height；每点标高 = from_height −
 * 坡度×累计行程（末点复点零行程，标高与落点同）；正交；点数 = from + 每步一落点 +
 * 派生终端复点；末点复刻末步落点且平面为 to 端点；每个 x/z 来自声明。
 * 历史逐点等价证明在批 6 PR 记录与 git 历史里，不在套件里。
 */
function assertDrainRouteInvariants(
  entry: ReturnType<typeof resolveMepRoutes>['routes'][number],
  coordination: MepCoordination,
  what: string,
): void {
  const route = entry.route;
  const pts = entry.points;
  assert.deepEqual(entry.unresolved, [], `${what} 须解出`);
  assert.deepEqual(entry.diagnostics, [], `${what} 须无诊断`);
  assert.ok(Math.abs(pts[0].x - entry.from!.x) <= TOL && Math.abs(pts[0].y! - route.from_height!) <= TOL && Math.abs(pts[0].z - entry.from!.z) <= TOL,
    `${what} 起点须为 from + from_height`);
  const [landing, terminal] = pts.slice(-2);
  assert.deepEqual([terminal.x, terminal.y, terminal.z], [landing.x, landing.y, landing.z],
    `${what}: terminal point must duplicate the last slope_run landing`);
  assert.ok(Math.abs(terminal.x - entry.to!.x) <= TOL && Math.abs(terminal.z - entry.to!.z) <= TOL,
    `${what} 末点平面须为 to 端点`);
  let run = 0;
  for (let i = 0; i < pts.length; i += 1) {
    if (i > 0) run += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    assert.ok(Math.abs(pts[i].y! - (route.from_height! - route.slope! * run)) <= TOL,
      `${what} 第 ${i + 1} 点标高须为 from_height − 坡度×累计行程`);
  }
  assert.equal(pts.length, route.via.length + 2, `${what} 点数须为 from + 每步一落点 + 派生终端复点`);
  assertOrthogonal(pts, what);
  assertNoRetrace(pts, what);
  assertNoDuplicates(pts, what);
  assertNoInventedCoords(pts, entry, coordination, what);
}

/**
 * C2 跟随断言：移动地漏后，路线须仍由同一声明步推导——起点为移动后的 from 端点
 * （是地漏则跟随，否则不动）；每步落点的步进轴须为该步声明目标（数字目标，或 'to'
 * → to 端点移动后的位置：to 是地漏取移动后地漏位置，否则取基线同落点同轴值，
 * 即未移动的 to 端点值）；另一轴须与前一点同（正交）；终端复点须与末步落点重合；
 * 每点标高恒为 from_height − 坡度×累计行程（按移动后点列的行程算）。
 * 基线/移动后点列均以 routePoints 的 JSON 快照传入；地漏移动后位置由调用方
 * 从 plumbing 声明 + 本测试注入的位移算出。
 */
function assertFollowsMove(
  baselineJson: string,
  movedJson: string,
  route: MepCoordination['routes'][number],
  drainId: string,
  drainMoved: { x: number; z: number },
  what: string,
): void {
  const basePts = JSON.parse(baselineJson) as Array<{ x: number; y?: number; z: number }>;
  const movedPts = JSON.parse(movedJson) as Array<{ x: number; y?: number; z: number }>;
  assert.equal(movedPts.length, basePts.length, `${what} 点数不得变`);
  const startTarget = route.from === drainId ? drainMoved : { x: basePts[0].x, z: basePts[0].z };
  assert.ok(Math.abs(movedPts[0].x - startTarget.x) <= TOL && Math.abs(movedPts[0].z - startTarget.z) <= TOL,
    `${what} 起点须为移动后的 from 端点`);
  let run = 0;
  for (let i = 0; i < movedPts.length; i += 1) {
    if (i > 0) run += Math.hypot(movedPts[i].x - movedPts[i - 1].x, movedPts[i].z - movedPts[i - 1].z);
    assert.ok(Math.abs(movedPts[i].y! - (route.from_height! - route.slope! * run)) <= TOL,
      `${what} 第 ${i + 1} 点标高须为 from_height − 坡度×累计行程`);
    if (i === 0) continue;
    if (i === movedPts.length - 1) {
      const prev = movedPts[i - 1];
      assert.deepEqual([movedPts[i].x, movedPts[i].y, movedPts[i].z], [prev.x, prev.y, prev.z],
        `${what} 终端复点须与末步落点重合`);
      continue;
    }
    const step = route.via[i - 1] as { kind?: string; axis?: string; to?: unknown };
    assert.ok(step.kind === 'slope_run' && (step.axis === 'x' || step.axis === 'z'),
      `${what} 第 ${i} 步须为 slope_run x/z 步`);
    const axis = step.axis as 'x' | 'z';
    const other = axis === 'x' ? 'z' : 'x';
    const target = typeof step.to === 'number' ? step.to
      : route.to === drainId ? drainMoved[axis] : basePts[i][axis];
    assert.ok(Math.abs(movedPts[i][axis] - target) <= TOL,
      `${what} 第 ${i + 1} 点 ${axis} 须为该步声明目标 ${target}`);
    assert.ok(Math.abs(movedPts[i][other] - movedPts[i - 1][other]) <= TOL,
      `${what} 第 ${i + 1} 点 ${other} 须与前一点同（正交）`);
  }
}

function planLength(points: ReadonlyArray<{ x: number; z: number }>): number {
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.z - points[index].z), 0);
}

test('C1：10 条迁移路由满足持续不变式（端点/1% 坡/正交/点数/末点为派生终端复点）', () => {
  const report = resolveMepRoutes(project, realSources);
  assert.equal(report.unresolved, 0);
  for (const id of MIGRATED_IDS) {
    const route = project.routes.find((item) => item.id === id)!;
    const entry = report.routes.find((item) => item.route.id === id)!;
    // 迁移形态：全 slope_run 步、to_height 已删（终端标高由末步落点派生）。
    assert.ok(route.via.length > 0 && route.via.every((step) => !('x' in step) && step.kind === 'slope_run'),
      `${id}: via must be all slope_run, got ${JSON.stringify(route.via)}`);
    assert.equal(route.to_height, undefined, `${id}: to_height must be deleted (terminal height derives from the last slope_run landing)`);
    assertDrainRouteInvariants(entry, project, id);
  }
});

test('C1：客卫支管越过终点的折回段原样保留，终端标高由 1% 坡派生', () => {
  const route = project.routes.find((item) => item.id === 'drain-guest-bath')!;
  const entry = resolveMepRoutes(project, realSources).routes.find((item) => item.route.id === 'drain-guest-bath')!;
  assert.deepEqual(entry.unresolved, []);
  // via 第 2 步仍冲到其声明 z 再折回终点 z，不得“修顺”：拐点 z 须为该步声明 to。
  const overshoot = (route.via as Array<{ kind?: string; to?: unknown }>)[1]!.to;
  assert.ok(typeof overshoot === 'number', 'drain-guest-bath 第 2 步须声明数字 overshoot z');
  assert.ok(Math.abs(entry.viaPoints[1].z - overshoot) <= TOL, `overshoot corner z ${entry.viaPoints[1].z} !== 声明值 ${overshoot}`);
  // 终端标高 = from_height − 坡度×行程（旧 to_height 0.02 已删，差值在容差内）。
  const terminal = entry.points[entry.points.length - 1];
  assert.ok(Math.abs(terminal.y! - (route.from_height! - route.slope! * planLength(entry.points))) <= TOL,
    `terminal y ${terminal.y} 须为 from_height − 坡度×行程`);
});

test('留绝对钉死：3 条带 via 路由坡度链与 1% 派生差超容差，不得强行 slope_run', () => {
  // drain-kitchen-requirement：中段 0.2m 落 0.0075m（3.75%），1% 派生差 0.0055m；
  // drain-mbath-vanity-to-riser：2026-11-27 干湿分离放弃重画（洗手台移入主卫内、贴东墙北段）：
  // 单 via (0.3,0.425,0.535)，自 drain_mbath_vanity (2.84,0.535) 西行 2.54m 再南行 0.765m、
  // 总行程 3.305m；1% 坡回算 via y = 0.45−0.025 = 0.425、终端 0.45−0.03305 = 0.41695≈0.417
  // （声明 to_height 0.417）。2026-11-27 自家设计走一轮：墙排中心 0.35→0.45，
  // via y 0.325→0.425、to_height 0.317→0.417——改高度是设计改动，钉死值同步更新；
  // 仍不得改 slope_run（本条 1% 派生与绝对值差超容差，见上）。
  // 旧双 via（手写取整 0.35→0.34→0.33）随旧布局作废。
  // drain-gbath-vanity-to-riser：2026-11-27 立管改至照片位 (7.38,1.48) 后重画为东行+北行，
  // 单 via (7.38,3.64,0.296)，1% 派生终端 0.27485，声明 to_height 0.275（差 0.00015m）。
  // 数值依据见本批 PR 描述；改高度是设计改动，不是迁移。
  const stayAbsolute: Record<string, { via: Array<[number, number, number]>; toHeight: number }> = {
    'drain-kitchen-requirement': { via: [[8.6, 0.029, 0.3], [8.6, 0.0215, 0.5]], toHeight: 0.005 },
    'drain-mbath-vanity-to-riser': { via: [[0.3, 0.425, 0.535]], toHeight: 0.417 },
    'drain-gbath-vanity-to-riser': { via: [[7.38, 0.296, 3.64]], toHeight: 0.275 },
  };
  for (const [id, pinned] of Object.entries(stayAbsolute)) {
    const route = project.routes.find((item) => item.id === id)!;
    assert.ok(route.via.every((step) => 'x' in step), `${id}: via must stay absolute coordinates`);
    assert.deepEqual(
      route.via.map((step) => [step.x, step.y, step.z]),
      pinned.via,
      `${id}: absolute via must be untouched`,
    );
    assert.equal(route.to_height, pinned.toHeight, `${id}: to_height must be untouched`);
  }
  const noVia = ['drain-balcony', 'drain-kitchen-sink-to-riser', 'drain-kitchen-dishwasher-to-riser', 'drain-balcony-floor-to-riser'];
  for (const id of noVia) {
    const route = project.routes.find((item) => item.id === id)!;
    assert.deepEqual(route.via, [], `${id}: no via — endpoint-driven, nothing to migrate`);
  }
});

function sourcesWithMovedPlumbing(id: string, dx: number, dz: number): MepEndpointSources {
  const moved = (plumbing as unknown as Array<Record<string, unknown>>).map((point) => point.id === id
    ? { ...point, x: (point.x as number) + dx, z: (point.z as number) + dz }
    : point);
  return endpointSourcesFromFacts(
    { electrical, plumbing: moved as unknown as ProjectRenderFacts['plumbing'], ceiling, hvac },
    wallIndex,
    realMountHosts,
  );
}

test('C2：主卫干区地漏东移 0.20m，三条相关路由跟随、其余 14 条不动；复原则逐字节恢复', () => {
  const baseline = routePoints(resolveMepRoutes(project, realSources));
  const moved = routePoints(resolveMepRoutes(project, sourcesWithMovedPlumbing('drain_mbath_floor', 0.20, 0)));
  // 地漏基线位置从 plumbing 声明读，移动后位置 = 基线 + 本测试注入的位移。
  // drain-master-bath 的起点是淋浴地漏（不动），只有终端跟随。
  const drainBase = (plumbing as unknown as Array<{ id: string; x: number; z: number }>).find((p) => p.id === 'drain_mbath_floor')!;
  const drainMoved = { x: drainBase.x + 0.20, z: drainBase.z };
  const followers = ['drain-master-bath', 'drain-mbath-floor-to-riser', 'drain-mbath-secondary-requirement'];
  for (const id of followers) {
    assertFollowsMove(baseline[id], moved[id], project.routes.find((item) => item.id === id)!, 'drain_mbath_floor', drainMoved, id);
  }
  for (const id of DRAIN_IDS.filter((item) => !followers.includes(item))) {
    assert.equal(moved[id], baseline[id], `${id} must not move`);
  }
  const restored = routePoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2：客卫干区地漏北移 −0.20m，客卫支管与地漏支路跟随、其余不动；复原则逐字节恢复', () => {
  const baseline = routePoints(resolveMepRoutes(project, realSources));
  const moved = routePoints(resolveMepRoutes(project, sourcesWithMovedPlumbing('drain_gbath_floor', 0, -0.20)));
  const drainBase = (plumbing as unknown as Array<{ id: string; x: number; z: number }>).find((p) => p.id === 'drain_gbath_floor')!;
  const drainMoved = { x: drainBase.x, z: drainBase.z - 0.20 };
  const followers = ['drain-guest-bath', 'drain-gbath-floor-to-riser'];
  for (const id of followers) {
    assertFollowsMove(baseline[id], moved[id], project.routes.find((item) => item.id === id)!, 'drain_gbath_floor', drainMoved, id);
  }
  for (const id of DRAIN_IDS.filter((item) => !followers.includes(item))) {
    assert.equal(moved[id], baseline[id], `${id} must not move`);
  }
  const restored = routePoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2：主卫立管双轴移动（x +0.10 / z +0.10），三条立管支路跟随、其余不动；复原则逐字节恢复', () => {
  // PR #234 major 根治：中间步字面坐标改 to:'to' 后，立管沿另一轴移动不再断路。
  // 旧行为（复现见 tmp/repro-234-major.ts）：x +0.10 时马桶/地漏支路、z +0.10 时淋浴支路
  // 均以“末步 slope_run 未落到 to 端点”显式失败、points=[]。
  const baseline = routePoints(resolveMepRoutes(project, realSources));
  const followers = ['drain-mbath-toilet-to-riser', 'drain-mbath-shower-to-riser', 'drain-mbath-floor-to-riser'];
  const expected: Record<string, { x: [number, number, number]; z: [number, number, number] }> = {
    // 终端标高 = from_height − 1% × 总行程（x 移：西/北段行程各变；z 移同理）。
    'drain-mbath-toilet-to-riser': { x: [0.4, 0.02095, 1.3], z: [0.3, 0.02095, 1.4] },
    'drain-mbath-shower-to-riser': { x: [0.4, 0.021, 1.3], z: [0.3, 0.021, 1.4] },
    'drain-mbath-floor-to-riser': { x: [0.4, 0.021, 1.3], z: [0.3, 0.019, 1.4] },
  };
  for (const [label, dx, dz] of [['x', 0.10, 0], ['z', 0, 0.10]] as const) {
    const moved = routePoints(resolveMepRoutes(project, sourcesWithMovedPlumbing('drain_riser_master_bath', dx, dz)));
    for (const id of followers) {
      const points = JSON.parse(moved[id]) as Array<{ x: number; y?: number; z: number }>;
      const terminal = points[points.length - 1];
      const [x, y, z] = expected[id][label];
      assert.ok(Math.abs(terminal.x - x) <= 1e-9 && Math.abs(terminal.y! - y) <= 1e-9 && Math.abs(terminal.z - z) <= 1e-9,
        `${id} riser ${label}-move terminal ${JSON.stringify(terminal)} !== (${x},${y},${z})`);
    }
    // 绝对台盆支路终端随立管走（to_height 声明 0.417 不变），中间字面 via 不动。
    const vanity = JSON.parse(moved['drain-mbath-vanity-to-riser']) as Array<{ x: number; y?: number; z: number }>;
    const vanityTerminal = vanity[vanity.length - 1];
    assert.ok(Math.abs(vanityTerminal.x - (0.3 + dx)) <= 1e-9 && Math.abs(vanityTerminal.y! - 0.417) <= 1e-9
      && Math.abs(vanityTerminal.z - (1.3 + dz)) <= 1e-9,
      `drain-mbath-vanity-to-riser terminal must follow the riser, got ${JSON.stringify(vanityTerminal)}`);
    for (const id of DRAIN_IDS.filter((item) => !followers.includes(item) && item !== 'drain-mbath-vanity-to-riser')) {
      assert.equal(moved[id], baseline[id], `${id} must not move on riser ${label}-move`);
    }
  }
  const restored = routePoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2：客卫立管双轴移动（x +0.10 / z −0.10），两条立管支路跟随、其余不动；复原则逐字节恢复', () => {
  // 2026-11-27 立管改至照片位 (7.38,1.48)：淋浴支路曼哈顿 2.05m（北 0.97+东 1.08），
  // 终端 0.0255−0.0205=0.005；地漏支路曼哈顿 2.50m（东 0.93+北 1.57），终端 0.033−0.025=0.008。
  // x 移 +0.10：两支路各 +0.10m 行程，终端各 −0.001；z 移 −0.10：同理。
  const baseline = routePoints(resolveMepRoutes(project, realSources));
  const followers = ['drain-gbath-shower-to-riser', 'drain-gbath-floor-to-riser'];
  const expected: Record<string, { x: [number, number, number]; z: [number, number, number] }> = {
    'drain-gbath-shower-to-riser': { x: [7.48, 0.004, 1.48], z: [7.38, 0.004, 1.38] },
    'drain-gbath-floor-to-riser': { x: [7.48, 0.007, 1.48], z: [7.38, 0.007, 1.38] },
  };
  for (const [label, dx, dz] of [['x', 0.10, 0], ['z', 0, -0.10]] as const) {
    const moved = routePoints(resolveMepRoutes(project, sourcesWithMovedPlumbing('drain_riser_guest_bath', dx, dz)));
    for (const id of followers) {
      const points = JSON.parse(moved[id]) as Array<{ x: number; y?: number; z: number }>;
      const terminal = points[points.length - 1];
      const [x, y, z] = expected[id][label];
      assert.ok(Math.abs(terminal.x - x) <= 1e-9 && Math.abs(terminal.y! - y) <= 1e-9 && Math.abs(terminal.z - z) <= 1e-9,
        `${id} riser ${label}-move terminal ${JSON.stringify(terminal)} !== (${x},${y},${z})`);
    }
    const vanity = JSON.parse(moved['drain-gbath-vanity-to-riser']) as Array<{ x: number; y?: number; z: number }>;
    const vanityTerminal = vanity[vanity.length - 1];
    assert.ok(Math.abs(vanityTerminal.x - (7.38 + dx)) <= 1e-9 && Math.abs(vanityTerminal.y! - 0.275) <= 1e-9
      && Math.abs(vanityTerminal.z - (1.48 + dz)) <= 1e-9,
      `drain-gbath-vanity-to-riser terminal must follow the riser, got ${JSON.stringify(vanityTerminal)}`);
    for (const id of DRAIN_IDS.filter((item) => !followers.includes(item) && item !== 'drain-gbath-vanity-to-riser')) {
      assert.equal(moved[id], baseline[id], `${id} must not move on riser ${label}-move`);
    }
  }
  const restored = routePoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2：零行程落点——客卫支管终端移到折回点 z=3.25、主卫马桶立管移到 from.z，路由照常解出', () => {
  // 零行程落点规则（二审修正）：to 步零行程仍输出落点（与上一落点重合的零长段，不改点数），
  // 终端即落点（复现见 tmp/repro-234-major.ts，未修前两例均显式失败：客卫支管报零行程，
  // 马桶支路报末步未落到 to 端点）。非移动方断言由上面两条立管双轴测试覆盖（同为立管/地漏 z 向移动），
  // 本测试只钉落点语义。
  const baseline = routePoints(resolveMepRoutes(project, realSources));
  // 客卫支管终端 z→3.25：末步 z→'to' 零行程仍输出重合落点，点数 5（from + 3 步 + to），
  // 终端标高 0.028 − 0.01×(0.15+0.80) = 0.0185。
  const movedGuest = routePoints(resolveMepRoutes(project, sourcesWithMovedPlumbing('drain_gbath_floor', 0, 0.20)));
  const guest = JSON.parse(movedGuest['drain-guest-bath']) as Array<{ x: number; y?: number; z: number }>;
  assert.equal(guest.length, 5, 'zero-run to step must still emit its landing point (point count invariant)');
  assert.deepEqual(
    { x: guest[3].x, y: guest[3].y, z: guest[3].z },
    { x: guest[2].x, y: guest[2].y, z: guest[2].z },
    'zero-run landing point must coincide with the previous point (zero-length leg)',
  );
  const guestTerminal = guest[guest.length - 1];
  assert.ok(Math.abs(guestTerminal.x - 6.45) <= 1e-9 && Math.abs(guestTerminal.y! - 0.0185) <= 1e-9
    && Math.abs(guestTerminal.z - 3.25) <= 1e-9,
    `drain-guest-bath terminal ${JSON.stringify(guestTerminal)} !== (6.45,0.0185,3.25)`);
  // 主卫马桶立管 z→1.5（= from.z）：末步 z→'to' 零行程仍输出重合落点，点数 4（from + 2 步 + to），
  // 终端标高 0.0417 − 0.01×1.975 = 0.02195。
  const movedToilet = routePoints(resolveMepRoutes(project, sourcesWithMovedPlumbing('drain_riser_master_bath', 0, 0.20)));
  const toilet = JSON.parse(movedToilet['drain-mbath-toilet-to-riser']) as Array<{ x: number; y?: number; z: number }>;
  assert.equal(toilet.length, 4, 'zero-run to step must still emit its landing point (point count invariant)');
  assert.deepEqual(
    { x: toilet[2].x, y: toilet[2].y, z: toilet[2].z },
    { x: toilet[1].x, y: toilet[1].y, z: toilet[1].z },
    'zero-run landing point must coincide with the previous point (zero-length leg)',
  );
  const toiletTerminal = toilet[toilet.length - 1];
  assert.ok(Math.abs(toiletTerminal.x - 0.3) <= 1e-9 && Math.abs(toiletTerminal.y! - 0.02195) <= 1e-9
    && Math.abs(toiletTerminal.z - 1.5) <= 1e-9,
    `drain-mbath-toilet-to-riser terminal ${JSON.stringify(toiletTerminal)} !== (0.3,0.02195,1.5)`);
  const restored = routePoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2b：立管移动 5cm 后算量仍含淋浴支路（to_index 不越界，管长只短 0.05m）', () => {
  // 二审 major 反例：客卫立管 z 2.40→2.45 时 drain-gbath-shower-to-riser 首步零行程；
  // 旧跳过规则下点数 4→3、to_index: 3 越界、整条路由掉出算量（drainageM 22.578→22.435m）。
  // 输出落点后点数仍为 4，算量下标有效，管长只短去零的 z 腿 0.05m。
  const movedSources = sourcesWithMovedPlumbing('drain_riser_guest_bath', 0, 0.05);
  const movedReport = resolveMepRoutes(project, movedSources);
  const shower = movedReport.routes.find((item) => item.route.id === 'drain-gbath-shower-to-riser')!;
  assert.deepEqual(shower.unresolved, []);
  assert.equal(shower.points.length, 4, 'point count must stay 4 so takeoff to_index: 3 stays in bounds');
  const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules;
  const topology = parseYaml(readFileSync('config/electrical-topology.yaml', 'utf8')) as {
    circuits: TakeoffCircuit[];
    controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
  };
  const takeoffInput = {
    electrical: electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
    circuits: topology.circuits,
    controls: topology.controls ?? [],
    routes: project.routes,
    rules,
  };
  const baseTakeoff = computeMepTakeoff({ ...takeoffInput, resolution: resolveMepRoutes(project, realSources) });
  const movedTakeoff = computeMepTakeoff({ ...takeoffInput, resolution: movedReport });
  assert.deepEqual(movedTakeoff.unresolved.map((item) => item.id), ['trunk_strong_main']);
  // 管长只短去真实缩短的部分：三条以该立管为终点的路由（淋浴/地漏/台盆支路，均单段声明 0→3）
  // 各自 3D 折线长的变化之和——由统一出口解出的 points 直接算，不抄生产实现。
  // 旧跳过规则下淋浴支路整条掉出算量，pipe.totalDrainageM 会多丢约 0.50m（整条支路长）。
  const polyline3d = (points: Array<{ x: number; y?: number; z: number }>): number => {
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      length += Math.hypot(
        points[i].x - points[i - 1].x,
        (points[i].y ?? 0) - (points[i - 1].y ?? 0),
        points[i].z - points[i - 1].z,
      );
    }
    return length;
  };
  const baseReport = resolveMepRoutes(project, realSources);
  let expectedDrop = 0;
  for (const id of ['drain-gbath-shower-to-riser', 'drain-gbath-floor-to-riser', 'drain-gbath-vanity-to-riser']) {
    const basePoints = baseReport.routes.find((item) => item.route.id === id)!.points;
    const movedPoints = movedReport.routes.find((item) => item.route.id === id)!.points;
    expectedDrop += polyline3d(basePoints) - polyline3d(movedPoints);
  }
  assert.ok(expectedDrop > 0 && expectedDrop < 0.2,
    `sanity: three riser routes must shorten by less than the move allows, got ${expectedDrop}`);
  // 管桶在汇总时乘损耗系数 units.loss.pipe（1.08，见 shared/mep-takeoff.ts:906-907），
  // 故管长变化 = 折线变化 × 该系数；不乘会把 0.143 误判成 0.155。
  const pipeLoss = rules.units?.loss?.pipe ?? 1;
  assert.ok(
    Math.abs((baseTakeoff.pipe.totalDrainageM - movedTakeoff.pipe.totalDrainageM) - expectedDrop * pipeLoss) <= 1e-9,
    `pipe.totalDrainageM must drop by exactly the shortened legs × loss (${expectedDrop * pipeLoss}): ${baseTakeoff.pipe.totalDrainageM} -> ${movedTakeoff.pipe.totalDrainageM}`,
  );
});

test('C3：DXF 与算量同读统一出口——DXF 无错且含 10 条迁移路由，算量未解仍只有 trunk_strong_main', () => {
  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const dxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(dxf.errors, []);
  for (const id of MIGRATED_IDS) assert.ok(dxf.dxf.includes(id), `DXF must export migrated route ${id}`);

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

test('C4：迁移路由坡度声明损坏 → lint 报 endpoint_unresolved、DXF 拒导且不导出该路线', () => {
  const corrupted = structuredClone(project);
  const master = corrupted.routes.find((route) => route.id === 'drain-master-bath')!;
  delete (master as Record<string, unknown>).slope;
  const corruptedResolution = resolveMepRoutes(corrupted, realSources);
  const entry = corruptedResolution.routes.find((item) => item.route.id === 'drain-master-bath')!;
  assert.deepEqual(entry.unresolved, ['via']);
  assert.deepEqual(entry.points, []);
  assert.match(entry.diagnostics.join('；'), /缺少有效 slope/);

  const lintResult = lintMepCoordination(corrupted, realSources);
  const masterErrors = lintResult.errors.filter((issue) => issue.routeId === 'drain-master-bath');
  assert.ok(masterErrors.some((issue) => issue.code === 'endpoint_unresolved' && issue.message.includes('缺少有效 slope')),
    `expected an endpoint_unresolved error for drain-master-bath, got ${JSON.stringify(masterErrors.map((issue) => issue.code))}`);

  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const healthyDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(healthyDxf.errors, []);
  assert.ok(healthyDxf.dxf.includes('drain-master-bath'), 'healthy DXF must export drain-master-bath');
  const corruptedDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: corrupted, sources: realSources }, labels: 'ascii' });
  assert.ok(corruptedDxf.errors.some((error) => error.includes('drain-master-bath')),
    `corrupted DXF must name the broken route, got ${JSON.stringify(corruptedDxf.errors)}`);
  assert.equal(corruptedDxf.dxf.includes('drain-master-bath'), false, 'corrupted DXF must not export the broken route');
});
