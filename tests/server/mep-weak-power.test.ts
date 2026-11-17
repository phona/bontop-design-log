/**
 * Issue #98 MEP batch 3（弱电）：7 条 weak_power 路由的关系型 via。
 *
 * 新步型 axis_jog / axis_run / run（仅带 y 斜段遗留） / level（shared/mep-hvac-coordination-schema.ts）：
 * 共用轴线只在顶层 axes 表声明一次（weak_axis_438 z=4.38、5 条共用；weak_axis_455
 * z=4.55、2 条共用），北上段 x=10.8 不另声明——7 条共用同一 from 端点
 * panel_weak_entry_left（解算落点 (10.80,2.98)），游标 x 即 from.x，箱位移动自动跟随。
 * shafts 里的 shaft_entry (10.74,2.98,y=0.02) 是强电垫层轴，不得挪用到弱电。
 * 验收分层：A 机制（合成夹具）→ C1 等价（真实配置逐点钉 merge-base 基线）→
 * C2 传动 → C3 消费者对账 → C4 反例。测试注入一律按稳定对象 id 结构化改字段，
 * 不做 YAML 文本匹配；新测试用 js-yaml 解析改字段，不得字符串 replace。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  MepCoordinationSchema,
  MepViaStepSchema,
  endpointSourcesFromFacts,
  isMepViaCoordinate,
  parseMepCoordination,
  resolveMepRoute,
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
import type { ElectricalPoint } from '../../shared/types.js';
import type { FurnishingsYaml, ProjectRenderFacts, VertexLayoutYaml } from '../../shared/types.js';

// ─── A. 合成机制 ─────────────────────────────────────────────────────────────

const layerNames = ['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'] as const;
const layers = Object.fromEntries(layerNames.map((id) => [id, { label: id, color: '#fff', height: 2.5 }])) as MepCoordination['layers'];

/** 合成弱电箱 + 网口端点（绝对点位，真实路由用字符串端点引用它们）。 */
function weakSources(panel: { x: number; z: number } = { x: 10.8, z: 2.98 }, net: { x: number; z: number } = { x: 7.2, z: 7.6 }): MepEndpointSources {
  const points: ElectricalPoint[] = [
    { id: 'panel_weak_entry_left', room: 'living_dining', type: 'weak_panel', absolute: true, x: panel.x, z: panel.z, height: 0.5 },
    { id: 'net_living', room: 'living_dining', type: 'network', absolute: true, x: net.x, z: net.z, height: 0.3 },
  ];
  return { electrical: points, plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };
}

function weakAxes(): MepCoordination['axes'] {
  return [
    { id: 'weak_axis_438', axis: 'z', value: 4.38, y: 2.6 },
    { id: 'weak_axis_455', axis: 'z', value: 4.55, y: 2.6 },
  ];
}

function weakRoute(id: string, via: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, layer: 'weak_power', status: 'inferred', source_status: 'proposed',
    construction_status: 'pending', method: 'low_voltage_conduit', diameter: 0.02,
    from_height: 2.6, to_height: 0.3,
    from: 'panel_weak_entry_left', to: 'net_living', via,
    ...extra,
  };
}

function weakConfig(routes: Array<Record<string, unknown>>, axes: MepCoordination['axes'] = weakAxes()): MepCoordination {
  return MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes, junctions: [], shafts: [], axes });
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

/** 平面折线长度（竖直段平面长 0，只计 x/z 移动）。 */
function planLength(points: ReadonlyArray<{ x: number; z: number }>): number {
  return points.slice(1).reduce((sum, point, index) => {
    const prev = points[index];
    return sum + Math.hypot(point.x - prev.x, point.z - prev.z);
  }, 0);
}

/** 三维折线长度（竖直段计入，只计 x/y/z 移动）。 */
function length3d(points: ReadonlyArray<{ x: number; y?: number; z: number }>): number {
  return points.slice(1).reduce((sum, point, index) => {
    const prev = points[index];
    return sum + Math.hypot(point.x - prev.x, (point.y ?? 0) - (prev.y ?? 0), point.z - prev.z);
  }, 0);
}

const LIVING_VIA = [
  { kind: 'axis_jog', axis: 'weak_axis_438' },
  { kind: 'axis_run', axis: 'x', to: 7.3 },
  { kind: 'axis_run', axis: 'z', to: 'to' },
];

