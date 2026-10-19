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
import type { ProjectRenderFacts } from '../../shared/types.js';

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

test('R25 project branches meet one declared wye and meet their declared minimum slopes', () => {
  const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ProjectRenderFacts['electrical'];
  const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as ProjectRenderFacts['plumbing'];
  const ceiling = parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'];
  const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
  const project = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
  const sources = endpointSourcesFromFacts({ electrical, plumbing, ceiling, hvac });
  validateMepCoordination(project, sources);
  const misalignedAnchor = {
    ...sources,
    hvacAnchors: sources.hvacAnchors.map((anchor) => anchor.id === 'condensate_living_dining_merge'
      ? { ...anchor, position: { ...anchor.position!, x: anchor.position!.x + 0.01 } }
      : anchor),
  };
  assert.throws(() => validateMepCoordination(project, misalignedAnchor), /does not match its HVAC anchor/);
  const targetIds = new Set([
    'condensate-living', 'condensate-dining', 'condensate-living-dining-trunk',
    'strong-main', 'supply-air-living-bottom', 'return-air-living',
    'supply-air-dining-bottom', 'return-air-dining',
  ]);
  const subset = { ...project, routes: project.routes.filter((route) => targetIds.has(route.id)) };
  const result = lintMepCoordination(subset, sources, { ceiling });
  assert.equal([...result.errors, ...result.warnings].some((issue) => issue.code === 'route_overlap'
    && ((issue.routeId !== undefined && targetIds.has(issue.routeId))
      || (issue.relatedRouteId !== undefined && targetIds.has(issue.relatedRouteId)))), false);
  assert.ok(result.warnings.some((issue) => issue.code === 'route_overlap_declared_trunk' && issue.message.includes('condensate_living_dining_merge')));

  const resolved = resolveMepRoutes(project, sources).routes;
  for (const id of ['condensate-living', 'condensate-dining']) {
    const entry = resolved.find((item) => item.route.id === id)!;
    const points = [
      { ...entry.from!, y: entry.route.from_height ?? entry.from!.y },
      ...entry.route.via,
      { ...entry.to!, y: entry.route.to_height ?? entry.to!.y },
    ];
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1], b = points[index];
      const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
      if (horizontal < 1e-6) continue;
      assert.ok((a.y! - b.y!) + 0.001 >= (entry.route.slope ?? 0) * horizontal, `${id} segment ${index} falls below its declared minimum`);
    }
  }
});
