import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  MepCoordinationSchema,
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepEndpoint,
  resolveMepRoutes,
  validateMepCoordination,
  type MepEndpointSources,
} from '../../shared/mep-hvac-coordination-schema.js';
import type { ElectricalPoint, PlumbingPoint, ProjectRenderFacts, VertexLayoutYaml } from '../../shared/types.js';
import { pointMountHostIndex, pointWallIndexFromElements, resolvePointPlacementInWalls } from '../../shared/point-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';

const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];
const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as PlumbingPoint[];
const config = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
const sources: MepEndpointSources = { electrical, plumbing, ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };

/** 真实宿主墙/家具索引（与 scripts/verify/mep/verify-mep-lint.ts 同一构造）。 */
const realPointWalls = pointWallIndexFromElements(
  resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml).walls,
);
const realMountHosts = pointMountHostIndex(
  Object.values((parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: Record<string, Array<Record<string, unknown>>> }).furnishings ?? {}).flat() as never,
);

function sourceIds(): MepEndpointSources {
  return {
    ...sources,
    // 宿主墙/家具索引（issue #98 S3）：沿墙点位不再声明绝对 x/z，本夹具跑的是真实点位表，
    // 端点解析必须带索引（否则 validate 第一轮就抛 "endpoint is unresolved" 挡住后面全部断言）。
    pointWalls: realPointWalls,
    mountHosts: realMountHosts,
    // 注：'outdoor_a2' 不能出现在 hvacAnchors 里——shared/mep-hvac-coordination-schema.ts:137-144 的
    // registerSources 禁止同一 id 跨 kind 重复注册（hvac anchor vs VRF outdoor），否则 validateMepCoordination
    // 第一句就抛 "Duplicate MEP endpoint id outdoor_a2"，把本文件所有测试挡在断言之前。
    // 真实生产路径 endpointSourcesFromFacts（schema:214-226）从 plan.diagram.anchors 与 plan.outdoor 分建、
    // id 不重叠，所以生产不会撞车；此前夹具把 outdoor_a2 同时塞进两个 kind 是测试自身写错。
    // outdoor_a2 仍由下面的 outdoor 条目提供，sources.outdoor 一样能解析到 (6.4, 0.5)。
    hvacAnchors: [...['indoor_living', 'indoor_dining', 'indoor_master', 'indoor_study', 'indoor_parent', 'indoor_child', 'bend_corridor'].map((id) => ({ id, status: 'inferred' as const, system: 'refrigerant' as const, position: { x: 0, y: 0, z: 0 } })),
      // DEC-2026-10-19-R25 汇流拓扑新增的两个出水口候选锚点（与 hvac.yaml/facts 口径一致：pending / condensate）——bf29283 当时漏同步本夹具，validate 在此抛 unknown endpoint
      { id: 'condensate_living_outlet_candidate', status: 'pending' as const, system: 'condensate' as const, position: { x: 0, y: 0, z: 0 } },
      { id: 'condensate_dining_outlet_candidate', status: 'pending' as const, system: 'condensate' as const, position: { x: 0, y: 0, z: 0 } }],
    // issue #98 S2 改绑：return-air-living 等 5 条送/回风路线的 to 由 inline 坐标改为 terminal id，
    // 夹具须提供 supply_dining / return_dining / supply_living_bottom / supply_dining_bottom 的存在性
    // （否则 validateMepCoordination 以 "references unknown endpoint" 挡住——那是夹具缺口，不是配置错）。
    hvacTerminals: ['supply_living', 'return_living', 'supply_dining', 'return_dining', 'supply_living_bottom', 'supply_dining_bottom', 'supply_master', 'return_master', 'supply_study', 'return_study', 'supply_parent', 'return_parent', 'supply_child', 'return_child', 'condensate_living_candidate', 'condensate_master_candidate', 'condensate_study_candidate', 'condensate_parent_candidate', 'condensate_child_candidate', 'net_unused'].map((id) => ({ id, status: 'pending', system: id.startsWith('supply') ? 'supply_air' as const : id.startsWith('return') ? 'return_air' as const : 'condensate' as const, position: { x: 0, y: 0, z: 0 } })),
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
  const ceiling = parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'];
  const facts = { electrical, plumbing, ceiling, hvac };
  // 宿主墙/家具索引（issue #98 S1/S3）：沿墙点位不再声明绝对 x/z，端点解析与生产同一构造。
  const factSources = endpointSourcesFromFacts(facts, realPointWalls, realMountHosts);
  const report = resolveMepRoutes(config, factSources);
  assert.equal(report.total, 137); // DEC-2026-10-27-R01 删床头路线 strong-light-bedrooms-parent-bed 后 138→137； // 80→87（DEC-2026-10-06-R1 给排水兜底）→92（2026-10-07 v1 水路估算：6 条要求提升 + 5 条干管）→102（2026-10-07 DEC-2026-10-07-M04 声明式补客客厅 ordinary_power_living 十条路由）→137（2026-10-07 之后 config/mep-hvac-coordination.yaml 继续补路由）→135（DEC-2026-10-12-R1 删 strong-light-bedrooms-master-wall-l/-r 两条路由）→131（DEC-2026-10-12-R2 业主裁定两卫照明用浴霸三合一自带，删 strong-light-gbath / -mbath-panel / -mbath-switch / -gbath-switch 四条卫浴照明路由）→130（DEC-2026-10-13-R5 删 strong-light-tv）→128（DEC-2026-10-17-R20 删 strong-ded-fridge / strong-power-parent-child-parentbed-l，冰箱改由 sock_fridge_living 就近取电）→135（DEC-2026-10-17-R20 走线专项为 7 个新点位补 7 条路线）→136（DEC-2026-10-18-R21 补画 strong-power-living-water 下引 1 条）→137（DEC-2026-10-19-R25 新增客餐厅DN32共用主管）→138（DEC-2026-10-23-R03 新增客卫沉箱二次排水需求路线 drain-gbath-secondary-requirement）
  // 路线数随 config/mep-hvac-coordination.yaml 增长；改这个数之前先跑 `npm run verify:mep` 确认 resolved/unresolved 结构没变（resolved=136/unresolved=0 才算健康）
  assert.equal(report.resolved, 137); // DEC-2026-10-27-R01 删床头路线后与 total 同步 137； // R25后与 total 同步：137 条全部解析成功，无 unresolved；DEC-2026-10-23-R03 后 138 条全部解析成功
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
  assert.equal(config.routes.filter((route) => route.layer === 'condensate').length, 7); // DEC-2026-10-03-R6：+condensate-dining = 6；DEC-2026-10-19-R25：+condensate-living-dining-trunk（DN32 共用主管）= 7
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
  const report = resolveMepRoutes({ ...config, routes: [route] }, endpointSourcesFromFacts({ electrical, plumbing, ceiling: parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'], hvac: parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'] }));
  assert.equal(report.routes[0].metadata.pendingReview, true);
  assert.match(report.routes[0].metadata.warning ?? '', /重力冷凝水候选路线/);
  assert.equal(route.status, 'pending');
});

