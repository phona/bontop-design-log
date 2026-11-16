import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  endpointSourcesFromFacts,
  MepCoordinationSchema,
  parseMepCoordination,
  resolveMepRoutes,
  validateMepCoordination,
  type MepCoordination,
  type MepEndpointSources,
  type MepJunction,
} from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination } from '../../shared/mep-hvac-lint.js';
import type { FurnishingsYaml, ProjectRenderFacts, VertexLayoutYaml } from '../../shared/types.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveLayout } from '../../server/layout-resolver.js';

const layerNames = ['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'] as const;
const layers = Object.fromEntries(layerNames.map((id) => [id, { label: id, color: '#fff', height: 2.5 }])) as MepCoordination['layers'];
const emptySources: MepEndpointSources = { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };

function config(routes: Array<Record<string, unknown>>, junctions: MepJunction[] = []): MepCoordination {
  return MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes, junctions });
}

function gravity(id: string, from: { x: number; z: number; y: number }, to: { x: number; z: number; y: number }) {
  return {
    id, layer: 'condensate', status: 'inferred', source_status: 'plan_supported',
    construction_status: 'pending', method: 'gravity_condensate_candidate',
    diameter: 0.025, from_height: from.y, to_height: to.y, flow_direction: 'down', slope: 0.01,
    from, to,
  };
}

function planLength(points: ReadonlyArray<{ x: number; z: number }>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return total;
}

test('same-layer condensate pipes that share a centerline still report a physical overlap', () => {
  const routes = [
    gravity('pipe-a', { x: 0, z: 0, y: 2 }, { x: 1, z: 0, y: 1.99 }),
    gravity('pipe-b', { x: 0, z: 0, y: 2 }, { x: 1, z: 0, y: 1.99 }),
  ];
  const result = lintMepCoordination(config(routes), emptySources);
  assert.ok([...result.errors, ...result.warnings].some((issue) => issue.code === 'route_overlap'));
});

test('an explicit wye identifies its node and only contains local fitting overlap', () => {
  const node: MepJunction = {
    id: 'merge', layer: 'condensate', kind: 'merge', position: { x: 1, z: 1, y: 1.99 },
    inlet_routes: ['branch-a', 'branch-b'], outlet_route: 'trunk', fitting: 'wye',
    fitting_overlap_m: 0.06, reason: 'R25 test wye, fitting extent remains a field assumption',
  };
  const routes = [
    { ...gravity('branch-a', { x: 0, z: 1, y: 2 }, { x: 1, z: 1, y: 1.99 }), to: 'merge' },
    { ...gravity('branch-b', { x: 1, z: 0, y: 2 }, { x: 1, z: 1, y: 1.99 }), to: 'merge' },
    {
      id: 'trunk', layer: 'condensate', status: 'inferred', source_status: 'plan_supported',
      construction_status: 'pending', method: 'gravity_condensate_candidate', diameter: 0.032,
      insulation_thickness: 0.006, insulation_status: 'assumed', from_height: 1.99, to_height: 0.1,
      flow_direction: 'down', slope: 0.01, from: 'merge', to: { x: 1.1, z: 1, y: 0.099 },
    },
  ];
  const candidate = config(routes, [node]);
  validateMepCoordination(candidate, emptySources);
  const result = lintMepCoordination(candidate, emptySources);
  assert.equal([...result.errors, ...result.warnings].filter((issue) => issue.code === 'route_overlap').length, 0);
  assert.ok(result.warnings.some((issue) => issue.code === 'route_overlap_declared_trunk' && issue.message.includes('merge')));
});

