/**
 * Issue #98 二阶段 Stage 3 机制测试：两条沙发 MEP 路由的关系型 via。
 *
 * 全部用合成夹具（合成端点源 + 合成竖井声明），不读 config、不写真实 YAML。
 * 数值说明：前五个测试的竖井 (11.2, 2.98) 取审计建议值作合成测试值，只为行使
 * 求解器机制——R-S3 已裁定 Option 0（共享轴 x=10.74，见下），11.2 只是合成值，
 * 不是裁定结论。from_face_jog 测试用裁定值 (10.74, 2.98) 与真实落点 (10.80, 2.98)。
 * 机制本身（schema + 求解器 + 统一出口 + 兼容壳）由 Stage 1 落地；本文件补
 * Stage 3 验收所需的端到端覆盖：字符串端点经统一出口解算、两路由共用一口竖井、
 * 0.20m 移动实验（Stage 2 的移动量）、插座 x 向跟随、落点移动跟随与一致性门禁、
 * 面管下降（from_face_jog）拓扑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MepCoordinationSchema,
  resolveMepRoute,
  resolveMepRoutes,
  validateMepCoordination,
  type MepCoordination,
  type MepEndpointSources,
  type MepRoute,
} from '../../shared/mep-hvac-coordination-schema.js';
import type { ElectricalPoint } from '../../shared/types.js';

const LAYERS = Object.fromEntries(
  ['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air']
    .map((id) => [id, { label: id, color: '#fff', height: 2.55 }]),
);

/** 合成端点源：配电箱 + 两地插均为绝对点位（真实路由用字符串端点引用它们）。 */
function makeSources(panel: { x: number; z: number }, socketLz: number, socketRz: number, socketX = 11.0): MepEndpointSources {
  const points: ElectricalPoint[] = [
    { id: 'panel_strong_entry_left', room: 'living_dining', type: 'strong_panel', absolute: true, x: panel.x, z: panel.z, height: 1.65 },
    { id: 'sock_living_sofa_l', room: 'living_dining', type: 'floor_socket', absolute: true, x: socketX, z: socketLz, height: 0.02 },
    { id: 'sock_living_sofa_r', room: 'living_dining', type: 'floor_socket', absolute: true, x: socketX, z: socketRz, height: 0.02 },
  ];
  return { electrical: points, plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };
}

function sofaRoute(id: string, toId: string): MepRoute {
  return {
    id, layer: 'strong_power', status: 'inferred',
    source_status: 'proposed', construction_status: 'pending',
    method: 'floor_branch_candidate', diameter: 0.02,
    from_height: 1.65, to_height: 0.02,
    from: 'panel_strong_entry_left',
    to: toId,
    via: [
      { kind: 'from_drop', shaft: 'shaft_entry', y: 0.02 },
      { kind: 'shaft_corner', shaft: 'shaft_entry', y: 0.02 },
      { kind: 'shaft_run', shaft: 'shaft_entry', y: 0.02 },
    ],
  };
}

function testConfig(routes: MepRoute[], shafts: MepCoordination['shafts']): MepCoordination {
  return MepCoordinationSchema.parse({
    version: 'test', status: 'test', layers: LAYERS, routes, junctions: [], shafts,
  });
}

/** 连续两点必须正交（共享 x 或 z，容差 0.005m）——三步竖井走法的几何要求。 */
function assertOrthogonal(points: ReadonlyArray<{ x: number; z: number }>): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    assert.ok(
      Math.abs(a.x - b.x) <= 0.005 || Math.abs(a.z - b.z) <= 0.005,
      `第 ${i} 段不是正交段：(${a.x}, ${a.z}) → (${b.x}, ${b.z})`,
    );
  }
}

/** 平面折线长度（竖直段平面长 0，只计 x/z 移动）。 */
function planLength(points: ReadonlyArray<{ x: number; z: number }>): number {
  return points.slice(1).reduce((sum, point, index) => {
    const prev = points[index];
    return sum + Math.hypot(point.x - prev.x, point.z - prev.z);
  }, 0);
}

