/**
 * Issue #98 二阶段 Stage 1 机制测试（A7a）：统一 MEP 解算出口。
 *
 * 全部用合成夹具，不读 config。S3 阻塞的真实数值（shaft.z 2.96 vs from.z 2.98，
 * 差 0.02m）直接写进失败用例——这就是 Stage 3 仍被 R-S3 拦住的原因。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MepCoordinationSchema,
  isMepViaCoordinate,
  mepRoutePoints,
  resolveMepRoute,
  resolveMepRoutes,
  validateMepCoordination,
  type MepCoordination,
  type MepEndpointSources,
  type MepRoute,
} from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination } from '../../shared/mep-hvac-lint.js';

const LAYERS = Object.fromEntries(
  ['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air']
    .map((id) => [id, { label: id, color: '#fff', height: 2.55 }]),
);

function testConfig(routes: MepRoute[], shafts: MepCoordination['shafts'] = []): MepCoordination {
  return MepCoordinationSchema.parse({
    version: 'test', status: 'test', layers: LAYERS, routes, junctions: [], shafts,
  });
}

const EMPTY_SOURCES: MepEndpointSources = {
  electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [],
};

function makeRoute(overrides: Partial<MepRoute>): MepRoute {
  return {
    id: 'r1', layer: 'strong_power', status: 'confirmed',
    source_status: 'plan_supported', construction_status: 'pending',
    from: { x: 10, y: 2.55, z: 5 },
    to: { x: 12, y: 2.55, z: 5 },
    via: [{ x: 11, y: 2.55, z: 5 }],
    ...overrides,
  };
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

test('绝对 via：统一出口与旧 mepRoutePoints 同值，viaPoints = 声明 via', () => {
  const route = makeRoute({});
  const config = testConfig([route]);
  const resolved = resolveMepRoute(route, EMPTY_SOURCES, config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, []);
  assert.deepEqual(resolved.diagnostics, []);
  assert.deepEqual(resolved.viaPoints, [{ x: 11, y: 2.55, z: 5 }]);
  assert.deepEqual(resolved.points, [
    { x: 10, y: 2.55, z: 5 },
    { x: 11, y: 2.55, z: 5 },
    { x: 12, y: 2.55, z: 5 },
  ]);
  // 兼容壳只对纯绝对 via 生效，输出与统一出口同值。
  assert.deepEqual(
    mepRoutePoints(route, { x: 10, y: 2.55, z: 5 }, { x: 12, y: 2.55, z: 5 }),
    resolved.points,
  );
  // 统一出口的纯投影形式。
  assert.deepEqual(mepRoutePoints(resolved), resolved.points);
});

test('关系 via 三步走法：from_drop → shaft_corner → shaft_run，全程正交，shaft.y 默认、step.y 覆盖', () => {
  const route = makeRoute({
    id: 'r-shaft',
    from: { x: 10.74, y: 2.98, z: 2.963 },
    to: { x: 11.2, y: 2.6, z: 4.0 },
    via: [
      { kind: 'from_drop', shaft: 'sh1' },
      { kind: 'shaft_corner', shaft: 'sh1' },
      { kind: 'shaft_run', shaft: 'sh1', y: 2.62 },
    ],
  });
  const config = testConfig([route], [{ id: 'sh1', x: 11.2, z: 2.96, y: 2.6 }]);
  const resolved = resolveMepRoute(route, EMPTY_SOURCES, config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, []);
  assert.deepEqual(resolved.diagnostics, []);
  // from_drop 取 from 平面位置、shaft 高；corner 取垂线交点；run 取竖井 x + 终点 z、step.y 覆盖 shaft.y。
  assert.deepEqual(resolved.viaPoints, [
    { x: 10.74, y: 2.6, z: 2.963 },
    { x: 11.2, y: 2.6, z: 2.963 },
    { x: 11.2, y: 2.62, z: 4.0 },
  ]);
  assert.deepEqual(resolved.points, [
    { x: 10.74, y: 2.98, z: 2.963 },
    { x: 10.74, y: 2.6, z: 2.963 },
    { x: 11.2, y: 2.6, z: 2.963 },
    { x: 11.2, y: 2.62, z: 4.0 },
    { x: 11.2, y: 2.6, z: 4.0 },
  ]);
  assertOrthogonal(resolved.points);
});

test('S3 真实阻塞数值：|shaft.z − from.z| = 0.02m > 0.005m → via 未解出、整条路由 fail-closed', () => {
  const route = makeRoute({
    id: 'r-s3',
    from: { x: 10.74, y: 2.98, z: 2.98 },
    to: { x: 11.2, y: 2.6, z: 4.0 },
    via: [
      { kind: 'from_drop', shaft: 'sh1' },
      { kind: 'shaft_corner', shaft: 'sh1' },
      { kind: 'shaft_run', shaft: 'sh1' },
    ],
  });
  const config = testConfig([route], [{ id: 'sh1', x: 11.2, z: 2.96, y: 2.6 }]);
  const resolved = resolveMepRoute(route, EMPTY_SOURCES, config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, ['via']);
  assert.deepEqual(resolved.points, []);
  assert.deepEqual(resolved.viaPoints, []);
  assert.equal(resolved.diagnostics.length, 1);
  assert.match(resolved.diagnostics[0], /差 0\.020m，超过 0\.005m/);
});

test('关系 via 引用未知竖井 → via 未解出；validate 显式拦下；兼容壳拒收关系 via', () => {
  const route = makeRoute({
    id: 'r-missing',
    via: [{ kind: 'from_drop', shaft: 'no-such-shaft' }],
  });
  const config = testConfig([route], [{ id: 'sh1', x: 11.2, z: 2.96, y: 2.6 }]);
  const resolved = resolveMepRoute(route, EMPTY_SOURCES, config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, ['via']);
  assert.deepEqual(resolved.points, []);
  assert.match(resolved.diagnostics[0], /未知竖井 "no-such-shaft"/);
  assert.throws(() => validateMepCoordination(config, EMPTY_SOURCES), /未知竖井 "no-such-shaft"/);
  assert.throws(
    () => mepRoutePoints(route, { x: 10, y: 2.55, z: 5 }, { x: 12, y: 2.55, z: 5 }),
    /统一出口/,
  );
});

test('端点未解出：from 失败仍保留绝对 via 点，但 points 为空（不输出半条路）', () => {
  const route = makeRoute({ id: 'r-from', from: 'missing-point' });
  const config = testConfig([route]);
  const resolved = resolveMepRoute(route, EMPTY_SOURCES, config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, ['from']);
  assert.deepEqual(resolved.points, []);
  assert.deepEqual(resolved.viaPoints, [{ x: 11, y: 2.55, z: 5 }]);
  assert.match(resolved.diagnostics[0], /from endpoint is unresolved/);
});

test('resolveMepRoutes 汇总：一好一坏，计数与 diagnostics 汇总一致', () => {
  const good = makeRoute({ id: 'r-good' });
  const bad = makeRoute({
    id: 'r-bad',
    from: { x: 10.74, y: 2.98, z: 2.98 },
    via: [
      { kind: 'from_drop', shaft: 'sh1' },
      { kind: 'shaft_corner', shaft: 'sh1' },
      { kind: 'shaft_run', shaft: 'sh1' },
    ],
  });
  const config = testConfig([good, bad], [{ id: 'sh1', x: 11.2, z: 2.96, y: 2.6 }]);
  const report = resolveMepRoutes(config, EMPTY_SOURCES);
  assert.equal(report.total, 2);
  assert.equal(report.resolved, 1);
  assert.equal(report.unresolved, 1);
  assert.equal(report.diagnostics.length, 1);
  assert.match(report.diagnostics[0], /r-bad/);
});

test('lint：via 未解出的路由报 endpoint_unresolved，几何段跳过（不因空 points 崩溃）', () => {
  const bad = makeRoute({
    id: 'r-s3',
    from: { x: 10.74, y: 2.98, z: 2.98 },
    to: { x: 11.2, y: 2.6, z: 4.0 },
    via: [
      { kind: 'from_drop', shaft: 'sh1' },
      { kind: 'shaft_corner', shaft: 'sh1' },
      { kind: 'shaft_run', shaft: 'sh1' },
    ],
  });
  const config = testConfig([bad], [{ id: 'sh1', x: 11.2, z: 2.96, y: 2.6 }]);
  const result = lintMepCoordination(config, EMPTY_SOURCES);
  const viaError = result.errors.find(
    (issue) => issue.code === 'endpoint_unresolved' && issue.routeId === 'r-s3',
  );
  assert.ok(viaError, 'via 未解出必须以 endpoint_unresolved 报错');
  assert.match(viaError!.message, /via is unresolved/);
  // 几何段因 points 为空被跳过：不应出现 route_not_orthogonal 之类的几何误报。
  assert.equal(
    result.errors.filter((issue) => issue.routeId === 'r-s3' && issue.code === 'route_not_orthogonal').length,
    0,
  );
});

test('validate：竖井 id 重复显式拦下；isMepViaCoordinate 区分绝对点与关系步', () => {
  const config = testConfig([], [
    { id: 'sh1', x: 11.2, z: 2.96, y: 2.6 },
    { id: 'sh1', x: 11.2, z: 2.96, y: 2.6 },
  ]);
  assert.throws(() => validateMepCoordination(config, EMPTY_SOURCES), /Duplicate MEP shaft id/);
  assert.equal(isMepViaCoordinate({ x: 1, z: 2 }), true);
  assert.equal(isMepViaCoordinate({ kind: 'from_drop', shaft: 'sh1' }), false);
  assert.equal(isMepViaCoordinate({ x: 1, z: 2, y: 2.5 }), true);
});

test('shaft_run 语义修正：南行段沿竖井 x 走到终点 z（真实沙发地插拓扑 to.x != shaft.x，to.z != shaft.z）', () => {
  // 旧语义 shaft_run 取 (shaft.x, shaft.z) = (11.2, 2.98)：南行段在竖井 z 处就停了，
  // 终点 (11.0, 6.05) 只能靠一段斜线接回；新语义 run 走到 to.z，末 jog 才折向插座。
  const route = makeRoute({
    id: 'r-sofa',
    from: { x: 10.74, y: 2.98, z: 2.98 },
    to: { x: 11.0, y: 2.6, z: 6.05 },
    via: [
      { kind: 'from_drop', shaft: 'sh1' },
      { kind: 'shaft_corner', shaft: 'sh1' },
      { kind: 'shaft_run', shaft: 'sh1', y: 2.62 },
    ],
  });
  const config = testConfig([route], [{ id: 'sh1', x: 11.2, z: 2.98, y: 2.6 }]);
  const resolved = resolveMepRoute(route, EMPTY_SOURCES, config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, []);
  assert.deepEqual(resolved.diagnostics, []);
  assert.deepEqual(resolved.viaPoints, [
    { x: 10.74, y: 2.6, z: 2.98 },
    { x: 11.2, y: 2.6, z: 2.98 },
    { x: 11.2, y: 2.62, z: 6.05 },
  ]);
  assert.deepEqual(resolved.points, [
    { x: 10.74, y: 2.98, z: 2.98 },
    { x: 10.74, y: 2.6, z: 2.98 },
    { x: 11.2, y: 2.6, z: 2.98 },
    { x: 11.2, y: 2.62, z: 6.05 },
    { x: 11.0, y: 2.6, z: 6.05 },
  ]);
  assertOrthogonal(resolved.points);
  // 平面长度：0.46（东折）+ 3.07（南行）+ 0.20（末 jog）= 3.73m（from_drop 竖直段平面长 0）。
  const planLength = resolved.points.slice(1).reduce((sum, point, index) => {
    const prev = resolved.points[index];
    return sum + Math.hypot(point.x - prev.x, point.z - prev.z);
  }, 0);
  assert.ok(Math.abs(planLength - 3.73) < 1e-9, `平面长度应为 3.73m，实际 ${planLength}`);
});

test('shaft_run 终点跟随终点：to.z 移动，run 终点与平面长度同步移动', () => {
  const route = makeRoute({
    id: 'r-sofa-move',
    from: { x: 10.74, y: 2.98, z: 2.98 },
    to: { x: 11.0, y: 2.6, z: 6.55 },
    via: [
      { kind: 'from_drop', shaft: 'sh1' },
      { kind: 'shaft_corner', shaft: 'sh1' },
      { kind: 'shaft_run', shaft: 'sh1' },
    ],
  });
  const config = testConfig([route], [{ id: 'sh1', x: 11.2, z: 2.98, y: 2.6 }]);
  const resolved = resolveMepRoute(route, EMPTY_SOURCES, config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, []);
  assert.equal(resolved.viaPoints[2].z, 6.55);
  assert.equal(resolved.points[resolved.points.length - 1].z, 6.55);
  const planLength = resolved.points.slice(1).reduce((sum, point, index) => {
    const prev = resolved.points[index];
    return sum + Math.hypot(point.x - prev.x, point.z - prev.z);
  }, 0);
  assert.ok(Math.abs(planLength - 4.23) < 1e-9, `平面长度应为 4.23m，实际 ${planLength}`);
});

test('关系 via 且 to 未解：via 同失败、整条路由 fail-closed', () => {
  const route = makeRoute({
    id: 'r-to-missing',
    from: { x: 10.74, y: 2.98, z: 2.98 },
    to: 'missing_endpoint',
    via: [
      { kind: 'from_drop', shaft: 'sh1' },
      { kind: 'shaft_corner', shaft: 'sh1' },
      { kind: 'shaft_run', shaft: 'sh1' },
    ],
  });
  const config = testConfig([route], [{ id: 'sh1', x: 11.2, z: 2.98, y: 2.6 }]);
  const resolved = resolveMepRoute(route, EMPTY_SOURCES, config.junctions, config.shafts);
  assert.deepEqual(resolved.unresolved, ['to', 'via']);
  assert.deepEqual(resolved.points, []);
  assert.deepEqual(resolved.viaPoints, []);
  assert.ok(resolved.diagnostics.some((line) => line.includes('to 端点未解析')));
});