test('A1：axis_jog + axis_run 解出弱电形折线：入轴、沿轴、末步 to:\'to\' 跟随终端', () => {
  const config = weakConfig([weakRoute('syn-living', LIVING_VIA)]);
  assert.doesNotThrow(() => validateMepCoordination(config, weakSources()));
  const entry = resolveMepRoutes(config, weakSources()).routes[0];
  assert.deepEqual(entry.unresolved, []);
  assertPointsClose(entry.points, [
    [10.8, 2.6, 2.98],
    [10.8, 2.6, 4.38],
    [7.3, 2.6, 4.38],
    [7.3, 2.6, 7.6],
    [7.2, 0.3, 7.6],
  ], 'syn-living');
  assert.ok(Math.abs(planLength(entry.points) - 8.22) < 1e-9, `平面长度应为 8.22m，实际 ${planLength(entry.points)}`);
});

test('A2：axis_jog fail-closed：未知轴线 / 已在轴线上 / 错层入轴 / 缺 from_height', () => {
  const sources = weakSources();
  const axes = weakAxes();
  // 未知轴线。
  const unknown = resolveMepViaSteps(
    weakRoute('syn-living', LIVING_VIA) as unknown as MepRoute,
    { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], [],
  );
  assert.deepEqual(unknown.points, []);
  assert.match(unknown.diagnostic ?? '', /引用未知轴线 "weak_axis_438"/);
  // 已在轴线上：from.z 即 4.38，入轴零行程。
  const onAxis = resolveMepViaSteps(
    weakRoute('syn-living', LIVING_VIA) as unknown as MepRoute,
    { x: 10.8, z: 4.38 }, { x: 7.2, z: 7.6 }, [], axes,
  );
  assert.deepEqual(onAxis.points, []);
  assert.match(onAxis.diagnostic ?? '', /零行程/);
  // 错层入轴：轴线层高 2.55，游标 2.6，差 0.05m。
  const wrongLayerAxes = [{ id: 'weak_axis_438', axis: 'z', value: 4.38, y: 2.55 }] as MepCoordination['axes'];
  const wrongLayer = resolveMepViaSteps(
    weakRoute('syn-living', LIVING_VIA) as unknown as MepRoute,
    { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], wrongLayerAxes,
  );
  assert.deepEqual(wrongLayer.points, []);
  assert.match(wrongLayer.diagnostic ?? '', /标高 2\.6 与轴线 "weak_axis_438" 层高 2\.55 不一致/);
  // 缺 from_height：游标无起算标高。
  const noHeight = weakRoute('syn-living', LIVING_VIA, { from_height: undefined }) as unknown as MepRoute;
  const noHeightResult = resolveMepViaSteps(noHeight, { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], axes);
  assert.deepEqual(noHeightResult.points, []);
  assert.match(noHeightResult.diagnostic ?? '', /缺少有效起算标高/);
  // 对照：同一路由正常解算。
  const green = resolveMepRoutes(weakConfig([weakRoute('syn-living', LIVING_VIA)]), sources);
  assert.equal(green.unresolved, 0);
});

test('A3：axis_jog schema：步内 y / 缺 axis / 声明 shaft 或 to 即拒绝', () => {
  assert.equal(MepViaStepSchema.safeParse({ kind: 'axis_jog', axis: 'weak_axis_438', y: 2.6 }).success, false, 'axis_jog 不得声明 y');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'axis_jog' }).success, false, 'axis_jog 必须声明 axis');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'axis_jog', axis: 'weak_axis_438', shaft: 'shaft_entry' }).success, false, 'axis_jog 不引用竖井');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'axis_jog', axis: 'weak_axis_438', to: 7.3 }).success, false, 'axis_jog 不声明 to');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'axis_jog', axis: 'weak_axis_438' }).success, true);
  // 求解器入口同样拒绝步内 y（绕开 schema 的直接入口）。
  const badStep = weakRoute('syn-living', [
    { kind: 'axis_jog', axis: 'weak_axis_438', y: 2.6 },
    { kind: 'axis_run', axis: 'x', to: 7.3 },
  ]) as unknown as MepRoute;
  const red = resolveMepViaSteps(badStep, { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], weakAxes());
  assert.deepEqual(red.points, []);
  assert.match(red.diagnostic ?? '', /axis_jog 不得声明 y/);
});

