import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  MepCoordinationSchema,
  endpointSourcesFromFacts,
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
 * slope_run 关系步（issue #98 MEP batch 1，全带泵重画）：
 * 沿单轴按 route.slope × 行程派生高度，起算标高为 route.from_height（首步）或上一落点；
 * 末步 to 可取字面 'to'（to 端点在该轴上的坐标），终端标高由末步落点派生，不声明 to_height。
 * 与 from_face_jog 同口径：步内 y 与竖井引用双重 fail-closed（schema + 求解器入口）。
 */

const layerNames = ['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'] as const;
const layers = Object.fromEntries(layerNames.map((id) => [id, { label: id, color: '#fff', height: 2.5 }])) as MepCoordination['layers'];
const emptySources: MepEndpointSources = { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };

function slopeRoute(id: string, via: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, layer: 'condensate', status: 'pending', source_status: 'preliminary',
    construction_status: 'pending', method: 'pump_condensate_candidate',
    diameter: 0.025, insulation_thickness: 0.006, insulation_status: 'assumed',
    from_height: 2.70, flow_direction: 'down', slope: 0.01,
    from: { x: 3.7, z: 5.1 }, to: { x: 6.7, z: 3.7 }, via,
    ...extra,
  };
}

function slopeConfig(routes: Array<Record<string, unknown>>): MepCoordination {
  return MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes, junctions: [] });
}

function assertPointsClose(
  actual: ReadonlyArray<{ x: number; y?: number; z: number }>,
  expected: ReadonlyArray<[number, number, number]>,
  where: string,
): void {
  assert.equal(actual.length, expected.length, `${where}: point count ${actual.length} !== ${expected.length}`);
  for (let index = 0; index < expected.length; index += 1) {
    const [x, y, z] = expected[index];
    assert.ok(Math.abs(actual[index].x - x) <= 1e-9, `${where}[${index}].x ${actual[index].x} !== ${x}`);
    assert.ok(Math.abs((actual[index].y ?? NaN) - y) <= 1e-9, `${where}[${index}].y ${actual[index].y} !== ${y}`);
    assert.ok(Math.abs(actual[index].z - z) <= 1e-9, `${where}[${index}].z ${actual[index].z} !== ${z}`);
  }
}

const MASTER_VIA = [
  { kind: 'slope_run', axis: 'z', to: 4.6 },
  { kind: 'slope_run', axis: 'x', to: 6.58 },
  { kind: 'slope_run', axis: 'z', to: 3.7 },
  { kind: 'slope_run', axis: 'x', to: 'to' },
];

test('slope_run 派生 1% 坡折线，末步 to: \'to\' 落点即终端、终端标高由坡度派生', () => {
  const config = slopeConfig([slopeRoute('syn-master', MASTER_VIA)]);
  const report = resolveMepRoutes(config, emptySources);
  assert.equal(report.unresolved, 0);
  const entry = report.routes[0];
  assert.deepEqual(entry.unresolved, []);
  // 2.70 − 0.01 × (0.50 + 2.88 + 0.90 + 0.12)：每段恰好 1%，无上弯、无平段。
  assertPointsClose(entry.points, [
    [3.7, 2.7, 5.1],
    [3.7, 2.695, 4.6],
    [6.58, 2.6662, 4.6],
    [6.58, 2.6572, 3.7],
    [6.7, 2.656, 3.7],
    [6.7, 2.656, 3.7],
  ], 'syn-master');
});

test('slope_run 末步 to: \'to\' 跟随终端声明移动', () => {
  const moved = slopeConfig([slopeRoute('syn-master', MASTER_VIA, { to: { x: 7.0, z: 3.7 } })]);
  const entry = resolveMepRoutes(moved, emptySources).routes[0];
  assert.deepEqual(entry.unresolved, []);
  const last = entry.points[entry.points.length - 1];
  assert.ok(Math.abs(last.x - 7.0) <= 1e-9 && Math.abs(last.z - 3.7) <= 1e-9);
  // 行程 0.50 + 2.88 + 0.90 + 0.42 = 4.70m，到点 2.70 − 0.047 = 2.653m。
  assert.ok(Math.abs(last.y! - 2.653) <= 1e-9, `terminal y ${last.y} !== 2.653`);
});

