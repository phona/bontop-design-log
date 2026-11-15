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
 * 已由 tests/server/mep-slope-run.test.ts 覆盖，本文件只钉本批的等价/传动/消费方对账。
 */

const TOL_M = 0.005;

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

/** merge-base（211831e8）解算器实测的逐点基线——字面量钉死，不取自迁移后配置。 */
const BASELINE: Record<string, Array<[number, number, number]>> = {
  'drain-master-bath': [[0.6, 0.0445, 2.2], [1.2, 0.0385, 2.2], [1.2, 0.028, 1.15], [2, 0.02, 1.15]],
  'drain-guest-bath': [[6.3, 0.028, 2.45], [6.45, 0.028, 2.45], [6.45, 0.02, 3.25], [6.45, 0.02, 3.05]],
  'drain-garden-requirement': [[13, 0.0265, 1.5], [11.5, 0.0115, 1.5], [10.85, 0.005, 1.5]],
  'drain-mbath-toilet-to-riser': [[2.275, 0.0417, 1.5], [0.3, 0.022, 1.5], [0.3, 0.02, 1.3]],
  'drain-mbath-shower-to-riser': [[0.6, 0.032, 2.2], [0.6, 0.023, 1.3], [0.3, 0.02, 1.3]],
  'drain-mbath-floor-to-riser': [[2, 0.0385, 1.15], [0.3, 0.0215, 1.15], [0.3, 0.02, 1.3]],
  'drain-gbath-shower-to-riser': [[6.3, 0.0255, 2.45], [6.3, 0.025, 2.4], [5.8, 0.02, 2.4]],
  'drain-gbath-floor-to-riser': [[6.45, 0.033, 3.05], [5.8, 0.0265, 3.05], [5.8, 0.02, 2.4]],
  'drain-mbath-secondary-requirement': [[2, 0.02, 1.15], [1.7, 0.017, 1.15], [1.4, 0.014, 1.15]],
  'drain-gbath-secondary-requirement': [[6.6, 0.02, 3.05], [6.6, 0.017, 2.75], [6.6, 0.014, 2.45]],
};
const MIGRATED_IDS = Object.keys(BASELINE);

function routePoints(report: ReturnType<typeof resolveMepRoutes>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of DRAIN_IDS) out[id] = JSON.stringify(report.routes.find((item) => item.route.id === id)!.points);
  return out;
}

function assertPointsClose(
  actual: ReadonlyArray<{ x: number; y?: number; z: number }>,
  expected: ReadonlyArray<[number, number, number]>,
  where: string,
): void {
  assert.equal(actual.length, expected.length, `${where}: point count ${actual.length} !== ${expected.length}`);
  for (let index = 0; index < expected.length; index += 1) {
    const [x, y, z] = expected[index];
    assert.ok(Math.abs(actual[index].x - x) <= TOL_M, `${where}[${index}].x ${actual[index].x} !== ${x}`);
    assert.ok(Math.abs((actual[index].y ?? NaN) - y) <= TOL_M, `${where}[${index}].y ${actual[index].y} !== ${y}`);
    assert.ok(Math.abs(actual[index].z - z) <= TOL_M, `${where}[${index}].z ${actual[index].z} !== ${z}`);
  }
}

function planLength(points: ReadonlyArray<{ x: number; z: number }>): number {
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.z - points[index].z), 0);
}

test('C1：10 条迁移路由逐点等价 vs merge-base 基线（容差 0.005m），末点为派生终端复点', () => {
  const report = resolveMepRoutes(project, realSources);
  assert.equal(report.unresolved, 0);
  for (const id of MIGRATED_IDS) {
    const route = project.routes.find((item) => item.id === id)!;
    const entry = report.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, [], `${id} must resolve`);
    // 迁移形态：全 slope_run 步、to_height 已删（终端标高由末步落点派生）。
    assert.ok(route.via.length > 0 && route.via.every((step) => !('x' in step) && step.kind === 'slope_run'),
      `${id}: via must be all slope_run, got ${JSON.stringify(route.via)}`);
    assert.equal(route.to_height, undefined, `${id}: to_height must be deleted (terminal height derives from the last slope_run landing)`);
    // 解算点 = 基线点 + 末尾一个与末步落点重合的派生终端点（与 slope_run 合成测试同口径）。
    assert.equal(entry.points.length, BASELINE[id].length + 1, `${id}: point count`);
    assertPointsClose(entry.points.slice(0, -1), BASELINE[id], id);
    const [landing, terminal] = entry.points.slice(-2);
    assert.deepEqual([terminal.x, terminal.y, terminal.z], [landing.x, landing.y, landing.z],
      `${id}: terminal point must duplicate the last slope_run landing`);
    assert.ok(Math.abs(planLength(entry.points) - planLength(BASELINE[id].map(([x, , z]) => ({ x, z })))) <= 1e-9,
      `${id}: plan length must not change`);
  }
});