// ── issue #98 第五阶段 S1：探针固化（设计文档 §4.5-S1 验收铁律 ②）─────────────────

test('探针 P1 固化：electrical ref 一律走单一解算，过期声明 x/z 不得胜出（E2 收口）', () => {
  // A §4.1 / E F-3 探针实证：给 sock_child_ac 加上过期 x/z=(5.0,4.3) 后，resolveMepEndpoint
  // 返回 (5,4.3)，而 shared/point-placement.ts 解算器与 HvacBuilder 都给 (5.6,4)——「先直读
  // 声明 x/z、失败才回落解算器」的短路是潜伏分叉。S1 起 electrical ref 一律委托点位分支。
  const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
  const powerChild = hvac.plans[0].diagram.anchors.find((anchor) => anchor.id === 'power_child')!;
  assert.deepEqual(powerChild.ref, { source: 'electrical', id: 'sock_child_ac' });
  const stale = electrical.map((point) => point.id === 'sock_child_ac' ? { ...point, x: 5.0, z: 4.3 } : point);
  const probeSources = endpointSourcesFromFacts(
    { electrical: stale, plumbing, ceiling: [], hvac },
    realPointWalls,
    realMountHosts,
  );
  const solved = resolvePointPlacementInWalls(stale.find((point) => point.id === 'sock_child_ac')!, realPointWalls, realMountHosts).placement!;
  assert.ok(solved, 'sock_child_ac 在真实宿主墙索引下必须解得出');
  const resolved = resolveMepEndpoint('power_child', probeSources)!;
  assert.ok(resolved, 'power_child anchor 必须解析成功');
  assert.ok(Math.abs(resolved.x - solved.x) < 1e-9 && Math.abs(resolved.z - solved.z) < 1e-9,
    `MEP 端点必须等于解算器解果 (${solved.x},${solved.z})，实际 (${resolved.x},${resolved.z})`);
  assert.ok(Math.abs(resolved.x - 5.0) > 1e-6 || Math.abs(resolved.z - 4.3) > 1e-6,
    '过期声明 x/z=(5.0,4.3) 不得胜出（探针 P1 的失效模式）');
});