test('a declared wye cannot hide a long parallel overlap outside its fitting envelope', () => {
  const node: MepJunction = {
    id: 'merge', layer: 'condensate', kind: 'merge', position: { x: 2, z: 0, y: 1.98 },
    inlet_routes: ['branch-a', 'branch-b'], outlet_route: 'trunk', fitting: 'wye',
    fitting_overlap_m: 0.06, reason: 'local fitting assumption only',
  };
  const routes = [
    { ...gravity('branch-a', { x: 0, z: 0, y: 2 }, { x: 2, z: 0, y: 1.98 }), to: 'merge' },
    { ...gravity('branch-b', { x: 0, z: 0, y: 2 }, { x: 2, z: 0, y: 1.98 }), to: 'merge' },
    {
      id: 'trunk', layer: 'condensate', status: 'inferred', source_status: 'plan_supported',
      construction_status: 'pending', method: 'gravity_condensate_candidate', diameter: 0.032,
      from_height: 1.98, to_height: 0.1, flow_direction: 'down', slope: 0.01,
      from: 'merge', to: { x: 2.1, z: 0, y: 0.099 },
    },
  ];
  const result = lintMepCoordination(config(routes, [node]), emptySources);
  assert.ok([...result.errors, ...result.warnings].some((issue) => issue.code === 'route_overlap' && issue.relatedRouteId === 'branch-b'));
});

test('gravity slope checks each segment, with only the stated 1mm geometry tolerance', () => {
  const undersloped = lintMepCoordination(config([gravity('under', { x: 0, z: 0, y: 1 }, { x: 1, z: 0, y: 0.9933 })]), emptySources);
  assert.ok(undersloped.errors.some((issue) => issue.code === 'gravity_slope_below_design_target' && issue.routeId === 'under'));

  const insideGeometryTolerance = lintMepCoordination(config([gravity('rounding', { x: 0, z: 0, y: 1 }, { x: 1, z: 0, y: 0.9905 })]), emptySources);
  assert.equal(insideGeometryTolerance.errors.some((issue) => issue.code === 'gravity_slope_below_design_target'), false);

  const rising = lintMepCoordination(config([gravity('rising', { x: 0, z: 0, y: 1 }, { x: 1, z: 0, y: 1.01 })]), emptySources);
  assert.ok(rising.errors.some((issue) => issue.code === 'gravity_slope_below_design_target' && issue.routeId === 'rising'));
});

test('insulation changes both collision and ceiling-finish envelopes', () => {
  const base = gravity('pipe-a', { x: 0, z: 0, y: 2.51 }, { x: 1, z: 0, y: 2.51 });
  const separated = gravity('pipe-b', { x: 0, z: 0.03, y: 2.51 }, { x: 1, z: 0.03, y: 2.51 });
  const withoutInsulation = lintMepCoordination(config([base, separated]), emptySources);
  assert.equal([...withoutInsulation.errors, ...withoutInsulation.warnings].some((issue) => issue.code === 'route_overlap'), false);

  const assumedInsulation = { ...base, insulation_thickness: 0.006, insulation_status: 'assumed' };
  const withInsulation = lintMepCoordination(config([assumedInsulation, separated]), emptySources);
  assert.ok([...withInsulation.errors, ...withInsulation.warnings].some((issue) => issue.code === 'route_overlap'));
  assert.ok(withInsulation.warnings.some((issue) => issue.code === 'route_insulation_unverified' && issue.routeId === 'pipe-a'));

  const ceiling = [{ id: 'drop-test', room: 'test', type: 'drop', thickness: 0.3, area: [0, 0, 2, 2] }] as ProjectRenderFacts['ceiling'];
  const onePipe = (route: Record<string, unknown>, surface: ProjectRenderFacts['ceiling']) =>
    lintMepCoordination(config([route]), emptySources, { ceiling: surface });
  const protruding = onePipe(assumedInsulation, ceiling);
  assert.ok(protruding.warnings.some((issue) => issue.code === 'ceiling_clearance_unverified' && issue.message.includes('9mm')));
  const loweredFinish = onePipe(assumedInsulation, [{ ...ceiling[0], thickness: 0.32 }]);
  assert.equal(loweredFinish.warnings.some((issue) => issue.code === 'ceiling_clearance_unverified'), false);
  const raisedPipe = onePipe({ ...assumedInsulation, from_height: 2.54, to_height: 2.54, from: { x: 0, z: 0, y: 2.54 }, to: { x: 1, z: 0, y: 2.54 } }, ceiling);
  assert.equal(raisedPipe.warnings.some((issue) => issue.code === 'ceiling_clearance_unverified'), false);
});