test('反例：缺 slope → 显式诊断、无不完整几何；补 slope 即恢复（红/绿）', () => {
  const withoutSlope = slopeConfig([slopeRoute('syn-master', MASTER_VIA, { slope: undefined })]);
  // schema 不强制 slope（强电等路线本无坡度）；求解器入口 fail-closed。
  const route = withoutSlope.routes[0];
  assert.equal((route as MepRoute).slope, undefined);
  const red = resolveMepViaSteps(route as MepRoute, { x: 3.7, z: 5.1 }, { x: 6.7, z: 3.7 }, []);
  assert.deepEqual(red.points, []);
  assert.match(red.diagnostic ?? '', /缺少有效 slope/);
  const green = resolveMepRoutes(slopeConfig([slopeRoute('syn-master', MASTER_VIA)]), emptySources);
  assert.equal(green.unresolved, 0);
});

test('反例：缺 from_height → 显式诊断、无不完整几何；补 from_height 即恢复（红/绿）', () => {
  const withoutHeight = slopeConfig([slopeRoute('syn-master', MASTER_VIA, { from_height: undefined })]);
  const route = withoutHeight.routes[0];
  const red = resolveMepViaSteps(route as MepRoute, { x: 3.7, z: 5.1 }, { x: 6.7, z: 3.7 }, []);
  assert.deepEqual(red.points, []);
  assert.match(red.diagnostic ?? '', /缺少有效起算标高/);
  const green = resolveMepRoutes(slopeConfig([slopeRoute('syn-master', MASTER_VIA)]), emptySources);
  assert.equal(green.unresolved, 0);
});

test('反例：slope_run 声明步内 y → schema 拒绝且求解器入口拒绝，不出半条几何（红/绿）', () => {
  const withStepY = slopeRoute('syn-master', [
    { kind: 'slope_run', axis: 'z', to: 4.6, y: 2.69 },
    { kind: 'slope_run', axis: 'x', to: 6.58 },
    { kind: 'slope_run', axis: 'z', to: 3.7 },
    { kind: 'slope_run', axis: 'x', to: 'to' },
  ]);
  assert.throws(() => slopeConfig([withStepY]), /slope_run 不得声明 y/);
  // 绕过 schema 直接调求解器（旧配置/手写旁路）：同一拒绝，不出半条几何。
  const bypassed = { ...withStepY, via: withStepY.via } as unknown as MepRoute;
  const red = resolveMepViaSteps(bypassed, { x: 3.7, z: 5.1 }, { x: 6.7, z: 3.7 }, []);
  assert.deepEqual(red.points, []);
  assert.match(red.diagnostic ?? '', /不得声明 y/);
  const green = resolveMepRoutes(slopeConfig([slopeRoute('syn-master', MASTER_VIA)]), emptySources);
  assert.equal(green.unresolved, 0);
});

test('反例：slope_run 引用竖井 → schema 拒绝（红/绿）', () => {
  const withShaft = slopeRoute('syn-master', [
    { kind: 'slope_run', axis: 'z', to: 4.6, shaft: 'shaft_entry' },
    { kind: 'slope_run', axis: 'x', to: 6.58 },
    { kind: 'slope_run', axis: 'z', to: 3.7 },
    { kind: 'slope_run', axis: 'x', to: 'to' },
  ]);
  assert.throws(() => slopeConfig([withShaft]), /slope_run 不引用竖井/);
  const green = resolveMepRoutes(slopeConfig([slopeRoute('syn-master', MASTER_VIA)]), emptySources);
  assert.equal(green.unresolved, 0);
});

test('反例：零行程与末步未落到 to 端点 → 显式诊断、无不完整几何（红/绿）', () => {
  const zeroRun = slopeConfig([slopeRoute('syn-master', [{ kind: 'slope_run', axis: 'x', to: 3.7 }])]);
  const zero = resolveMepViaSteps(zeroRun.routes[0], { x: 3.7, z: 5.1 }, { x: 6.7, z: 3.7 }, []);
  assert.deepEqual(zero.points, []);
  assert.match(zero.diagnostic ?? '', /零行程/);

  const short = slopeConfig([slopeRoute('syn-master', [
    { kind: 'slope_run', axis: 'z', to: 4.6 },
    { kind: 'slope_run', axis: 'x', to: 6.0 },
  ])]);
  const shortEntry = resolveMepRoutes(short, emptySources).routes[0];
  assert.deepEqual(shortEntry.unresolved, ['via']);
  assert.deepEqual(shortEntry.points, []);
  assert.match(shortEntry.diagnostics.join('；'), /末步 slope_run 未落到 to 端点/);

  const green = resolveMepRoutes(slopeConfig([slopeRoute('syn-master', MASTER_VIA)]), emptySources);
  assert.equal(green.unresolved, 0);
});

