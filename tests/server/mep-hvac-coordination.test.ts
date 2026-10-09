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
    // 注：'outdoor_a2' 不能出现在 hvacAnchors 里——shared/mep-hvac-coordination-schema.ts:137-144 的
    // registerSources 禁止同一 id 跨 kind 重复注册（hvac anchor vs VRF outdoor），否则 validateMepCoordination
    // 第一句就抛 "Duplicate MEP endpoint id outdoor_a2"，把本文件所有测试挡在断言之前。
    // 真实生产路径 endpointSourcesFromFacts（schema:214-226）从 plan.diagram.anchors 与 plan.outdoor 分建、
    // id 不重叠，所以生产不会撞车；此前夹具把 outdoor_a2 同时塞进两个 kind 是测试自身写错。
    // outdoor_a2 仍由下面的 outdoor 条目提供，sources.outdoor 一样能解析到 (6.4, 0.5)。
    hvacAnchors: ['indoor_living', 'indoor_dining', 'indoor_master', 'indoor_study', 'indoor_parent', 'indoor_child', 'bend_corridor'].map((id) => ({ id, status: 'inferred', system: 'refrigerant' as const, position: { x: 0, y: 0, z: 0 } })),
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
  assert.equal(report.total, 137); // 80→87（DEC-2026-10-06-R1 给排水兜底）→92（2026-10-07 v1 水路估算：6 条要求提升 + 5 条干管）→102（2026-10-07 DEC-2026-10-07-M04 声明式补客客厅 ordinary_power_living 十条路由）→137（2026-10-07 之后 config/mep-hvac-coordination.yaml 继续补路由，本处只跟随增长）
  // 路线数随 config/mep-hvac-coordination.yaml 增长；改这个数之前先跑 `npm run verify:mep` 确认 resolved/unresolved 结构没变（resolved=137/unresolved=0 才算健康）
  assert.equal(report.resolved, 137); // 与 total 同步：137 条全部解析成功，无 unresolved
  assert.equal(report.unresolved, 0);
  const expectedAirRoutes = ['supply-air-study', 'return-air-study', 'supply-air-parent', 'return-air-parent', 'supply-air-child', 'return-air-child'];
  const expectedCondensateRoutes = ['condensate-living', 'condensate-master', 'condensate-study', 'condensate-parent', 'condensate-child'];
  for (const id of [...expectedAirRoutes, ...expectedCondensateRoutes]) {
    const resolved = report.routes.find((item) => item.route.id === id)!;
    assert.equal(resolved.unresolved.length, 0);
    if (id.startsWith('condensate-')) assert.equal(resolved.metadata.pendingReview, true);
  }
  assert.equal(new Set(config.routes.filter((route) => route.layer === 'supply_air').map((route) => route.to)).size, 8); // DEC-2026-10-03-R6：+supply-air-dining；DEC-2026-10-05-R18：两台双出风内机第二出口下出风，+supply-air-living-bottom/+supply-air-dining-bottom，6→8
  assert.equal(new Set(config.routes.filter((route) => route.layer === 'return_air').map((route) => route.to)).size, 6); // DEC-2026-10-03-R6：+return-air-dining
  assert.equal(config.routes.filter((route) => route.layer === 'condensate').length, 6); // DEC-2026-10-03-R6：+condensate-dining
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