test('两沙发路由共用一口竖井声明：字符串端点经统一出口解算，全程正交，长度 3.73m / 7.03m', () => {
  const routes = [sofaRoute('strong-power-living-sofa-l', 'sock_living_sofa_l'), sofaRoute('strong-power-living-sofa-r', 'sock_living_sofa_r')];
  const config = testConfig(routes, [{ id: 'shaft_entry', x: 11.2, z: 2.98, y: 0.02 }]);
  assert.equal(config.shafts.length, 1, '两路由共用一口竖井声明');
  assert.doesNotThrow(() => validateMepCoordination(config, makeSources({ x: 10.74, z: 2.98 }, 6.05, 9.35)));
  const sources = makeSources({ x: 10.74, z: 2.98 }, 6.05, 9.35);
  const report = resolveMepRoutes(config, sources);
  assert.equal(report.resolved, 2);
  assert.deepEqual(report.diagnostics, []);
  const [l, r] = report.routes;
  assert.deepEqual(l.viaPoints, [
    { x: 10.74, y: 0.02, z: 2.98 },
    { x: 11.2, y: 0.02, z: 2.98 },
    { x: 11.2, y: 0.02, z: 6.05 },
  ]);
  assert.deepEqual(l.points, [
    { x: 10.74, y: 1.65, z: 2.98 },
    { x: 10.74, y: 0.02, z: 2.98 },
    { x: 11.2, y: 0.02, z: 2.98 },
    { x: 11.2, y: 0.02, z: 6.05 },
    { x: 11.0, y: 0.02, z: 6.05 },
  ]);
  assert.deepEqual(r.viaPoints, [
    { x: 10.74, y: 0.02, z: 2.98 },
    { x: 11.2, y: 0.02, z: 2.98 },
    { x: 11.2, y: 0.02, z: 9.35 },
  ]);
  assert.deepEqual(r.points, [
    { x: 10.74, y: 1.65, z: 2.98 },
    { x: 10.74, y: 0.02, z: 2.98 },
    { x: 11.2, y: 0.02, z: 2.98 },
    { x: 11.2, y: 0.02, z: 9.35 },
    { x: 11.0, y: 0.02, z: 9.35 },
  ]);
  assertOrthogonal(l.points);
  assertOrthogonal(r.points);
  // 平面长度：东折 0.46 + 南行 3.07/6.37 + 末 jog 0.20。
  assert.ok(Math.abs(planLength(l.points) - 3.73) < 1e-9, `sofa-l 平面长度应为 3.73m，实际 ${planLength(l.points)}`);
  assert.ok(Math.abs(planLength(r.points) - 7.03) < 1e-9, `sofa-r 平面长度应为 7.03m，实际 ${planLength(r.points)}`);
});

test('0.20m 移动实验（Stage 2 的移动量）：两地插各南移 0.20m，路由末端跟随，长度 3.93m / 7.23m', () => {
  const routes = [sofaRoute('strong-power-living-sofa-l', 'sock_living_sofa_l'), sofaRoute('strong-power-living-sofa-r', 'sock_living_sofa_r')];
  const config = testConfig(routes, [{ id: 'shaft_entry', x: 11.2, z: 2.98, y: 0.02 }]);
  const before = resolveMepRoutes(config, makeSources({ x: 10.74, z: 2.98 }, 6.05, 9.35));
  const after = resolveMepRoutes(config, makeSources({ x: 10.74, z: 2.98 }, 6.25, 9.55));
  assert.equal(after.resolved, 2);
  const [lBefore, rBefore] = before.routes;
  const [lAfter, rAfter] = after.routes;
  // 只有末端跟随：落点与拐点不动，南行段各长 0.20m。
  assert.deepEqual(lAfter.viaPoints.slice(0, 2), lBefore.viaPoints.slice(0, 2));
  assert.deepEqual(rAfter.viaPoints.slice(0, 2), rBefore.viaPoints.slice(0, 2));
  assert.equal(lAfter.viaPoints[2].z, 6.25);
  assert.equal(rAfter.viaPoints[2].z, 9.55);
  assert.equal(lAfter.points[lAfter.points.length - 1].z, 6.25);
  assert.equal(rAfter.points[rAfter.points.length - 1].z, 9.55);
  assertOrthogonal(lAfter.points);
  assertOrthogonal(rAfter.points);
  assert.ok(Math.abs(planLength(lAfter.points) - 3.93) < 1e-9, `sofa-l 移动后平面长度应为 3.93m，实际 ${planLength(lAfter.points)}`);
  assert.ok(Math.abs(planLength(rAfter.points) - 7.23) < 1e-9, `sofa-r 移动后平面长度应为 7.23m，实际 ${planLength(rAfter.points)}`);
});