test('反例：to/from 断引用 → unresolved 含 to/from 与 via、无不完整几何（红/绿）', () => {
  const brokenTo = slopeConfig([slopeRoute('syn-master', MASTER_VIA, { to: 'missing_terminal' })]);
  const toEntry = resolveMepRoutes(brokenTo, emptySources).routes[0];
  assert.deepEqual(toEntry.unresolved, ['to', 'via']);
  assert.deepEqual(toEntry.points, []);

  const brokenFrom = slopeConfig([slopeRoute('syn-master', MASTER_VIA, { from: 'missing_anchor' })]);
  const fromEntry = resolveMepRoutes(brokenFrom, emptySources).routes[0];
  assert.deepEqual(fromEntry.unresolved, ['from', 'via']);
  assert.deepEqual(fromEntry.points, []);

  const green = resolveMepRoutes(slopeConfig([slopeRoute('syn-master', MASTER_VIA)]), emptySources);
  assert.equal(green.unresolved, 0);
});

// ── 真实配置：传播实验与 C4 ────────────────────────────────────────────────

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
const BRANCH_IDS = ['condensate-master', 'condensate-living', 'condensate-dining', 'condensate-parent', 'condensate-child'];

function branchPoints(report: ReturnType<typeof resolveMepRoutes>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of BRANCH_IDS) out[id] = JSON.stringify(report.routes.find((item) => item.route.id === id)!.points);
  return out;
}

