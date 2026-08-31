import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  MepCoordinationSchema,
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
  validateMepCoordination,
  type MepEndpointSources,
} from '../../shared/mep-hvac-coordination-schema.js';
import type { ElectricalPoint, PlumbingPoint, ProjectRenderFacts } from '../../shared/types.js';

const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];
const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as PlumbingPoint[];
const config = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
const sources: MepEndpointSources = { electrical, plumbing, ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };

function sourceIds(): MepEndpointSources {
  return {
    ...sources,
    hvacAnchors: ['outdoor_a2', 'indoor_living', 'indoor_master', 'indoor_study', 'indoor_parent', 'indoor_child', 'bend_corridor'].map((id) => ({ id, status: 'inferred', system: 'refrigerant' as const, position: { x: 0, y: 0, z: 0 } })),
    hvacTerminals: ['supply_living', 'return_living', 'supply_master', 'return_master', 'supply_study', 'return_study', 'supply_parent', 'return_parent', 'supply_child', 'return_child', 'condensate_living_candidate', 'condensate_master_candidate', 'condensate_study_candidate', 'condensate_parent_candidate', 'condensate_child_candidate', 'net_unused'].map((id) => ({ id, status: 'pending', system: id.startsWith('supply') ? 'supply_air' as const : id.startsWith('return') ? 'return_air' as const : 'condensate' as const, position: { x: 0, y: 0, z: 0 } })),
    outdoor: [{ id: 'outdoor_a2', platform: 'west_platform', x: 6.4, z: 0.5, direction: 'south', width: 0.9, depth: 0.335, height: 0.7, model: 'test' }],
  };
}

test('MEP proposal parses with evidence and pending construction metadata', () => {
  assert.ok(config.routes.length >= 20);
  assert.ok(config.routes.every((route) => route.source_status));
  assert.ok(config.routes.every((route) => route.construction_status === 'pending'));
  assert.ok(config.routes.some((route) => route.source_status === 'plan_supported' && route.layer === 'drainage'));
  assert.ok(config.routes.some((route) => route.source_status === 'design_requirement' && route.layer === 'water_supply'));
  validateMepCoordination(config, sourceIds());
});

test('legacy routes receive preliminary and pending defaults', () => {
  const legacy = MepCoordinationSchema.parse({
    version: '1', status: 'preliminary', layers: {
      strong_power: { label: '强电', color: '#f00', height: 2 },
      weak_power: { label: '弱电', color: '#f0f', height: 2 },
      water_supply: { label: '给水', color: '#0af', height: 0.2 },
      drainage: { label: '排水', color: '#0a0', height: 0.1 },
      refrigerant: { label: '冷媒', color: '#f70', height: 2.5 },
      condensate: { label: '冷凝水', color: '#0cc', height: 2.3 },
      supply_air: { label: '送风', color: '#fc0', height: 2.6 },
      return_air: { label: '回风', color: '#a60', height: 2.7 },
    },
    routes: [{ id: 'legacy', layer: 'strong_power', status: 'inferred', from: { x: 0, z: 0 }, to: { x: 1, z: 1 } }],
  });
  assert.equal(legacy.routes[0].source_status, 'preliminary');
  assert.equal(legacy.routes[0].construction_status, 'pending');
});

test('MEP semantic validation rejects dangling, duplicate, invalid dimensions, and confirmed plumbing', () => {
  const dangling = structuredClone(config);
  dangling.routes[0].to = 'missing_endpoint';
  assert.throws(() => validateMepCoordination(dangling, sourceIds()), /unknown endpoint/);

  const duplicate = structuredClone(config);
  duplicate.routes[1].id = duplicate.routes[0].id;
  assert.throws(() => validateMepCoordination(duplicate, sourceIds()), /Duplicate MEP route id/);

  const invalidDimension = structuredClone(config);
  invalidDimension.routes[0].diameter = 0;
  assert.throws(() => validateMepCoordination(invalidDimension, sourceIds()), /must be positive/);

  const confirmedPlumbing = structuredClone(config);
  const plumbingRoute = confirmedPlumbing.routes.find((route) => route.layer === 'drainage')!;
  plumbingRoute.construction_status = 'confirmed';
  assert.throws(() => validateMepCoordination(confirmedPlumbing, sourceIds()), /must remain construction_status: pending/);
});