test('C1：客卫支管越过终点的 z=3.25 折回段原样保留，终端派生 0.0165m', () => {
  const entry = resolveMepRoutes(project, realSources).routes.find((item) => item.route.id === 'drain-guest-bath')!;
  assert.deepEqual(entry.unresolved, []);
  // via 第 2 步仍冲到 z=3.25 再折回 z=3.05，不得“修顺”。
  assert.ok(Math.abs(entry.viaPoints[1].z - 3.25) <= 1e-9, `overshoot corner z ${entry.viaPoints[1].z} !== 3.25`);
  // 0.028 − 0.01×(0.15+0.80+0.20) = 0.0165（旧 to_height 0.02，差 0.0035m，在容差内）。
  const terminal = entry.points[entry.points.length - 1];
  assert.ok(Math.abs(terminal.y! - 0.0165) <= 1e-9, `terminal y ${terminal.y} !== 0.0165`);
});

test('留绝对钉死：3 条带 via 路由坡度链与 1% 派生差超容差，不得强行 slope_run', () => {
  // drain-kitchen-requirement：中段 0.2m 落 0.0075m（3.75%），1% 派生差 0.0055m；
  // drain-mbath-vanity-to-riser：手写取整 0.35→0.34→0.33，1% 派生终端差 0.01565m；
  // drain-gbath-vanity-to-riser：R01 立管接点下调 8mm，1% 派生终端差 0.008m。
  // 数值依据见本批 PR 描述；改高度是设计改动，不是迁移。
  const stayAbsolute: Record<string, { via: Array<[number, number, number]>; toHeight: number }> = {
    'drain-kitchen-requirement': { via: [[8.6, 0.029, 0.3], [8.6, 0.0215, 0.5]], toHeight: 0.005 },
    'drain-mbath-vanity-to-riser': { via: [[0.575, 0.34, 2.7], [0.3, 0.33, 2.7]], toHeight: 0.315 },
    'drain-gbath-vanity-to-riser': { via: [[6.9, 0.2885, 2.45], [5.8, 0.277, 2.45]], toHeight: 0.2695 },
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
  const followers: Record<string, { firstX: number; terminal: [number, number, number] }> = {
    // 终端/起点跟随地漏东移；行程各 +0.20m，1% 坡使标高各 −0.002m。
    // drain-master-bath 的起点是淋浴地漏（不动），只有终端跟随。
    'drain-master-bath': { firstX: 0.6, terminal: [2.2, 0.018, 1.15] },
    'drain-mbath-floor-to-riser': { firstX: 2.2, terminal: [0.3, 0.018, 1.3] },
    'drain-mbath-secondary-requirement': { firstX: 2.2, terminal: [1.4, 0.012, 1.15] },
  };
  for (const [id, expected] of Object.entries(followers)) {
    const points = JSON.parse(moved[id]) as Array<{ x: number; y?: number; z: number }>;
    assert.ok(Math.abs(points[0].x - expected.firstX) <= 1e-9, `${id}: first point x ${points[0].x} !== ${expected.firstX}`);
    const terminal = points[points.length - 1];
    const [x, y, z] = expected.terminal;
    assert.ok(Math.abs(terminal.x - x) <= 1e-9 && Math.abs(terminal.y! - y) <= 1e-9 && Math.abs(terminal.z - z) <= 1e-9,
      `${id}: terminal ${JSON.stringify(terminal)} !== (${x},${y},${z})`);
  }
  for (const id of DRAIN_IDS.filter((item) => !(item in followers))) {
    assert.equal(moved[id], baseline[id], `${id} must not move`);
  }
  const restored = routePoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2：客卫干区地漏北移 −0.20m，客卫支管与地漏支路跟随、其余不动；复原则逐字节恢复', () => {
  const baseline = routePoints(resolveMepRoutes(project, realSources));
  const moved = routePoints(resolveMepRoutes(project, sourcesWithMovedPlumbing('drain_gbath_floor', 0, -0.20)));
  const guestBath = JSON.parse(moved['drain-guest-bath']) as Array<{ x: number; y?: number; z: number }>;
  // 末步 z→'to' 落 (6.45,2.85)：0.028 − 0.01×(0.15+0.80+0.40) = 0.0145。
  const guestTerminal = guestBath[guestBath.length - 1];
  assert.ok(Math.abs(guestTerminal.x - 6.45) <= 1e-9 && Math.abs(guestTerminal.y! - 0.0145) <= 1e-9 && Math.abs(guestTerminal.z - 2.85) <= 1e-9,
    `drain-guest-bath terminal ${JSON.stringify(guestTerminal)} !== (6.45,0.0145,2.85)`);
  const floorRiser = JSON.parse(moved['drain-gbath-floor-to-riser']) as Array<{ x: number; y?: number; z: number }>;
  assert.ok(Math.abs(floorRiser[0].z - 2.85) <= 1e-9, 'drain-gbath-floor-to-riser start must follow the floor drain north');
  const floorTerminal = floorRiser[floorRiser.length - 1];
  // 起点北移后 z 向行程 0.65m→0.45m：0.033 − 0.0065 − 0.0045 = 0.022。
  assert.ok(Math.abs(floorTerminal.x - 5.8) <= 1e-9 && Math.abs(floorTerminal.y! - 0.022) <= 1e-9 && Math.abs(floorTerminal.z - 2.4) <= 1e-9,
    `drain-gbath-floor-to-riser terminal ${JSON.stringify(floorTerminal)} !== (5.8,0.022,2.4)`);
  for (const id of DRAIN_IDS.filter((item) => item !== 'drain-guest-bath' && item !== 'drain-gbath-floor-to-riser')) {
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
    // 绝对台盆支路终端随立管走（to_height 声明 0.315 不变），中间字面 via 不动。
    const vanity = JSON.parse(moved['drain-mbath-vanity-to-riser']) as Array<{ x: number; y?: number; z: number }>;
    const vanityTerminal = vanity[vanity.length - 1];
    assert.ok(Math.abs(vanityTerminal.x - (0.3 + dx)) <= 1e-9 && Math.abs(vanityTerminal.y! - 0.315) <= 1e-9
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
  const baseline = routePoints(resolveMepRoutes(project, realSources));
  const followers = ['drain-gbath-shower-to-riser', 'drain-gbath-floor-to-riser'];
  const expected: Record<string, { x: [number, number, number]; z: [number, number, number] }> = {
    'drain-gbath-shower-to-riser': { x: [5.9, 0.021, 2.4], z: [5.8, 0.019, 2.3] },
    'drain-gbath-floor-to-riser': { x: [5.9, 0.021, 2.4], z: [5.8, 0.019, 2.3] },
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
    assert.ok(Math.abs(vanityTerminal.x - (5.8 + dx)) <= 1e-9 && Math.abs(vanityTerminal.y! - 0.2695) <= 1e-9
      && Math.abs(vanityTerminal.z - (2.4 + dz)) <= 1e-9,
      `drain-gbath-vanity-to-riser terminal must follow the riser, got ${JSON.stringify(vanityTerminal)}`);
    for (const id of DRAIN_IDS.filter((item) => !followers.includes(item) && item !== 'drain-gbath-vanity-to-riser')) {
      assert.equal(moved[id], baseline[id], `${id} must not move on riser ${label}-move`);
    }
  }
  const restored = routePoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2：零行程落点——客卫支管终端移到折回点 z=3.25、主卫马桶立管移到 from.z，路由照常解出', () => {
  // 零行程落点规则：to 步零行程被跳过、不输出重合点，终端即落点（复现见 tmp/repro-234-major.ts，
  // 未修前两例均显式失败：客卫支管报零行程，马桶支路报末步未落到 to 端点）。
  // 非移动方断言由上面两条立管双轴测试覆盖（同为立管/地漏 z 向移动），本测试只钉落点语义。
  const baseline = routePoints(resolveMepRoutes(project, realSources));
  // 客卫支管终端 z→3.25：末步 z→'to' 零行程被跳过，终端标高 0.028 − 0.01×(0.15+0.80) = 0.0185。
  const movedGuest = routePoints(resolveMepRoutes(project, sourcesWithMovedPlumbing('drain_gbath_floor', 0, 0.20)));
  const guest = JSON.parse(movedGuest['drain-guest-bath']) as Array<{ x: number; y?: number; z: number }>;
  assert.equal(guest.length, 4, 'skipped zero-run step must not emit a duplicate point');
  const guestTerminal = guest[guest.length - 1];
  assert.ok(Math.abs(guestTerminal.x - 6.45) <= 1e-9 && Math.abs(guestTerminal.y! - 0.0185) <= 1e-9
    && Math.abs(guestTerminal.z - 3.25) <= 1e-9,
    `drain-guest-bath terminal ${JSON.stringify(guestTerminal)} !== (6.45,0.0185,3.25)`);
  // 主卫马桶立管 z→1.5（= from.z）：末步 z→'to' 零行程被跳过，终端标高 0.0417 − 0.01×1.975 = 0.02195。
  const movedToilet = routePoints(resolveMepRoutes(project, sourcesWithMovedPlumbing('drain_riser_master_bath', 0, 0.20)));
  const toilet = JSON.parse(movedToilet['drain-mbath-toilet-to-riser']) as Array<{ x: number; y?: number; z: number }>;
  assert.equal(toilet.length, 3, 'skipped zero-run step must not emit a duplicate point');
  const toiletTerminal = toilet[toilet.length - 1];
  assert.ok(Math.abs(toiletTerminal.x - 0.3) <= 1e-9 && Math.abs(toiletTerminal.y! - 0.02195) <= 1e-9
    && Math.abs(toiletTerminal.z - 1.5) <= 1e-9,
    `drain-mbath-toilet-to-riser terminal ${JSON.stringify(toiletTerminal)} !== (0.3,0.02195,1.5)`);
  const restored = routePoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
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
