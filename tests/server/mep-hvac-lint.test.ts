import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { endpointSourcesFromFacts, MepCoordinationSchema, parseMepCoordination } from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination, type MepLintLayoutContext } from '../../shared/mep-hvac-lint.js';
import type { ProjectRenderFacts, ResolvedLayout } from '../../shared/types.js';

const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ProjectRenderFacts['electrical'];
const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as ProjectRenderFacts['plumbing'];
const ceiling = parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'];
const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
const config = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
const sources = endpointSourcesFromFacts({ electrical, plumbing, ceiling, hvac });
const layers = Object.fromEntries(['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'].map((id) => [id, { label: id, color: '#fff', height: 2 }])) as ProjectRenderFacts extends never ? never : typeof config.layers;

function sample(route: Record<string, unknown>) {
  return MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes: [route] });
}

test('real MEP configuration lints without false errors and reports warnings structurally', () => {
  const result = lintMepCoordination(config, sources);
  assert.equal(result.counts.routes, 40);
  assert.equal(result.counts.resolvedRoutes, 40);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((issue) => issue.code === 'hvac_coverage_missing').length, 0);
  assert.equal(result.warnings.length, 9);
  assert.ok(result.warnings.some((issue) => issue.code === 'supply_return_overlap'));
  assert.ok(result.warnings.some((issue) => issue.code === 'nonphysical_route'));
  const balcony = config.routes.find((r) => r.id === 'drain-balcony')!;
  assert.equal(balcony.from_height, 0.60);
  assert.equal(balcony.to_height, 0.02);
});

test('missing power relation remains a coverage warning without an equivalent endpoint route', () => {
  const withoutMasterPower = {
    ...config,
    routes: config.routes.filter((route) => route.id !== 'strong-ac-master'),
  };
  const result = lintMepCoordination(withoutMasterPower, sources);
  assert.ok(result.warnings.some((issue) => issue.code === 'hvac_coverage_missing' && issue.routeId === 'indoor_master'));
});

test('self-connection is warning for pending requirement and error when confirmed', () => {
  const pending = lintMepCoordination(sample({ id: 'same', layer: 'drainage', status: 'pending', source_status: 'design_requirement', from: { x: 1, z: 1 }, to: { x: 1, z: 1 }, via: [] }), sources);
  assert.ok(pending.warnings.some((i) => i.code === 'degenerate_requirement'));
  const confirmed = lintMepCoordination(sample({ id: 'same', layer: 'drainage', status: 'confirmed', source_status: 'plan_supported', from: { x: 1, z: 1 }, to: { x: 1, z: 1 }, via: [] }), sources);
  assert.ok(confirmed.errors.some((i) => i.code === 'confirmed_self_connection'));
});

test('dimension semantics, missing gravity slope, and complete via route overlap are linted', () => {
  const result = lintMepCoordination(sample({ id: 'duct', layer: 'supply_air', status: 'pending', from: { x: 0, z: 0 }, via: [{ x: 1, z: 0, y: 2 }], to: { x: 2, z: 0 }, diameter: 0.2 }), sources);
  assert.ok(result.warnings.some((i) => i.code === 'diameter_not_for_duct'));
  assert.ok(result.warnings.some((i) => i.code === 'duct_dimension_incomplete'));
  const gravity = lintMepCoordination(sample({ id: 'gravity', layer: 'drainage', status: 'pending', source_status: 'plan_supported', method: 'gravity_floor_drain', from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, diameter: 0.075 }), sources);
  assert.ok(gravity.warnings.some((i) => i.code === 'gravity_slope_pending'));
  const explicitGravity = lintMepCoordination(sample({ id: 'gravity-explicit', layer: 'drainage', status: 'pending', source_status: 'plan_supported', method: 'gravity_floor_drain', flow_direction: 'downstream', from_height: 0.1, to_height: 0.2, from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, diameter: 0.075 }), sources);
  assert.ok(explicitGravity.errors.some((i) => i.code === 'gravity_direction_height_conflict'));
  const crossing = lintMepCoordination(sample({ id: 'cross', layer: 'strong_power', status: 'confirmed', source_status: 'plan_supported', diameter: 0.05, from_height: 2, to_height: 2, from: { x: 0, z: 0, y: 2 }, via: [{ x: 1, z: 0, y: 2 }], to: { x: 2, z: 0, y: 2 } }), sources);
  assert.ok(crossing.warnings.some((i) => i.code === 'round_dimension_missing') === false);
});