test('A4：axis_run fail-closed：缺 axis / 缺 to / 零行程 / 缺 from_height；to:\'to\' 跟随终端移动', () => {
  const sources = weakSources();
  const axes = weakAxes();
  const missingAxis = resolveMepViaSteps(
    weakRoute('syn-living', [{ kind: 'axis_jog', axis: 'weak_axis_438' }, { kind: 'axis_run', to: 7.3 }]) as unknown as MepRoute,
    { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], axes,
  );
  assert.deepEqual(missingAxis.points, []);
  assert.match(missingAxis.diagnostic ?? '', /缺少 axis/);
  const missingTo = resolveMepViaSteps(
    weakRoute('syn-living', [{ kind: 'axis_jog', axis: 'weak_axis_438' }, { kind: 'axis_run', axis: 'x' }]) as unknown as MepRoute,
    { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], axes,
  );
  assert.deepEqual(missingTo.points, []);
  assert.match(missingTo.diagnostic ?? '', /缺少 to/);
  const zeroRun = resolveMepViaSteps(
    weakRoute('syn-living', [{ kind: 'axis_jog', axis: 'weak_axis_438' }, { kind: 'axis_run', axis: 'x', to: 10.8 }]) as unknown as MepRoute,
    { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], axes,
  );
  assert.deepEqual(zeroRun.points, []);
  assert.match(zeroRun.diagnostic ?? '', /零行程/);
  // to:'to' 跟随终端：网口南移 0.20m，末段落点跟随、其余点不动。
  const moved = resolveMepRoutes(weakConfig([weakRoute('syn-living', LIVING_VIA)]), weakSources({ x: 10.8, z: 2.98 }, { x: 7.2, z: 7.8 })).routes[0];
  assert.deepEqual(moved.unresolved, []);
  assertPointsClose(moved.points, [
    [10.8, 2.6, 2.98],
    [10.8, 2.6, 4.38],
    [7.3, 2.6, 4.38],
    [7.3, 2.6, 7.8],
    [7.2, 0.3, 7.8],
  ], 'syn-living-moved');
  const green = resolveMepRoutes(weakConfig([weakRoute('syn-living', LIVING_VIA)]), sources);
  assert.equal(green.unresolved, 0);
});

test('A5：run 带 y 原样保留三维斜段：南下段终点标高 2.4（weak-master 口径），不是高度越权', () => {
  const masterVia = [
    { kind: 'axis_jog', axis: 'weak_axis_438' },
    { kind: 'axis_run', axis: 'x', to: 4.1 },
    { kind: 'run', axis: 'z', to: 6.3, y: 2.4 },
  ];
  const entry = resolveMepRoutes(weakConfig([weakRoute('syn-master', masterVia, { to: { x: 4.2, z: 6.5, y: 0.3 } })]), weakSources()).routes[0];
  assert.deepEqual(entry.unresolved, []);
  // 南下段 (4.1,4.38,2.6)→(4.1,6.3,2.4) 是既有三维斜段：终点 y=2.4 为声明值，
  // 3D 长度含斜段（√(1.92²+0.2²)），lint 仍在解算点列上检查该斜段，迁移不藏错。
  assert.deepEqual(entry.viaPoints[2], { x: 4.1, y: 2.4, z: 6.3 });
  assert.ok(Math.abs(length3d(entry.points) - (1.4 + 6.7 + Math.hypot(1.92, 0.2) + Math.hypot(0.1, 2.1, 0.2))) < 1e-9,
    `三维长度应含斜段，实际 ${length3d(entry.points)}`);
});

test('A6：level fail-closed：缺 y / 零高差 / 缺起算标高；升层亦可', () => {
  const sources = weakSources();
  const axes = weakAxes();
  const base = [
    { kind: 'axis_jog', axis: 'weak_axis_455' },
    { kind: 'axis_run', axis: 'x', to: 10.5 },
  ];
  // 降层 2.6→2.51 与升层 2.51→2.7 均可解。
  const dropRise = resolveMepRoutes(weakConfig([weakRoute('syn-ap-master', [
    ...base,
    { kind: 'level', y: 2.51 },
    { kind: 'axis_run', axis: 'x', to: 7.2 },
    { kind: 'level', y: 2.7 },
  ])]), sources).routes[0];
  assert.deepEqual(dropRise.unresolved, []);
  assert.deepEqual(dropRise.viaPoints[2], { x: 10.5, y: 2.51, z: 4.55 });
  assert.deepEqual(dropRise.viaPoints[4], { x: 7.2, y: 2.7, z: 4.55 });
  // 缺 y。
  const noY = resolveMepViaSteps(
    weakRoute('syn-ap-master', [...base, { kind: 'level' }]) as unknown as MepRoute,
    { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], axes,
  );
  assert.deepEqual(noY.points, []);
  assert.match(noY.diagnostic ?? '', /必须声明有限数 y/);
  // 零高差：目标与游标同高。
  const zeroDelta = resolveMepViaSteps(
    weakRoute('syn-ap-master', [...base, { kind: 'level', y: 2.6 }]) as unknown as MepRoute,
    { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], axes,
  );
  assert.deepEqual(zeroDelta.points, []);
  assert.match(zeroDelta.diagnostic ?? '', /零行程/);
  // 缺起算标高。
  const noHeight = weakRoute('syn-ap-master', [...base, { kind: 'level', y: 2.51 }], { from_height: undefined }) as unknown as MepRoute;
  const noHeightResult = resolveMepViaSteps(noHeight, { x: 10.8, z: 2.98 }, { x: 7.2, z: 7.6 }, [], axes);
  assert.deepEqual(noHeightResult.points, []);
  assert.match(noHeightResult.diagnostic ?? '', /缺少有效起算标高/);
});

