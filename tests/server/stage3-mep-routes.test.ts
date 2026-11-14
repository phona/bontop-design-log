/**
 * Issue #98 二阶段 Stage 3 机制测试：两条沙发 MEP 路由的关系型 via。
 *
 * 全部用合成夹具（合成端点源 + 合成竖井声明），不读 config、不写真实 YAML。
 * 数值说明：竖井 (11.2, 2.98) 与端点 (10.74, 2.98)/(11.0, 6.05/9.35) 取审计建议值
 * 作合成测试值，只为行使求解器机制——R-S3 未裁定，这些数值不是裁定结论，
 * 真实竖井声明以裁定为准（见 §10.3 R-S3）。
 * 机制本身（schema + 求解器 + 统一出口 + 兼容壳）由 Stage 1 落地；本文件补
 * Stage 3 验收所需的端到端覆盖：字符串端点经统一出口解算、两路由共用一口竖井、
 * 0.20m 移动实验（Stage 2 的移动量）、插座 x 向跟随、落点移动跟随与一致性门禁。
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