test('rectangular ducts require width, depth, and height while round routes use diameter', () => {
  const rectangular = lintMepCoordination(sample({ id: 'rect', layer: 'supply_air', status: 'pending', method: 'rectangular', width: 0.3, depth: 0.2, height: 0.15, from: { x: 0, z: 0, y: 2 }, to: { x: 1, z: 0, y: 2 } }), sources);
  assert.equal(rectangular.warnings.some((i) => i.code === 'duct_dimension_incomplete'), false);
  const round = lintMepCoordination(sample({ id: 'round', layer: 'refrigerant', status: 'pending', diameter: 0.03, from: { x: 0, z: 0, y: 2 }, to: { x: 1, z: 0, y: 2 } }), sources);
  assert.equal(round.warnings.some((i) => i.code === 'round_dimension_missing'), false);
});

test('same-anchor supply and return overlap is warning, while separated heights do not overlap', () => {
  const overlap = MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes: [
    { id: 'supply', layer: 'supply_air', status: 'inferred', source_status: 'preliminary', method: 'rectangular', width: 0.3, depth: 0.2, from_height: 2.68, to_height: 2.68, from: 'indoor_living', via: [{ x: 1, z: 0, y: 2.68 }], to: { x: 2, z: 0, y: 2.68 } },
    { id: 'return', layer: 'return_air', status: 'inferred', source_status: 'preliminary', method: 'rectangular', width: 0.3, depth: 0.2, from_height: 2.70, to_height: 2.70, from: 'indoor_living', via: [{ x: 1, z: 0, y: 2.70 }], to: { x: 2, z: 0, y: 2.70 } },
  ] });
  const overlapResult = lintMepCoordination(overlap, sources);
  assert.equal(overlapResult.errors.some((i) => i.code === 'supply_return_overlap'), false);
  assert.ok(overlapResult.warnings.some((i) => i.code === 'supply_return_overlap'));
  const separated = structuredClone(overlap);
  separated.routes[1].from_height = 3;
  separated.routes[1].to_height = 3;
  separated.routes[1].via[0].y = 3;
  const separatedResult = lintMepCoordination(separated, sources);
  assert.equal(separatedResult.warnings.some((i) => i.code === 'supply_return_overlap'), false);
});

test('coincident requirement/candidate emits one clear warning', () => {
  const result = lintMepCoordination(sample({ id: 'same-candidate', layer: 'water_supply', status: 'pending', source_status: 'design_requirement', from: { x: 1, z: 1 }, to: { x: 1, z: 1 }, via: [] }), sources);
  const routeWarnings = result.warnings.filter((i) => i.routeId === 'same-candidate');
  assert.equal(routeWarnings.filter((i) => i.code === 'degenerate_requirement').length, 1);
  assert.equal(routeWarnings.some((i) => i.code === 'nonphysical_route'), false);
});

test('shared trunk and branch overlap is excluded from normal route-overlap warnings', () => {
  const shared = MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes: [
    { id: 'trunk', layer: 'refrigerant', status: 'inferred', source_status: 'preliminary', diameter: 0.03, from: { x: 0, z: 0, y: 2 }, to: 'indoor_living' },
    { id: 'branch', layer: 'refrigerant', status: 'inferred', source_status: 'preliminary', diameter: 0.02, from: 'indoor_living', to: { x: 1, z: 0, y: 2 } },
  ] });
  const result = lintMepCoordination(shared, sources);
  assert.equal(result.warnings.some((i) => i.code === 'route_overlap'), false);
});