test('插座 x 向移动：末 jog 长度跟随，南行段不动', () => {
  const routes = [sofaRoute('strong-power-living-sofa-l', 'sock_living_sofa_l')];
  const config = testConfig(routes, [{ id: 'shaft_entry', x: 11.2, z: 2.98, y: 0.02 }]);
  // 插座西移 0.20m：末 jog 0.20→0.40，南行段仍在竖井轴上。
  const west = resolveMepRoute(routes[0], makeSources({ x: 10.74, z: 2.98 }, 6.05, 9.35, 10.8), config.junctions, config.shafts);
  assert.deepEqual(west.unresolved, []);
  assert.deepEqual(west.viaPoints[2], { x: 11.2, y: 0.02, z: 6.05 });
  assert.equal(west.points[west.points.length - 1].x, 10.8);
  assert.ok(Math.abs(planLength(west.points) - 3.93) < 1e-9, `插座西移后平面长度应为 3.93m，实际 ${planLength(west.points)}`);
  assertOrthogonal(west.points);
  // 插座东移至竖井轴东侧 0.20m：末 jog 反向（东行 0.20m），仍正交。
  const east = resolveMepRoute(routes[0], makeSources({ x: 10.74, z: 2.98 }, 6.05, 9.35, 11.4), config.junctions, config.shafts);
  assert.deepEqual(east.unresolved, []);
  assert.deepEqual(east.viaPoints[2], { x: 11.2, y: 0.02, z: 6.05 });
  assert.equal(east.points[east.points.length - 1].x, 11.4);
  assert.ok(Math.abs(planLength(east.points) - 3.73) < 1e-9, `插座东移后平面长度应为 3.73m（末 jog 仍 0.20m，只是反向），实际 ${planLength(east.points)}`);
  assertOrthogonal(east.points);
});

test('落点移动跟随：配电箱 z 移动时拐点跟随；竖井 z 不跟则 fail-closed', () => {
  const routes = [sofaRoute('strong-power-living-sofa-l', 'sock_living_sofa_l')];
  const config = testConfig(routes, [{ id: 'shaft_entry', x: 11.2, z: 2.98, y: 0.02 }]);
  // 只动落点 z（2.98→3.10），竖井 z 不动：差 0.12m > 0.005m，fail-closed。
  const stale = resolveMepRoute(routes[0], makeSources({ x: 10.74, z: 3.10 }, 6.05, 9.35), config.junctions, config.shafts);
  assert.deepEqual(stale.unresolved, ['via']);
  assert.deepEqual(stale.points, []);
  assert.match(stale.diagnostics[0], /差 0\.120m，超过 0\.005m/);
  // 落点 z 与竖井 z 同移至 3.10：拐点 z 跟随，南行段 3.10→6.05（2.95m）。
  const moved = testConfig(routes, [{ id: 'shaft_entry', x: 11.2, z: 3.10, y: 0.02 }]);
  const resolved = resolveMepRoute(routes[0], makeSources({ x: 10.74, z: 3.10 }, 6.05, 9.35), moved.junctions, moved.shafts);
  assert.deepEqual(resolved.unresolved, []);
  assert.deepEqual(resolved.viaPoints, [
    { x: 10.74, y: 0.02, z: 3.10 },
    { x: 11.2, y: 0.02, z: 3.10 },
    { x: 11.2, y: 0.02, z: 6.05 },
  ]);
  assertOrthogonal(resolved.points);
  assert.ok(Math.abs(planLength(resolved.points) - 3.61) < 1e-9, `落点移动后平面长度应为 3.61m，实际 ${planLength(resolved.points)}`);
});

test('R-S3 真实阻塞数值（字符串端点）：shaft.z=2.96 vs 解算落点 z=2.98，差 0.02m → fail-closed', () => {
  const routes = [sofaRoute('strong-power-living-sofa-l', 'sock_living_sofa_l')];
  const config = testConfig(routes, [{ id: 'shaft_entry', x: 11.2, z: 2.96, y: 0.02 }]);
  const resolved = resolveMepRoute(routes[0], makeSources({ x: 10.74, z: 2.98 }, 6.05, 9.35), config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, ['via']);
  assert.deepEqual(resolved.points, []);
  assert.deepEqual(resolved.viaPoints, []);
  assert.equal(resolved.diagnostics.length, 1);
  assert.match(resolved.diagnostics[0], /差 0\.020m，超过 0\.005m/);
  // 校验一致：一致性门禁以解算落点 z 为准，不是声明值——落点来自字符串端点解算。
  assert.match(resolved.diagnostics[0], /from z=2\.98/);
});