test('A7：三新步 schema 互斥：axis_run 带 shaft、axis_jog 方向轴、slope_run 轴线 id 即拒绝', () => {
  assert.equal(MepViaStepSchema.safeParse({ kind: 'axis_run', axis: 'x', to: 7.3, shaft: 'shaft_entry' }).success, false, 'axis_run 不引用竖井');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'axis_jog', axis: 'z' }).success, false, 'axis_jog 的 axis 须为轴线 id（方向值不合法）');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'slope_run', axis: 'weak_axis_438', to: 4.6 }).success, false, 'slope_run 的 axis 须为方向（轴线 id 不合法）');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'level', y: 2.51, axis: 'x' }).success, false, 'level 不声明 axis');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'level', y: 2.51, shaft: 'shaft_entry' }).success, false, 'level 不引用竖井');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'level' }).success, false, 'level 必须声明 y');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'axis_run', axis: 'x', to: 7.3 }).success, true);
  assert.equal(MepViaStepSchema.safeParse({ kind: 'axis_run', axis: 'weak_axis_438', to: 7.3 }).success, true, 'axis_run 命名轴形式合法');
  assert.equal(MepViaStepSchema.safeParse({ kind: 'level', y: 2.51 }).success, true);
});

test('A8：validateMepCoordination：未知轴线 / 重复轴线 id 即抛', () => {
  const badAxis = weakConfig([weakRoute('syn-living', [
    { kind: 'axis_jog', axis: 'weak_axis_missing' },
    { kind: 'axis_run', axis: 'x', to: 7.3 },
  ])]);
  assert.throws(() => validateMepCoordination(badAxis, weakSources()), /引用未知轴线 "weak_axis_missing"/);
  const dupAxes = weakConfig([weakRoute('syn-living', LIVING_VIA)], [
    { id: 'weak_axis_438', axis: 'z', value: 4.38, y: 2.6 },
    { id: 'weak_axis_438', axis: 'z', value: 4.4, y: 2.6 },
  ]);
  assert.throws(() => validateMepCoordination(dupAxes, weakSources()), /Duplicate MEP axis id/);
  const green = weakConfig([weakRoute('syn-living', LIVING_VIA)]);
  assert.doesNotThrow(() => validateMepCoordination(green, weakSources()));
});

// ─── B. 真实配置 ────────────────────────────────────────────────────────────

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

const WEAK_IDS = ['weak-main-living', 'weak-master', 'weak-parent', 'weak-study', 'weak-gateway', 'weak-ap', 'weak-ap-master'];

/**
 * C1 基线：merge-base（origin/master 211831e8）绝对 via 的解算点列，减去每条首个
 * 重复点（from 点与首个 via 点平面重合、标高相同，零长段；按 PR #231 C1 口径去重，
 * 其余逐点等价，容差 1e-9）。三维/平面长度为同基线实算值。
 * 例外（gap-2 正交拆分，本批）：weak-main-living / weak-master / weak-parent 的末段
 * 斜线被拆为正交腿——main-living 末段 +x-run 至 7.2（z=7.6）再 +z-run 至 7.7，
 * master 末段 +x-run 至 4.2 再 +z-run 至 6.5，parent 末段 +x-run 至 7.2；
 * 新增点均为斜线拆分角点（落在原斜线两端构成的正交包络上），其余点与基线一致，
 * 长度按新折线实算（平面/三维长度见 EXPECTED_LENGTHS）。
 * 例外（2026-11-17 Retrace）：weak-master 删 x→4.05 往返点（[4.05, 2.6, 4.55]），
 * 点列与长度同步减 0.10m（10.42/12.72→10.32/12.62）。
 * [x, y, z]。
 */