test('junction↔anchor 门禁补 y：anchor 的 y 漂移与 x/z 一样必抛（探针 y+0.5 不抛已修复）', () => {
  // A §4.3 探针实证：resolveMepEndpoint 对带 position 的 anchor 原先丢 y，使
  // validateMepCoordination 的跨文件比较 y 差恒为 0——anchor y+0.5 不抛、x+0.5 才抛。
  const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
  const junctionId = 'condensate_living_dining_merge';
  const baseFacts = { electrical, plumbing, ceiling: parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'], hvac };
  const driftedFacts = {
    ...baseFacts,
    hvac: { ...hvac, plans: hvac.plans.map((plan) => ({
      ...plan,
      diagram: {
        ...plan.diagram,
        anchors: plan.diagram.anchors.map((anchor) => anchor.id === junctionId && anchor.position
          ? { ...anchor, position: { ...anchor.position, y: anchor.position.y + 0.5 } }
          : anchor),
      },
    })) },
  };
  validateMepCoordination(config, endpointSourcesFromFacts(baseFacts, realPointWalls, realMountHosts));
  assert.throws(() => validateMepCoordination(config, endpointSourcesFromFacts(driftedFacts, realPointWalls, realMountHosts)),
    /position does not match its HVAC anchor/);
});

test('anchor 分支补 y 不改变路线几何：引用 hvac anchor 的路线必须显式声明高度', () => {
  // resolveMepEndpoint 现在对带 position 的 anchor 返回 y（junction↔anchor 门禁补 y）。路线
  // 的 y 取 `from_height ?? from.y`——若某条路线引用 hvac anchor 却不声明高度，y 会从「缺失」
  // 静默变成「anchor 声明值」，即几何变化。本断言把「零几何变化」钉成可证条件。
  const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
  const anchorIds = new Set(hvac.plans[0].diagram.anchors.map((anchor) => anchor.id));
  for (const route of config.routes) {
    for (const side of ['from', 'to'] as const) {
      const endpoint = route[side];
      if (typeof endpoint !== 'string' || !anchorIds.has(endpoint)) continue;
      const declared = side === 'from' ? route.from_height : route.to_height;
      assert.notEqual(declared, undefined,
        `route ${route.id} ${side} 引用 hvac anchor ${endpoint} 却未声明 ${side}_height：anchor 补 y 后路线几何会变`);
    }
  }
});