test('R25 all-pump branches run 2.70m + 1% slope to the fixed guest-bath terminal (wye superseded)', () => {
  const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ProjectRenderFacts['electrical'];
  const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as ProjectRenderFacts['plumbing'];
  const ceiling = parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'];
  const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
  const project = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
  // 宿主墙/家具索引（issue #98 S1/S3）：与 scripts/verify/mep/verify-mep-lint.ts 同一构造；
  // S3 起沿墙点位不再声明绝对 x/z，端点解析必须带索引。
  // 二阶段 S1 起家具宿主索引须走 buildPlacementIndexes 统一解算：anchor 家具无手写 x/z，
  // 直读 x/z 的 pointMountHostIndex 会把它静默排除，锚定点位随即断引用。
  const r25Layout = resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);
  const { mountHosts: r25MountHosts } = buildPlacementIndexes({
    geometry: { walls: r25Layout.walls },
    furnishings: (parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: FurnishingsYaml }).furnishings ?? {},
  });
  const sources = endpointSourcesFromFacts(
    { electrical, plumbing, ceiling, hvac },
    pointWallIndexFromElements(r25Layout.walls),
    r25MountHosts,
  );
  validateMepCoordination(project, sources);
  // 2026-11-14 全带泵重画：R25 显式汇流节点 condensate_living_dining_merge 已删除，
  // 五条支管改直达客卫固定候选点 (6.70,3.70)；MEP 侧不再有任何 junction。
  assert.equal(project.junctions.length, 0);
  const branchIds = ['condensate-master', 'condensate-living', 'condensate-dining', 'condensate-parent', 'condensate-child'];
  const resolved = resolveMepRoutes(project, sources).routes;
  // 固定候选点声明位置（hvac.yaml condensate_living_candidate，2026-10-05 业主裁定改线）：
  // 五条支管的终端平面须与之一致，标高由 1% 坡派生，不钉 (6.70,3.70) 字面。
  const candidate = sources.hvacTerminals.find((t) => t.id === 'condensate_living_candidate')!.position!;
  for (const id of branchIds) {
    const entry = resolved.find((item) => item.route.id === id)!;
    assert.equal(entry.unresolved.length, 0, `${id} must resolve`);
    const route = entry.route;
    assert.equal(route.to, 'condensate_living_candidate');
    // 2.70m 泵抬顶与 1% 坡为已裁定设计值（2026-11-13/14 全带泵重画；坡度≥1% 业界最佳实践），钉值保留。
    assert.equal(route.from_height, 2.70);
    assert.equal(route.slope, 0.01);
    assert.equal(route.route_kind, 'candidate');
    assert.ok(route.method?.includes('pump'));
    assert.equal(route.to_height, undefined, `${id} must not declare to_height: the terminal height is derived from the last slope_run`);
    const points = entry.points;
    assert.equal(points[0].y, 2.70, `${id} starts at the pump-lift top`);
    const terminal = points[points.length - 1];
    assert.ok(Math.abs(terminal.x - candidate.x) <= 1e-9 && Math.abs(terminal.z - candidate.z) <= 1e-9,
      `${id} terminal 平面须为候选点声明位置 (${candidate.x},${candidate.z})`);
    assert.ok(Math.abs(terminal.y! - (route.from_height - route.slope! * planLength(points))) <= 0.001,
      `${id} terminal 标高须为 from_height − 坡度×行程`);
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1], b = points[index];
      const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
      if (horizontal < 1e-6) continue;
      const fall = a.y! - b.y!;
      assert.ok(fall >= 0, `${id} segment ${index} rises`);
      assert.ok(Math.abs(fall - 0.01 * horizontal) <= 0.001, `${id} segment ${index} is not a 1% slope (fall ${fall} over ${horizontal})`);
      assert.ok(Math.abs(b.x - a.x) < 1e-9 || Math.abs(b.z - a.z) < 1e-9, `${id} segment ${index} is not orthogonal in plan`);
    }
  }
  // DN32 主管：from 由节点 id 改内联坐标；折线由声明派生（起点=from+from_height，
  // 中点=from 处竖降至末段坡度起算高，末点=候选点声明位置），不与旧几何逐点对照。
  const trunk = resolved.find((item) => item.route.id === 'condensate-living-dining-trunk')!;
  assert.ok(typeof trunk.route.from === 'object' && trunk.route.from !== null, 'trunk from 须为内联坐标（节点 id 已删）');
  assert.equal(trunk.route.to, 'condensate_living_candidate');
  const trunkFrom = trunk.route.from as { x: number; z: number };
  const trunkPoints = trunk.points;
  assert.equal(trunkPoints.length, 3, 'trunk 须为 from→竖降落点→候选点三点');
  assert.ok(Math.abs(trunkPoints[0].x - trunkFrom.x) <= 1e-9 && Math.abs(trunkPoints[0].z - trunkFrom.z) <= 1e-9, 'trunk 起点平面须为 from');
  assert.ok(Math.abs(trunkPoints[0].y! - trunk.route.from_height!) <= 1e-9, 'trunk 起点标高须为 from_height');
  const trunkTerminal = trunkPoints[trunkPoints.length - 1];
  assert.ok(Math.abs(trunkTerminal.x - candidate.x) <= 1e-9 && Math.abs(trunkTerminal.z - candidate.z) <= 1e-9,
    `trunk 末点平面须为候选点声明位置 (${candidate.x},${candidate.z})`);
  assert.ok(Math.abs(trunkTerminal.y! - (candidate.y ?? trunk.route.to_height)) <= 1e-9, 'trunk 末点标高须为候选点声明高度');
  // 中点与起点同平面（from 处竖降），末段按 1% 坡起算：中点 y = 末点 y + 坡度×末段水平行程。
  assert.ok(Math.abs(trunkPoints[1].x - trunkFrom.x) <= 1e-9 && Math.abs(trunkPoints[1].z - trunkFrom.z) <= 1e-9, 'trunk 中点须与起点同平面（竖降段）');
  const trunkLastRun = Math.hypot(trunkTerminal.x - trunkPoints[1].x, trunkTerminal.z - trunkPoints[1].z);
  assert.ok(Math.abs(trunkPoints[1].y! - (trunkTerminal.y! + trunk.route.slope! * trunkLastRun)) <= 0.001, 'trunk 中点标高须为末段 1% 坡起算高');
  // 东南客房（condensate-study）终端待定，本批不动：仍为旧绝对重力路由。
  const study = resolved.find((item) => item.route.id === 'condensate-study')!;
  assert.equal(study.route.to, 'condensate_study_candidate');

  const targetIds = new Set([
    ...branchIds, 'condensate-living-dining-trunk',
    'strong-main', 'supply-air-living-bottom', 'return-air-living',
    'supply-air-dining-bottom', 'return-air-dining',
  ]);
  const subset = { ...project, routes: project.routes.filter((route) => targetIds.has(route.id)) };
  const result = lintMepCoordination(subset, sources, { ceiling });
  assert.equal(result.warnings.some((issue) => issue.code === 'route_overlap_declared_trunk'), false);
  const overlaps = [...result.errors, ...result.warnings].filter((issue) => issue.code === 'route_overlap');
  // 五条支管共用一个终端点：10 对中有 9 对在终端区重叠（客厅–餐厅到点标高差 0.0471m，
  // 超出包络半径和 0.037m，逃过）；其余子集内不得再有任何 route_overlap。
  const pairKey = (issue: { routeId?: string; relatedRouteId?: string }) => [issue.routeId, issue.relatedRouteId].sort().join('↔');
  const overlapPairs = [...new Set(overlaps.map(pairKey))].sort();
  assert.equal(overlaps.length, 9);
  assert.ok(overlaps.every((issue) => issue.level === 'warning'));
  assert.deepEqual(overlapPairs, [
    'condensate-child↔condensate-dining',
    'condensate-child↔condensate-living',
    'condensate-child↔condensate-master',
    'condensate-child↔condensate-parent',
    'condensate-dining↔condensate-master',
    'condensate-dining↔condensate-parent',
    'condensate-living↔condensate-master',
    'condensate-living↔condensate-parent',
    'condensate-master↔condensate-parent',
  ]);
});