const EXPECTED_POINTS: Record<string, Array<[number, number, number]>> = {
  'weak-main-living': [
    [10.8, 2.6, 2.98], [10.8, 2.6, 4.38], [7.3, 2.6, 4.38], [7.3, 2.6, 7.6], [7.2, 2.6, 7.6], [7.2, 2.6, 7.7], [7.2, 0.3, 7.7],
  ],
  'weak-master': [
    [10.8, 2.6, 2.98], [10.8, 2.6, 4.38], [7.2, 2.6, 4.38], [4.6, 2.6, 4.38], [4.6, 2.6, 4.55],
    [4.1, 2.6, 4.55], [4.1, 2.6, 6.3], [4.1, 2.4, 6.3], [4.2, 2.4, 6.3], [4.2, 2.4, 6.5], [4.2, 0.3, 6.5],
  ],
  'weak-parent': [
    [10.8, 2.6, 2.98], [10.8, 2.6, 4.38], [5.5, 2.6, 4.38], [5.5, 2.6, 5.7],
    [7, 2.6, 5.7], [7, 2.6, 7.6], [7.2, 2.6, 7.6], [7.2, 0.3, 7.6],
  ],
  'weak-study': [
    [10.8, 2.6, 2.98], [10.8, 2.6, 4.55], [12.65, 2.6, 4.55], [12.65, 2.6, 5.55],
    [13.34, 2.6, 5.55], [13.34, 2.6, 5.61], [13.34, 2.45, 5.61], [13.34, 2.45, 7.8], [13.4, 0.3, 7.9],
  ],
  'weak-gateway': [
    [10.8, 2.6, 2.98], [10.8, 2.6, 4.38], [7.3, 2.6, 4.38], [7.3, 2.6, 5.7], [7.2, 0.3, 5.7],
  ],
  'weak-ap': [
    [10.8, 2.6, 2.98], [10.8, 2.6, 4.38], [8.6, 2.6, 4.38], [8.6, 2.6, 4.75],
  ],
  'weak-ap-master': [
    [10.8, 2.6, 2.98], [10.8, 2.6, 4.55], [10.5, 2.6, 4.55], [10.5, 2.51, 4.55],
    [7.2, 2.51, 4.55], [4.6, 2.51, 4.55], [4.6, 2.51, 4.48], [4.15, 2.51, 4.48],
    [4.15, 2.51, 4.95], [2.95, 2.51, 4.95], [2.95, 2.51, 5.3], [2.95, 2.7, 5.3], [2.8, 2.8, 6.0],
  ],
};
/** [平面长度, 三维长度]，merge-base 基线实算值（1e-9 容差）。 */
const EXPECTED_LENGTHS: Record<string, [number, number]> = {
  'weak-main-living': [8.32, 10.62],
  'weak-master': [10.32, 12.62], // 2026-11-17 Retrace：删 x→4.05 往返段（0.55+0.05→0.50，−0.10m）
  'weak-parent': [11.62, 13.92],
  'weak-study': [7.476619038, 9.663160468],
  'weak-gateway': [6.32, 8.522172887],
  'weak-ap': [3.97, 3.97],
  'weak-ap-master': [11.025891053, 11.312841615],
};

function weakPoints(report: ReturnType<typeof resolveMepRoutes>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of WEAK_IDS) out[id] = JSON.stringify(report.routes.find((item) => item.route.id === id)!.points);
  return out;
}