test('MEP route resolution reports direct coordinates, HVAC refs, and unresolved endpoints', () => {
  const testConfig = MepCoordinationSchema.parse({
    version: '1', status: 'preliminary', layers: Object.fromEntries(['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'].map((layer) => [layer, { label: layer, color: '#fff', height: 2 }])), routes: [
      { id: 'direct', layer: 'refrigerant', status: 'inferred', from: { x: 1, z: 2 }, to: 'anchor_ref' },
      { id: 'bad', layer: 'refrigerant', status: 'inferred', from: 'anchor_missing_position', to: 'missing' },
    ],
  });
  const testSources = { ...sourceIds(), hvacAnchors: [
    { id: 'anchor_ref', status: 'inferred' as const, system: 'refrigerant' as const, ref: { source: 'outdoor' as const, id: 'outdoor_a2' } },
    { id: 'anchor_missing_position', status: 'inferred' as const, system: 'refrigerant' as const },
  ] };
  const report = resolveMepRoutes(testConfig, testSources);
  assert.equal(report.total, 2);
  assert.equal(report.resolved, 1);
  assert.equal(report.unresolved, 1);
  assert.deepEqual(report.routes[0].from, { x: 1, z: 2 });
  assert.deepEqual(report.routes[0].to, { x: 6.4, z: 0.5 });
  assert.deepEqual(report.routes[1].unresolved, ['from', 'to']);
  assert.throws(() => validateMepCoordination(testConfig, testSources), /endpoint is unresolved/);
});

test('design requirement plumbing routes cannot reference authoritative plumbing points', () => {
  const invalid = structuredClone(config);
  const route = invalid.routes.find((item) => item.source_status === 'design_requirement' && item.layer === 'water_supply')!;
  route.from = 'faucet_kitchen_sink';
  assert.throws(() => validateMepCoordination(invalid, sourceIds()), /must not imply an authoritative plumbing endpoint/);
});

test('real render facts resolve all configured MEP routes through HVAC ceiling and electrical refs', () => {
  const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
  const ceiling = parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'];
  const facts = { electrical, plumbing, ceiling, hvac };
  const factSources = endpointSourcesFromFacts(facts);
  const report = resolveMepRoutes(config, factSources);
  assert.equal(report.total, 39);
  assert.equal(report.resolved, 39);
  assert.equal(report.unresolved, 0);
  const expectedAirRoutes = ['supply-air-study', 'return-air-study', 'supply-air-parent', 'return-air-parent', 'supply-air-child', 'return-air-child'];
  const expectedCondensateRoutes = ['condensate-living', 'condensate-master', 'condensate-study', 'condensate-parent', 'condensate-child'];
  for (const id of [...expectedAirRoutes, ...expectedCondensateRoutes]) {
    const resolved = report.routes.find((item) => item.route.id === id)!;
    assert.equal(resolved.unresolved.length, 0);
    if (id.startsWith('condensate-')) assert.equal(resolved.metadata.pendingReview, true);
  }
  assert.equal(new Set(config.routes.filter((route) => route.layer === 'supply_air').map((route) => route.to)).size, 5);
  assert.equal(new Set(config.routes.filter((route) => route.layer === 'return_air').map((route) => route.to)).size, 5);
  assert.equal(config.routes.filter((route) => route.layer === 'condensate').length, 5);
  validateMepCoordination(config, factSources);
});

test('degenerate candidate routes are never physical or confirmed', () => {
  const candidate = MepCoordinationSchema.parse({ ...config, routes: [{ ...config.routes[0], id: 'degenerate', from: { x: 1, z: 1 }, to: { x: 1, z: 1 }, status: 'inferred' }] });
  const report = resolveMepRoutes(candidate, sourceIds());
  assert.equal(report.routes[0].metadata.physicalRoute, false);
  const confirmed = structuredClone(candidate);
  confirmed.routes[0].status = 'confirmed';
  assert.throws(() => validateMepCoordination(confirmed, sourceIds()), /degenerate self-connection/);
});

test('gravity condensate resolution carries pending warning metadata', () => {
  const route = config.routes.find((item) => item.id === 'condensate-study')!;
  const report = resolveMepRoutes({ ...config, routes: [route] }, endpointSourcesFromFacts({ electrical, plumbing, ceiling: parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'], hvac: parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'] }));
  assert.equal(report.routes[0].metadata.pendingReview, true);
  assert.match(report.routes[0].metadata.warning ?? '', /重力冷凝水候选路线/);
  assert.equal(route.status, 'pending');
});