test('传播实验：共享终端声明东移 0.30m，五条支管末段跟随、其余点不动；复原则逐字节恢复', () => {
  const baseline = branchPoints(resolveMepRoutes(project, realSources));
  const movedSources: MepEndpointSources = {
    ...realSources,
    hvacTerminals: realSources.hvacTerminals.map((terminal) => terminal.id === 'condensate_living_candidate' && terminal.position
      ? { ...terminal, position: { ...terminal.position, x: terminal.position.x + 0.30 } }
      : terminal),
  };
  const moved = branchPoints(resolveMepRoutes(project, movedSources));
  for (const id of BRANCH_IDS) {
    const points = JSON.parse(moved[id]) as Array<{ x: number; y?: number; z: number }>;
    const base = JSON.parse(baseline[id]) as Array<{ x: number; y?: number; z: number }>;
    // 末两点（末步落点 + 派生终端点）跟随终端东移；其余点逐点相同。
    assert.deepEqual(points.slice(0, -2), base.slice(0, -2), `${id}: non-terminal points must not move`);
    for (const point of points.slice(-2)) {
      assert.ok(Math.abs(point.x - 7.0) <= 1e-9, `${id}: terminal x ${point.x} !== 7.00`);
      assert.ok(Math.abs(point.z - 3.7) <= 1e-9, `${id}: terminal z ${point.z} !== 3.70`);
    }
  }
  const restored = branchPoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('传播实验：主卧内机东移 0.20m，主卧支管起点跟随、到点标高随行程调整；复原则逐字节恢复', () => {
  const baseline = branchPoints(resolveMepRoutes(project, realSources));
  const movedCeiling = (ceiling as unknown as Array<Record<string, unknown>>).map((zone) => zone.id === 'ac_master'
    ? { ...zone, x: (zone.x as number) + 0.20 }
    : zone);
  const movedSources = endpointSourcesFromFacts(
    { electrical, plumbing, ceiling: movedCeiling as unknown as ProjectRenderFacts['ceiling'], hvac },
    pointWallIndexFromElements(realLayout.walls),
    realMountHosts,
  );
  const moved = resolveMepRoutes(project, movedSources);
  const master = moved.routes.find((item) => item.route.id === 'condensate-master')!;
  assert.deepEqual(master.unresolved, []);
  assert.ok(Math.abs(master.points[0].x - 3.9) <= 1e-9, `master start x ${master.points[0].x} !== 3.90`);
  const terminal = master.points[master.points.length - 1];
  assert.ok(Math.abs(terminal.x - 6.7) <= 1e-9 && Math.abs(terminal.z - 3.7) <= 1e-9);
  // 行程 0.50 + 2.68 + 0.90 + 0.12 = 4.20m，到点 2.70 − 0.042 = 2.658m。
  assert.ok(Math.abs(terminal.y! - 2.658) <= 1e-9, `master terminal y ${terminal.y} !== 2.658`);
  for (const id of BRANCH_IDS.filter((item) => item !== 'condensate-master')) {
    assert.equal(JSON.stringify(moved.routes.find((item) => item.route.id === id)!.points), baseline[id], `${id} must not move`);
  }
  const restored = branchPoints(resolveMepRoutes(project, realSources));
  assert.deepEqual(restored, baseline, 'revert must restore byte-identical points');
});

test('C4：主卧坡度声明损坏 → lint 报 endpoint_unresolved、DXF 拒导且不导出该路线', () => {
  const corrupted = structuredClone(project);
  const master = corrupted.routes.find((route) => route.id === 'condensate-master')!;
  delete (master as Record<string, unknown>).slope;
  const corruptedResolution = resolveMepRoutes(corrupted, realSources);
  const entry = corruptedResolution.routes.find((item) => item.route.id === 'condensate-master')!;
  assert.deepEqual(entry.unresolved, ['via']);
  assert.deepEqual(entry.points, []);
  assert.match(entry.diagnostics.join('；'), /缺少有效 slope/);

  // lint：失败显形为 must_fix error，不是静默通过。
  const lintResult = lintMepCoordination(corrupted, realSources);
  const masterErrors = lintResult.errors.filter((issue) => issue.routeId === 'condensate-master');
  assert.ok(masterErrors.some((issue) => issue.code === 'endpoint_unresolved' && issue.message.includes('缺少有效 slope')),
    `expected an endpoint_unresolved error for condensate-master, got ${JSON.stringify(masterErrors.map((issue) => issue.code))}`);

  // DXF：errors 非空（入口据此拒导），且图内不再有该路线标注。
  const dxfHouse = { rooms: [], furnishings: {} as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [] };
  const healthyDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: project, sources: realSources }, labels: 'ascii' });
  assert.deepEqual(healthyDxf.errors, []);
  assert.ok(healthyDxf.dxf.includes('condensate-master'), 'healthy DXF must export the master branch');
  const corruptedDxf = buildProjectDxf({ house: dxfHouse, mep: { coordination: corrupted, sources: realSources }, labels: 'ascii' });
  assert.ok(corruptedDxf.errors.some((error) => error.includes('condensate-master')),
    `corrupted DXF must name the broken route, got ${JSON.stringify(corruptedDxf.errors)}`);
  assert.equal(corruptedDxf.dxf.includes('condensate-master'), false, 'corrupted DXF must not export the broken route');
});

test('C4：算量不是冷凝水坡度失效的门禁——冷凝水层按 COST-030-02 属空调合同范围，损坏前后算量不变', () => {
  // 该测试钉的是口径边界，不是 fail-closed：computeMepTakeoff 的 covered_layers
  // 只含强电/弱电/给排水，冷凝水层整层 excluded；坡度损坏不改变 unresolved、blockers
  // 与 union 长度——门禁在 resolveMepRoutes 诊断、verify:mep 与 DXF errors，不在算量。
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
  assert.deepEqual(healthy.unresolved.map((item) => item.id), ['trunk_strong_main']);
  const corrupted = structuredClone(project);
  delete (corrupted.routes.find((route) => route.id === 'condensate-master')! as Record<string, unknown>).slope;
  const broken = computeMepTakeoff(takeoffInput(corrupted));
  assert.deepEqual(broken.unresolved, healthy.unresolved);
  assert.deepEqual(broken.blockers, healthy.blockers);
  assert.deepEqual(broken.excluded, healthy.excluded);
  assert.equal(broken.excluded.find((item) => item.layer === 'condensate')?.routes, 7);
  assert.equal(broken.conduit.drawnRouteUnionM, healthy.conduit.drawnRouteUnionM);
});