test('verify:mep JSON has stable result and exit contract', () => {
  const output = execFileSync('npx', ['tsx', 'scripts/verify/mep/verify-mep-lint.ts', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const result = JSON.parse(output) as { errors: unknown[]; warnings: unknown[]; counts: { errors: number } };
  assert.ok(Array.isArray(result.errors));
  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.counts.errors, 0);
});

// ── 结构墙 / 梁碰撞规则（2026-09-01）──

function wallContext(wall: Record<string, unknown>, constraints?: MepLintLayoutContext['referenceConstraints']): MepLintLayoutContext {
  return {
    layout: { rooms: [], vertices: [], openEdges: [], walls: [{ id: 'w_test', x1: 1, z1: -1, x2: 1, z2: 1, height: 2.8, ...wall }] } as unknown as ResolvedLayout,
    ...(constraints ? { referenceConstraints: constraints } : {}),
  };
}
function crossingRoute(extra: Record<string, unknown> = {}) {
  return sample({ id: 'cross', layer: 'refrigerant', status: 'inferred', source_status: 'preliminary', diameter: 0.02, from_height: 2.5, to_height: 2.5, from: { x: 0, z: 0, y: 2.5 }, to: { x: 2, z: 0, y: 2.5 }, ...extra });
}

test('shear wall penetration warns when inferred and errors only when wall and route are both confirmed', () => {
  const inferred = lintMepCoordination(crossingRoute(), sources, wallContext({ structure: 'shear', structure_status: 'inferred' }));
  assert.ok(inferred.warnings.some((i) => i.code === 'shear_wall_penetration'));
  assert.equal(inferred.errors.some((i) => i.code === 'shear_wall_penetration'), false);
  const routeConfirmedOnly = lintMepCoordination(crossingRoute({ status: 'confirmed', reason: 'x' }), sources, wallContext({ structure: 'shear', structure_status: 'inferred' }));
  assert.equal(routeConfirmedOnly.errors.some((i) => i.code === 'shear_wall_penetration'), false);
  const bothConfirmed = lintMepCoordination(crossingRoute({ status: 'confirmed', reason: 'x' }), sources, wallContext({ structure: 'shear', structure_status: 'confirmed' }));
  assert.ok(bothConfirmed.errors.some((i) => i.code === 'shear_wall_penetration'));
});

test('per-wall penetration declaration is required and its point must match the actual crossing', () => {
  const missing = lintMepCoordination(crossingRoute(), sources, wallContext({}));
  assert.ok(missing.warnings.some((i) => i.code === 'penetration_missing'));
  const missingConfirmed = lintMepCoordination(crossingRoute({ status: 'confirmed', reason: 'x' }), sources, wallContext({}));
  assert.ok(missingConfirmed.errors.some((i) => i.code === 'penetration_missing'));
  const aligned = lintMepCoordination(crossingRoute({ penetration: [{ wall: 'w_test', at: { x: 1, z: 0 }, height: 2.5 }] }), sources, wallContext({}));
  assert.equal(aligned.warnings.some((i) => i.code === 'penetration_missing' || i.code === 'penetration_point_mismatch'), false);
  const off = lintMepCoordination(crossingRoute({ penetration: [{ wall: 'w_test', at: { x: 1, z: 0.5 }, height: 2.5 }] }), sources, wallContext({}));
  assert.ok(off.warnings.some((i) => i.code === 'penetration_point_mismatch'));
});

test('beam collision errors only for confirmed constraints with a beam bottom datum', () => {
  const constraint = { id: 'ref_beam', range: { x1: 0.5, x2: 1.5, z1: -0.5, z2: 0.5 }, status: 'confirmed', reference_beam_bottom_y: 2.4 };
  const hit = lintMepCoordination(crossingRoute(), sources, wallContext({}, [constraint]));
  assert.ok(hit.errors.some((i) => i.code === 'beam_collision'));
  const below = lintMepCoordination(crossingRoute({ from: { x: 0, z: 0, y: 2.2 }, to: { x: 2, z: 0, y: 2.2 }, from_height: 2.2, to_height: 2.2 }), sources, wallContext({}, [constraint]));
  assert.equal(below.errors.some((i) => i.code === 'beam_collision'), false);
  const inferredConstraint = lintMepCoordination(crossingRoute(), sources, wallContext({}, [{ ...constraint, status: 'inferred' }]));
  assert.equal(inferredConstraint.errors.some((i) => i.code === 'beam_collision'), false);
  assert.ok(inferredConstraint.warnings.some((i) => i.code === 'reference_constraint_uncertain'));
  const confirmedNotice = lintMepCoordination(crossingRoute({ from: { x: 0, z: 0, y: 2.2 }, to: { x: 2, z: 0, y: 2.2 }, from_height: 2.2, to_height: 2.2 }), sources, wallContext({}, [constraint]));
  assert.equal(confirmedNotice.warnings.some((i) => i.code === 'reference_constraint_uncertain'), false);
});