test('C1 等价：7 条弱电路由逐点等于 merge-base 基线，轴声明独立钉值，无绝对 via 残留', () => {
  // 轴声明本身钉死（#231 残留教训：C1 旧基线取自迁移后配置，轴改值会双侧同移而测不出；
  // 此处独立断言裁定轴值，不依赖点列比较）。
  assert.deepEqual(project.axes, [
    { id: 'corridor_axis', axis: 'z', value: 4.6, reason: '走廊/客厅边吊主干轴线 z=4.6（本文件头注；ceiling_living x[7.2,13.4]×z[4.3,5.55] 边吊内轴线，98 个既有弯点落在上面，43 条路由共用）' },
    { id: 'weak_axis_438', axis: 'z', value: 4.38, y: 2.6 },
    { id: 'weak_axis_455', axis: 'z', value: 4.55, y: 2.6 },
    { id: 'axis_trunk_x745', axis: 'x', value: 7.45, reason: 'x=7.45 冷媒主管轴，与 strong-ac-outdoor 外机供电共用。来源：餐厅西侧服务带 note「藏冷媒主管 x=7.45 轴线」+ refrigerant-trunk / strong-ac-outdoor 既有几何。' },
    { id: 'axis_living_south_z555', axis: 'z', value: 5.55, reason: 'z=5.55 客厅北缘边吊南缘 / w_st_north 墙线。来源：ceiling_living area 南缘 z=5.55 + 墙顶点 v_mb_ne/v_st_ne z=5.55。refrigerant-study 沿此线东行至 w_be_west。' },
    { id: 'axis_be_west_x1340', axis: 'x', value: 13.4, reason: 'x=13.4 w_be_west 墙线 / ceiling_living 东缘。来源：墙顶点 v_be_sw/v_be_se_s x=13.40 + ceiling_living area 东缘 x=13.40。refrigerant-study 沿此线南下至穿点。' },
  ]);
  assert.doesNotThrow(() => validateMepCoordination(project, realSources));
  const report = resolveMepRoutes(project, realSources);
  assert.equal(report.total, 137, '路由总数不变');
  assert.equal(report.resolved, 137);
  assert.deepEqual(report.diagnostics, []);
  for (const id of WEAK_IDS) {
    const entry = report.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, [], `${id}: 须全解`);
    assert.deepEqual(entry.diagnostics, [], `${id}: 须无诊断`);
    assertPointsClose(entry.points, EXPECTED_POINTS[id], id);
    const [plan, len3] = EXPECTED_LENGTHS[id];
    assert.ok(Math.abs(planLength(entry.points) - plan) < 1e-9, `${id}: 平面长度 ${planLength(entry.points)} !== ${plan}`);
    assert.ok(Math.abs(length3d(entry.points) - len3) < 1e-9, `${id}: 三维长度 ${length3d(entry.points)} !== ${len3}`);
    // 迁移完成：7 条路由的 via 全为关系步，零绝对坐标残留；from 仍为弱电箱 id。
    assert.equal(entry.route.from, 'panel_weak_entry_left', `${id}: from 仍为弱电箱`);
    assert.equal(entry.route.construction_status, 'pending', `${id}: construction_status 保持 pending`);
    assert.ok(entry.route.via.length > 0, `${id}: via 非空`);
    assert.ok(entry.route.via.every((step) => !isMepViaCoordinate(step)), `${id}: via 须全为关系步`);
  }
});