/** 面管下降拓扑（R-S3 裁定 Option 0）：箱底先横移至竖井轴，再竖降、南行、横接入地插。 */
function facePipeRoute(id: string, toId: string): MepRoute {
  return {
    id, layer: 'strong_power', status: 'inferred',
    source_status: 'proposed', construction_status: 'pending',
    method: 'floor_branch_candidate', diameter: 0.02,
    from_height: 1.65, to_height: 0.02,
    from: 'panel_strong_entry_left',
    to: toId,
    // 高度不重复声明：横移步取 from_height（1.65），其余步取竖井高度（shaft.y=0.02）。
    via: [
      { kind: 'from_face_jog', shaft: 'shaft_entry' },
      { kind: 'from_drop', shaft: 'shaft_entry' },
      { kind: 'shaft_run', shaft: 'shaft_entry' },
    ],
  };
}

/** 三维折线长度（竖直段计入，只计 x/y/z 移动）。 */
function length3d(points: ReadonlyArray<{ x: number; y?: number; z: number }>): number {
  return points.slice(1).reduce((sum, point, index) => {
    const prev = points[index];
    return sum + Math.hypot(point.x - prev.x, (point.y ?? 0) - (prev.y ?? 0), point.z - prev.z);
  }, 0);
}

test('面管下降（from_face_jog）：箱底横移 0.06m 至竖井轴再竖降，折线与裁定几何一致，长度 3.39m / 6.69m、3D 5.02m / 8.32m', () => {
  const routes = [facePipeRoute('strong-power-living-sofa-l', 'sock_living_sofa_l'), facePipeRoute('strong-power-living-sofa-r', 'sock_living_sofa_r')];
  // 裁定竖井 (10.74, 2.98, 0.02)；落点取真实解算值 (10.80, 2.98)——墙线点，非面点。
  const config = testConfig(routes, [{ id: 'shaft_entry', x: 10.74, z: 2.98, y: 0.02 }]);
  assert.doesNotThrow(() => validateMepCoordination(config, makeSources({ x: 10.8, z: 2.98 }, 6.05, 9.35)));
  const report = resolveMepRoutes(config, makeSources({ x: 10.8, z: 2.98 }, 6.05, 9.35));
  assert.equal(report.resolved, 2);
  assert.deepEqual(report.diagnostics, []);
  const [l, r] = report.routes;
  assert.deepEqual(l.viaPoints, [
    { x: 10.74, y: 1.65, z: 2.98 },
    { x: 10.74, y: 0.02, z: 2.98 },
    { x: 10.74, y: 0.02, z: 6.05 },
  ]);
  assert.deepEqual(l.points, [
    { x: 10.8, y: 1.65, z: 2.98 },
    { x: 10.74, y: 1.65, z: 2.98 },
    { x: 10.74, y: 0.02, z: 2.98 },
    { x: 10.74, y: 0.02, z: 6.05 },
    { x: 11.0, y: 0.02, z: 6.05 },
  ]);
  assert.deepEqual(r.points, [
    { x: 10.8, y: 1.65, z: 2.98 },
    { x: 10.74, y: 1.65, z: 2.98 },
    { x: 10.74, y: 0.02, z: 2.98 },
    { x: 10.74, y: 0.02, z: 9.35 },
    { x: 11.0, y: 0.02, z: 9.35 },
  ]);
  assertOrthogonal(l.points);
  assertOrthogonal(r.points);
  assert.ok(Math.abs(planLength(l.points) - 3.39) < 1e-9, `sofa-l 平面长度应为 3.39m，实际 ${planLength(l.points)}`);
  assert.ok(Math.abs(planLength(r.points) - 6.69) < 1e-9, `sofa-r 平面长度应为 6.69m，实际 ${planLength(r.points)}`);
  assert.ok(Math.abs(length3d(l.points) - 5.02) < 1e-9, `sofa-l 三维长度应为 5.02m，实际 ${length3d(l.points)}`);
  assert.ok(Math.abs(length3d(r.points) - 8.32) < 1e-9, `sofa-r 三维长度应为 8.32m，实际 ${length3d(r.points)}`);
});

test('from_face_jog 高度取 from_height、不取竖井高度；步内 y 声明可覆盖', () => {
  const routes = [facePipeRoute('strong-power-living-sofa-l', 'sock_living_sofa_l')];
  const config = testConfig(routes, [{ id: 'shaft_entry', x: 10.74, z: 2.98, y: 0.02 }]);
  const resolved = resolveMepRoute(routes[0], makeSources({ x: 10.8, z: 2.98 }, 6.05, 9.35), config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, []);
  // 横移点 y=1.65（from_height），不是竖井高度 0.02。
  assert.equal(resolved.viaPoints[0].y, 1.65);
  assert.equal(resolved.viaPoints[1].y, 0.02);
  // 步内 y 覆盖：横移步显式 y=1.20 时取 1.20，其余步不动。
  const override = { ...routes[0], via: [{ kind: 'from_face_jog', shaft: 'shaft_entry', y: 1.2 }, { kind: 'from_drop', shaft: 'shaft_entry' }, { kind: 'shaft_run', shaft: 'shaft_entry' }] } as MepRoute;
  const overridden = resolveMepRoute(override, makeSources({ x: 10.8, z: 2.98 }, 6.05, 9.35), config.junctions, config.shafts);
  assert.deepEqual(overridden.unresolved, []);
  assert.equal(overridden.viaPoints[0].y, 1.2);
  assert.equal(overridden.viaPoints[0].x, 10.74);
  assert.equal(overridden.points[0].y, 1.65);
});

test('顺序是裁定的一部分：旧三步（先竖降再平移）与面管下降折线不同点，from_drop 须在横移后当前位置竖降', () => {
  const shaft = [{ id: 'shaft_entry', x: 10.74, z: 2.98, y: 0.02 }];
  const sources = makeSources({ x: 10.8, z: 2.98 }, 6.05, 9.35);
  // 旧三步：from_drop 在 from.x=10.80 竖降，再在垫层平移 0.06m——长度相同，拐点顺序错。
  const oldWay = resolveMepRoute(sofaRoute('strong-power-living-sofa-l', 'sock_living_sofa_l'), sources, [], shaft);
  assert.deepEqual(oldWay.unresolved, []);
  assert.deepEqual(oldWay.points, [
    { x: 10.8, y: 1.65, z: 2.98 },
    { x: 10.8, y: 0.02, z: 2.98 },
    { x: 10.74, y: 0.02, z: 2.98 },
    { x: 10.74, y: 0.02, z: 6.05 },
    { x: 11.0, y: 0.02, z: 6.05 },
  ]);
  // 新三步：横移在先（y=1.65），竖降在 x=10.74。
  const newWay = resolveMepRoute(facePipeRoute('strong-power-living-sofa-l', 'sock_living_sofa_l'), sources, [], shaft);
  assert.deepEqual(newWay.unresolved, []);
  assert.deepEqual(newWay.points[1], { x: 10.74, y: 1.65, z: 2.98 });
  assert.deepEqual(newWay.points[2], { x: 10.74, y: 0.02, z: 2.98 });
  // 两条折线第 2、3 点不同（顺序不同），其余点与长度相同——新步不是摆设。
  assert.notDeepEqual(newWay.points, oldWay.points);
  assert.ok(Math.abs(planLength(newWay.points) - planLength(oldWay.points)) < 1e-9);
  assert.ok(Math.abs(length3d(newWay.points) - length3d(oldWay.points)) < 1e-9);
});

test('from_face_jog fail-closed：未知竖井与竖井 z 不一致都整路由失败，不出局部几何', () => {
  const routes = [facePipeRoute('strong-power-living-sofa-l', 'sock_living_sofa_l')];
  const sources = makeSources({ x: 10.8, z: 2.98 }, 6.05, 9.35);
  // 竖井表缺失：横移步断引用。
  const noShaft = resolveMepRoute(routes[0], sources, [], []);
  assert.deepEqual(noShaft.unresolved, ['via']);
  assert.deepEqual(noShaft.points, []);
  assert.match(noShaft.diagnostics[0], /引用未知竖井 "shaft_entry"/);
  // 竖井 z=2.96 与落点 z=2.98 差 0.02m：一致性门禁同样拦住新步。
  const staleShaft = testConfig(routes, [{ id: 'shaft_entry', x: 10.74, z: 2.96, y: 0.02 }]);
  const stale = resolveMepRoute(routes[0], sources, staleShaft.junctions, staleShaft.shafts);
  assert.deepEqual(stale.unresolved, ['via']);
  assert.deepEqual(stale.points, []);
  assert.match(stale.diagnostics[0], /差 0\.020m，超过 0\.005m/);
  // from 端点断引用：横移步无起点，from 与 via 同失败。
  const brokenFrom = { ...routes[0], from: 'panel_strong_entry_left_missing' } as MepRoute;
  const config = testConfig(routes, [{ id: 'shaft_entry', x: 10.74, z: 2.98, y: 0.02 }]);
  const broken = resolveMepRoute(brokenFrom, sources, config.junctions, config.shafts);
  assert.ok(broken.unresolved.includes('from'));
  assert.ok(broken.unresolved.includes('via'));
  assert.deepEqual(broken.points, []);
});