test('C2 传动：weak_axis_438 4.38→4.40，五条跟随、两条不动；复原则逐字节恢复', () => {
  const baseline = weakPoints(resolveMepRoutes(project, realSources));
  const moved = structuredClone(project);
  moved.axes.find((axis) => axis.id === 'weak_axis_438')!.value = 4.40;
  const movedReport = resolveMepRoutes(moved, realSources);
  assert.equal(movedReport.unresolved, 0);
  const movedPoints = weakPoints(movedReport);
  for (const id of ['weak-main-living', 'weak-master', 'weak-parent', 'weak-gateway', 'weak-ap']) {
    const base = JSON.parse(baseline[id]) as Array<{ x: number; y?: number; z: number }>;
    const expected = base.map((p) => (p.z === 4.38 ? { ...p, z: 4.40 } : p));
    assert.deepEqual(JSON.parse(movedPoints[id]), expected, `${id}: z=4.38 的点须移至 4.40，其余点不动`);
  }
  for (const id of ['weak-study', 'weak-ap-master']) {
    assert.equal(movedPoints[id], baseline[id], `${id}: 走 4.55 轴，须纹丝不动`);
  }
  const restored = weakPoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C2 传动：net_parent 南移 0.20m，weak-parent 末段跟随、weak-main-living（字面 7.6）不动；复原则逐字节恢复', () => {
  const baseline = weakPoints(resolveMepRoutes(project, realSources));
  const movedElectrical = (electrical as unknown as Array<Record<string, unknown>>).map((point) => {
    if (point.id !== 'net_parent') return point;
    const copy = { ...point };
    // 定位来源必须唯一：wall 系字段删除后改绝对点位（结构化改字段，不做 YAML 文本匹配）。
    delete copy.wall;
    delete copy.wall_side;
    delete copy.along;
    delete copy.face_offset;
    return { ...copy, absolute: true, x: 7.2, z: 7.8 };
  });
  const movedSources = endpointSourcesFromFacts(
    { electrical: movedElectrical as unknown as ProjectRenderFacts['electrical'], plumbing, ceiling, hvac },
    pointWallIndexFromElements(realLayout.walls),
    realMountHosts,
  );
  const moved = weakPoints(resolveMepRoutes(project, movedSources));
  const parent = JSON.parse(moved['weak-parent']) as Array<{ x: number; y?: number; z: number }>;
  const parentBase = JSON.parse(baseline['weak-parent']) as Array<{ x: number; y?: number; z: number }>;
  // 末段现为三点（gap-2 拆分后新增 x-run 一步）：z-run to:'to'（7,7.6）→ x-run
  // to:'to'（7.2,7.6）→ 终端（7.2,0.3,7.6），三点均跟随 net_parent；其余五点不动。
  assert.deepEqual(parent.slice(0, -3), parentBase.slice(0, -3), 'weak-parent: 非末段点须不动');
  assert.equal(parent[parent.length - 3].z, 7.8, 'weak-parent: 末段 axis_run z to:\'to\' 须跟随至 7.8');
  assert.equal(parent[parent.length - 2].z, 7.8, 'weak-parent: 末段 axis_run x to:\'to\' 须跟随至 7.8');
  assert.equal(parent[parent.length - 1].z, 7.8, 'weak-parent: 终端须跟随至 7.8');
  // 字面 7.6 的 weak-main-living 与其余 5 条须纹丝不动。
  for (const id of WEAK_IDS.filter((item) => item !== 'weak-parent')) {
    assert.equal(moved[id], baseline[id], `${id} must not move`);
  }
  const restored = weakPoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C3 消费者对账：lint 60/164 与逐路由计数同基线、DXF 无错且含 7 条弱电 id、算量 unresolved 仍只有 trunk_strong_main', () => {
  // lint：raw 口径 60 errors / 164 warnings（本批实算；gap-2 正交拆分后三条弱电的
  // route_not_orthogonal 消失，overlap 计数随折线变化；childbed 竖直优先修法另增
  // 1 处冷媒/childbed 重叠 error 与 1 处 envelope warning；2026-11-16 Codex blocking
  // 修复：study-curtain 南行段升至 2.70m，与 weak-main-living / weak-parent 的 2.55m
  // 共线重叠消失 2 处，errors 64→62；同批 2 处 ceiling_clearance_unverified 警告
  // 随 110mm hit 清零，warnings 171→169；2026-11-16 Codex blocking 修复（第二轮）：
  // childbed 升位移至南行段 (5.60,4.00)，与冷媒主管/支管的 2 处重叠 error 与
  // 冷凝水主管/支管的 2 处 envelope warning 同批消失，errors 62→60、warnings 169→167；
  // 2026-11-16 Codex blocking 修复（第四轮）：7 条路由往返折返同批消除，
  // route_overlap envelope 47→45、route_clearance_unverified 38→37，warnings 167→164；
  // 2026-11-17 量价算法审计 D4：立管补 0.82m 后显形 9 处重叠——热水需求路由与
  // 干管末段重叠 4 处（envelope route_overlap 警告）+ 回水三通/客卫汇流 5 处转
  // shared_trunk 声明警告，warnings 164→173；errors 不变（声明挡住 5 处 must_fix）。
  // 2026-11-17 量价算法审计跟进 blocking 2：冷热立管错开 150mm，3 处假共干管声明
  // 撤销 + 2 处需求路线/冷立管重叠消失，warnings 173→168；errors 不变。
  // verify:mep CLI 口径由 mep-guidance-baseline 测试另行钉死）。
  const lintResult = lintMepCoordination(project, realSources);
  assert.equal(lintResult.errors.length, 60, `lint errors 应为 60，实际 ${lintResult.errors.length}`);
  assert.equal(lintResult.warnings.length, 168, `lint warnings 应为 168，实际 ${lintResult.warnings.length}`);
  const perRoute = (issues: Array<{ code: string; routeId?: string }>): Record<string, Record<string, number>> => {
    const out: Record<string, Record<string, number>> = {};
    for (const issue of issues) {
      if (!issue.routeId || !WEAK_IDS.includes(issue.routeId)) continue;
      out[issue.routeId] ??= {};
      out[issue.routeId][issue.code] = (out[issue.routeId][issue.code] ?? 0) + 1;
    }
    return out;
  };
  assert.deepEqual(perRoute(lintResult.errors), {
    'weak-main-living': { route_overlap: 3 },
    'weak-master': { route_overlap: 8 },
    'weak-parent': { route_overlap: 6 },
    'weak-study': { route_overlap: 5 },
    'weak-gateway': { route_overlap: 3 },
    'weak-ap': { route_overlap: 2 },
  }, 'errors 逐路由计数须同基线');
  assert.deepEqual(perRoute(lintResult.warnings), {
    'weak-master': { ceiling_clearance_unverified: 1, route_overlap: 1 },
    'weak-gateway': { ceiling_clearance_unverified: 1, route_overlap: 1 },
    'weak-main-living': { route_overlap: 1 },
    'weak-parent': { route_overlap: 1 },
    'weak-ap': { route_overlap: 2 },
  }, 'warnings 逐路由计数须同基线');
  // 7 条弱电路由自身无 endpoint_unresolved（迁移不得引入新失败）。
  for (const id of WEAK_IDS) {
    assert.ok(!lintResult.errors.some((issue) => issue.routeId === id && issue.code === 'endpoint_unresolved'), `${id}: 不得有 endpoint_unresolved`);
  }
  // DXF：无错，且 7 条弱电路由全部导出（weak-ap 用否定前瞻与 weak-ap-master 区分）。
  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const dxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(dxf.errors, []);
  for (const id of WEAK_IDS) {
    assert.ok(new RegExp(`${id}(?!-master)`).test(dxf.dxf), `DXF 须导出 ${id}`);
  }
  // 算量：unresolved 仍只有 trunk_strong_main（主干未归属回路，pending）。
  // water-master-bath 的 pipe_route_segments 已随 gap-2 末段拆分同步延至下标 4，不再 unresolved。
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

test('C4：删 weak_axis_438 → 五条 unresolved、lint endpoint_unresolved、DXF 拒导且不导出、算量 unresolved 进 5 条且并管量下降', () => {
  const corrupted = structuredClone(project);
  corrupted.axes = corrupted.axes.filter((axis) => axis.id !== 'weak_axis_438');
  const five = ['weak-main-living', 'weak-master', 'weak-parent', 'weak-gateway', 'weak-ap'];
  const corruptedResolution = resolveMepRoutes(corrupted, realSources);
  for (const id of five) {
    const entry = corruptedResolution.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, ['via']);
    assert.deepEqual(entry.points, []);
    assert.match(entry.diagnostics.join('；'), /引用未知轴线 "weak_axis_438"/);
  }
  for (const id of ['weak-study', 'weak-ap-master']) {
    const entry = corruptedResolution.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, [], `${id}: 走 4.55 轴，须不受影响`);
  }

  const lintResult = lintMepCoordination(corrupted, realSources);
  for (const id of five) {
    const errors = lintResult.errors.filter((issue) => issue.routeId === id);
    assert.ok(errors.some((issue) => issue.code === 'endpoint_unresolved' && issue.message.includes('引用未知轴线 "weak_axis_438"')),
      `expected an endpoint_unresolved error for ${id}, got ${JSON.stringify(errors.map((issue) => issue.code))}`);
  }

  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const healthyDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(healthyDxf.errors, []);
  const corruptedDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: corrupted, sources: realSources }, labels: 'ascii' });
  for (const id of five) {
    assert.ok(corruptedDxf.errors.some((error) => error.includes(id)), `corrupted DXF must name ${id}`);
    assert.equal(new RegExp(`${id}(?!-master)`).test(corruptedDxf.dxf), false, `corrupted DXF must not export ${id}`);
  }

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
  // 健康态 unresolved 仍只有 trunk_strong_main。
  assert.deepEqual(healthy.unresolved.map((item) => item.id), ['trunk_strong_main']);
  for (const id of five) {
    assert.ok(broken.unresolved.some((item) => item.id === id), `takeoff unresolved 须含 ${id}`);
    assert.ok(broken.blockers.some((item) => item.id === id && item.kind === 'error'), `takeoff blockers 须含 ${id}`);
  }
  assert.ok(broken.conduit.drawnRouteUnionM < healthy.conduit.drawnRouteUnionM, '损坏后并管量须下降，不得出成功产物');
});

test('C4：weak_axis_455 层高 2.6→2.55 → 两条错层入轴失败、其余全解', () => {
  const corrupted = structuredClone(project);
  corrupted.axes.find((axis) => axis.id === 'weak_axis_455')!.y = 2.55;
  const report = resolveMepRoutes(corrupted, realSources);
  for (const id of ['weak-study', 'weak-ap-master']) {
    const entry = report.routes.find((item) => item.route.id === id)!;
    assert.deepEqual(entry.unresolved, ['via']);
    assert.deepEqual(entry.points, []);
    assert.match(entry.diagnostics.join('；'), /标高 2\.6 与轴线 "weak_axis_455" 层高 2\.55 不一致/);
  }
  const othersBroken = report.routes.filter((item) => !['weak-study', 'weak-ap-master'].includes(item.route.id) && item.unresolved.length > 0);
  assert.deepEqual(othersBroken, [], '其余 135 条须全解');
  const green = resolveMepRoutes(project, realSources);
  assert.equal(green.unresolved, 0);
});
