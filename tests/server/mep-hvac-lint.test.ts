import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { endpointSourcesFromFacts, MepCoordinationSchema, parseMepCoordination } from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination, type MepLintLayoutContext } from '../../shared/mep-hvac-lint.js';
import type { ProjectRenderFacts, ResolvedLayout, VertexLayoutYaml } from '../../shared/types.js';
import { resolveLayout } from '../../server/layout-resolver.js';

const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ProjectRenderFacts['electrical'];
const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as ProjectRenderFacts['plumbing'];
const ceiling = parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'];
const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
const config = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
const sources = endpointSourcesFromFacts({ electrical, plumbing, ceiling, hvac });
const layers = Object.fromEntries(['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'].map((id) => [id, { label: id, color: '#fff', height: 2 }])) as ProjectRenderFacts extends never ? never : typeof config.layers;

/** 真实 layout 上下文（与 scripts/verify/mep/verify-mep-lint.ts 同一套输入），用于 (c)(d) 墙相关规则。 */
const overlay = parseYaml(readFileSync('config/layout/overlay.yaml', 'utf8')) as { suppress?: Array<{ wall?: string; walls?: string[] }> };
const suppressedWallIds = (overlay.suppress ?? []).flatMap((item) => item.walls ?? (item.wall ? [item.wall] : []));
const realLayout = resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);
function realContext(): MepLintLayoutContext {
  return { layout: realLayout, ceiling, suppressedWallIds, referenceConstraints: hvac.plans[0].diagram.reference_constraints };
}
function countByCode(result: ReturnType<typeof lintMepCoordination>, code: string): number {
  return result.warnings.filter((issue) => issue.code === code).length;
}
/** 分桶汇总必填（lintMepCoordination 总是产出）；字段本身可选，只为兼容只构造 errors/warnings/counts 的调用方。 */
function bucketsOf(result: ReturnType<typeof lintMepCoordination>) {
  assert.ok(result.categories, 'lint result should carry category buckets');
  return result.categories;
}

function sample(route: Record<string, unknown>) {
  return MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes: [route] });
}

test('real MEP configuration lints without false errors and reports warnings structurally', () => {
  const result = lintMepCoordination(config, sources);
  assert.equal(result.counts.routes, 80); // R18 客餐厅下出风 78→80 // DEC-2026-10-04-R2：+strong-ac-dining 71→72、+strong-ac-outdoor 72→73；2026-10-05 给排水 v1：+5 条排水 route 73→78
  assert.equal(result.counts.resolvedRoutes, 80);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((issue) => issue.code === 'hvac_coverage_missing').length, 0);
  // 2026-10-04 A1：吊顶净空规则从「要求 zone.area 与 zone.height 同时存在」（本项目交集为 0、
  // 永不触发）改为按 thickness 反算完成面，因此本用例从 9 条变成 9 + 144 条。
  // 149 与 facts 契约 c.mep_layer_below_drop_bottom 的登记基数同源（docs/pending-site-data.md #41）：
  // 2026-10-05 给排水 v1 新增 5 条排水路线，每条在所属厨卫铝扣板吊顶范围内新增 1 处（144→149）。
  // 2026-10-05 登记基数 149 → 154（docs/mep-construction-guidance.md 与 config/facts.yaml 已同步）：
  //   · DEC-2026-10-05-R11 客餐厅冷凝水改线（condensate-living/dining 移入走廊/客卫吊顶网络）；
  //   · DEC-2026-10-05-R13 书房电脑专用回路改道（strong-power-study 复用 x=5.5 穿孔带，与同孔区三条既有路线同一类别）。
  // 归口裁定仍是 docs/pending-site-data.md #41；实算数与登记数不符即失败（变多/变少都不允许静默）。
  assert.equal(result.warnings.filter((issue) => issue.code === 'ceiling_clearance_unverified').length, 153); // DEC-2026-10-05-R19：厨房吊顶收回+餐厅服务带，trunk 2.55 改在 2.50 完成面上方，154→153
  // 158 = 149(ceiling)+3(nonphysical)+6(overlap)；登记基数 149→154（R11 冷凝水改线 + R13 书房电脑回路改道）后为
  // 163 = 154+3+6。无 layout context（本用例不传 layout），故不含穿墙类告警。
  // DEC-2026-10-05-R18：两台双出风内机第二出口下出风新增 2 条送风路线，与既有送/回风同属
  // 「内机本体出口处送回风贴近」类别（粗 envelope 在机身端点必然相交，非路由错误），
  // overlap 6→8、总告警 163→165。R19 后 ceiling_clearance 153、总告警 164。
  // 2026-10-04 A2 + 2026-10-05 复核：新增 (a) gravity_slope_geometry_mismatch 与 (b) route_not_orthogonal，
  // 两条都不依赖 layout（穿墙类 (c)(d) 需要 layout，本用例不传 layout，仍为 0）：
  //   · (a) 14 条 = 8 条「折线 y 全平但声明 1–2% 坡度」+ 1 条 drain-balcony 竖降段 41× 过陡
  //     + 4 条冷凝水候选沿程 4–5× 过陡 + 1 条 drain-gbath-vanity-to-riser 墙排汇总 0.44× 不足坡；
  //   · (b) 3 条 = water-master-bath / water-guest-bath / water-garden-requirement 的斜线段。
  // 故 164 → 181 = 164 + 14(a) + 3(b)。ceiling 契约数 153 不变（registered_conflicts 154 同步口径见 facts.yaml）。
  assert.equal(result.warnings.length, 181); // 164 → 181（(a) +14、(b) +3）
  // (e) 分桶：无 layout 时 must_fix = (a)14 + (b)3，survey_dependent = 153 ceiling，envelope = 3 nonphysical + 8 overlap
  const buckets = bucketsOf(result);
  assert.equal(buckets.must_fix_before_briefing.count, 17);
  assert.equal(buckets.survey_dependent.count, 153);
  assert.equal(buckets.envelope_approximation.count, 11);
  assert.equal(Object.values(buckets).reduce((sum, bucket) => sum + bucket.count, 0), result.errors.length + result.warnings.length);
  for (const bucket of Object.values(buckets)) assert.equal(bucket.count, bucket.codes.reduce((sum, entry) => sum + entry.count, 0));
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

test('a penetration declared at a route vertex is treated as the actual wall crossing', () => {
  const route = sample({
    id: 'vertex-cross', layer: 'condensate', status: 'pending', source_status: 'preliminary', method: 'gravity_condensate_candidate',
    diameter: 0.025, from_height: 2.65, to_height: 0.10, flow_direction: 'down', slope: 0.01,
    from: { x: 2, z: 4, y: 2.65 },
    via: [{ x: 2, z: 2.86, y: 2.65 }, { x: 2, z: 2.5, y: 2.65 }],
    to: { x: 2, z: 2.5, y: 0.10 },
    penetration: [{ wall: 'w_test', at: { x: 2, z: 2.86 }, height: 2.65 }],
  });
  const result = lintMepCoordination(route, sources, {
    layout: { rooms: [], vertices: [], openEdges: [], walls: [{ id: 'w_test', x1: 0, z1: 2.86, x2: 2.6, z2: 2.86, height: 2.8 }] } as unknown as ResolvedLayout,
  });
  assert.equal(result.warnings.some((i) => i.code === 'penetration_missing' || i.code === 'penetration_point_mismatch'), false);
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

// ── (a) 重力管路几何：via 单调性 + 声明坡度 vs 实际落差比 ──

function gravityRoute(extra: Record<string, unknown>) {
  return lintMepCoordination(sample({
    id: 'gravity-geometry', layer: 'drainage', status: 'pending', source_status: 'plan_supported',
    method: 'gravity_floor_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.05, to_height: 0.04, from: { x: 0, z: 0 }, to: { x: 3, z: 0 }, ...extra,
  }), sources);
}

test('gravity route via heights must be monotonic non-increasing when flowing down', () => {
  // 每段 |Δh|/水平长度 都正好 1%（0.01m / 1.00m），因此只有「上升段」这一条会命中
  const rise = gravityRoute({ from: { x: 0, z: 0, y: 0.05 }, via: [{ x: 1, z: 0, y: 0.04 }, { x: 2, z: 0, y: 0.05 }], to: { x: 3, z: 0, y: 0.04 } });
  const found = rise.warnings.filter((i) => i.code === 'gravity_slope_geometry_mismatch');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /segment #2 \(1,0\)→\(2,0\) rises 0\.040m → 0\.050m/);
  // 单调非升是 warning 起步：即使 route confirmed 也不得升级成 error
  const confirmedRise = lintMepCoordination(sample({
    id: 'gravity-confirmed-rise', layer: 'drainage', status: 'confirmed', source_status: 'plan_supported', reason: 'x',
    method: 'gravity_floor_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.05, to_height: 0.04, from: { x: 0, z: 0, y: 0.05 }, via: [{ x: 1, z: 0, y: 0.04 }], to: { x: 2, z: 0, y: 0.06 },
  }), sources);
  assert.ok(confirmedRise.warnings.some((i) => i.code === 'gravity_slope_geometry_mismatch'));
  assert.equal(confirmedRise.errors.length, 0);
});

test('declared slope is checked per segment, but wall drains are judged on the whole run', () => {
  // 地埋管：折线全平（y 恒等）却声明 1% 坡度 → 0.00× 声明值，命中
  const flat = gravityRoute({ from_height: 0.02, to_height: 0.02, from: { x: 0, z: 0, y: 0.02 }, via: [{ x: 1, z: 0, y: 0.02 }], to: { x: 2, z: 0, y: 0.02 } });
  const flatIssue = flat.warnings.find((i) => i.code === 'gravity_slope_geometry_mismatch')!;
  assert.match(flatIssue.message, /segment #1 \(0,0\)→\(1,0\) over 1\.00m develops 0\.00% against declared slope 1\.00%/);
  assert.match(flatIssue.message, /0\.00× the declared slope/);
  // 墙排：柜内转 90° 吃掉大部分落差，逐段判会把 1.40m 平段刷成告警；按全线汇总 0.02m/1.94m≈1.03% 合格
  const wallDrain = lintMepCoordination(sample({
    id: 'wall-drain-ok', layer: 'drainage', status: 'inferred', source_status: 'plan_supported',
    method: 'gravity_wall_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.35, to_height: 0.33,
    from: { x: 0.575, z: 2.96, y: 0.35 }, via: [{ x: 0.575, z: 2.70, y: 0.34 }, { x: 0.3, z: 2.70, y: 0.33 }], to: { x: 0.3, z: 1.3, y: 0.33 },
  }), sources);
  assert.equal(wallDrain.warnings.some((i) => i.code === 'gravity_slope_geometry_mismatch'), false);
  // 同一个墙排几何只把汇集落差改小：全线 0.44% < 声明 1% 的一半 → 命中（对照真实配置 drain-gbath-vanity-to-riser）
  const wallDrainFlat = lintMepCoordination(sample({
    id: 'wall-drain-flat', layer: 'drainage', status: 'inferred', source_status: 'plan_supported',
    method: 'gravity_wall_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.30, to_height: 0.29,
    from: { x: 6.9, z: 3.55, y: 0.30 }, via: [{ x: 6.9, z: 2.45, y: 0.30 }, { x: 5.8, z: 2.45, y: 0.29 }], to: { x: 5.8, z: 2.4, y: 0.29 },
  }), sources);
  const wallIssue = wallDrainFlat.warnings.find((i) => i.code === 'gravity_slope_geometry_mismatch')!;
  assert.match(wallIssue.message, /wall drain drops 0\.010m over 2\.25m of horizontal run develops 0\.44% against declared slope 1\.00%/);
});

// ── (b) 相邻点斜线段 ──

test('diagonal plumbing segments are flagged while other layers stay out of scope', () => {
  const diagonal = lintMepCoordination(sample({
    id: 'diag', layer: 'water_supply', status: 'pending', source_status: 'plan_supported', method: 'floor_branch',
    diameter: 0.025, from_height: 0.18, to_height: 0.18, from: { x: 0, z: 0 }, via: [{ x: 1, z: 0.3 }], to: { x: 2, z: 0 },
  }), sources);
  const found = diagonal.warnings.find((i) => i.code === 'route_not_orthogonal')!;
  assert.match(found.message, /segment #1 \(0,0\)→\(1,0\.3\) moves Δx=1\.00m and Δz=0\.30m at once/);
  // 阈值 0.02m：0.01m 级的坐标抖动不算斜线
  const jitter = lintMepCoordination(sample({
    id: 'jitter', layer: 'water_supply', status: 'pending', source_status: 'plan_supported', method: 'floor_branch',
    diameter: 0.025, from_height: 0.18, to_height: 0.18, from: { x: 0, z: 0 }, via: [{ x: 1, z: 0.01 }], to: { x: 2, z: 0 },
  }), sources);
  assert.equal(jitter.warnings.some((i) => i.code === 'route_not_orthogonal'), false);
  // 范围口径：顶面强电/冷媒层不接入本规则（示意性折线与端点就位 jog 属包络近似，另见 envelope_approximation 桶）
  const power = lintMepCoordination(sample({
    id: 'power-diag', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.45, to_height: 2.45, from: { x: 0, z: 0 }, via: [{ x: 1, z: 0.3 }], to: { x: 2, z: 0 },
  }), sources);
  assert.equal(power.warnings.some((i) => i.code === 'route_not_orthogonal'), false);
});

// ── (c) 穿点与同墙门洞净距 ──

function doorWallContext(openings: unknown[]): MepLintLayoutContext {
  return {
    layout: {
      rooms: [], openEdges: [], vertices: [{ id: 'v_a', x: 1, z: -1 }, { id: 'v_b', x: 1, z: 1 }],
      walls: [{ id: 'w_test', x1: 1, z1: -1, x2: 1, z2: 1, height: 2.8, ...(openings.length ? { openings } : {}) }],
    } as unknown as ResolvedLayout,
  };
}
function doorCrossingRoute(at: { x: number; z: number }, height = 2.5) {
  return sample({
    id: 'door-cross', layer: 'condensate', status: 'inferred', source_status: 'preliminary', method: 'gravity_condensate_candidate',
    diameter: 0.025, from_height: height, to_height: height, from: { x: 0, z: at.z, y: height }, to: { x: 2, z: at.z, y: height },
    penetration: [{ wall: 'w_test', at, height }],
  });
}

test('penetration closer than 0.15m to a door opening in the same wall is flagged', () => {
  // 原始 model-geometry 结构（anchor 顶点 + 沿墙 offset + width）自行换算洞区间：v_a(1,-1) + offset 1.0 → 洞心 (1,0)，宽 0.9 → z[-0.45,0.45]
  const context = doorWallContext([{ id: 'd_test', type: 'door', anchor: 'v_a', offset: 1.0, width: 0.9, height: 2.1 }]);
  const close = lintMepCoordination(doorCrossingRoute({ x: 1, z: 0.5 }), sources, context);
  const found = close.warnings.find((i) => i.code === 'penetration_door_clearance')!;
  assert.match(found.message, /at \(1\.00,0\.50\) is 0\.05m from door opening d_test \(z -0\.45–0\.45\)/);
  assert.match(found.message, /above the door head 2\.10m/);
  assert.equal(close.errors.some((i) => i.code === 'penetration_door_clearance'), false);
  const far = lintMepCoordination(doorCrossingRoute({ x: 1, z: 0.9 }), sources, context);
  assert.equal(far.warnings.some((i) => i.code === 'penetration_door_clearance'), false);
  // 没有可解析门洞数据的墙：静默跳过，既不报错也不误报
  const noOpening = lintMepCoordination(doorCrossingRoute({ x: 1, z: 0.5 }), sources, doorWallContext([]));
  assert.equal(noOpening.warnings.some((i) => i.code === 'penetration_door_clearance'), false);
  assert.equal(noOpening.errors.length, 0);
  const brokenOpening = lintMepCoordination(doorCrossingRoute({ x: 1, z: 0.5 }), sources, doorWallContext([{ id: 'd_broken', type: 'door' }]));
  assert.equal(brokenOpening.errors.length, 0);
});

// ── (d) 与剪力墙长距离并行 ──

test('long parallel runs beside a shear wall are flagged, short ones are not', () => {
  const context = doorWallContext([]);
  const wall = (context.layout as unknown as { walls: Array<Record<string, unknown>> }).walls[0];
  wall.structure = 'shear';
  wall.structure_status = 'inferred';
  const parallel = (toZ: number) => lintMepCoordination(sample({
    id: 'parallel', layer: 'weak_power', status: 'inferred', source_status: 'proposed', method: 'low_voltage_conduit',
    diameter: 0.02, from_height: 2.5, to_height: 2.5, from: { x: 1.1, z: -0.9, y: 2.5 }, to: { x: 1.1, z: toZ, y: 2.5 },
  }), sources, context);
  const long = parallel(0.9);
  const found = long.warnings.find((i) => i.code === 'shear_wall_parallel_route')!;
  assert.match(found.message, /parallel to shear wall w_test for 1\.80m at 0\.10m/);
  // 平行且 confirmed 也不升级 error（结构数据本身仍是 inferred）
  const confirmed = lintMepCoordination(sample({
    id: 'parallel-confirmed', layer: 'weak_power', status: 'confirmed', source_status: 'plan_supported', reason: 'x',
    method: 'low_voltage_conduit', diameter: 0.02, from_height: 2.5, to_height: 2.5,
    from: { x: 1.1, z: -0.9, y: 2.5 }, to: { x: 1.1, z: 0.9, y: 2.5 },
  }), sources, context);
  assert.ok(confirmed.warnings.some((i) => i.code === 'shear_wall_parallel_route'));
  assert.equal(confirmed.errors.length, 0);
  // 并行 0.50m < 1.0m 不报；贴墙 0.20m > 0.15m 也不报
  assert.equal(parallel(-0.4).warnings.some((i) => i.code === 'shear_wall_parallel_route'), false);
  const distant = lintMepCoordination(sample({
    id: 'parallel-far', layer: 'weak_power', status: 'inferred', source_status: 'proposed', method: 'low_voltage_conduit',
    diameter: 0.02, from_height: 2.5, to_height: 2.5, from: { x: 1.25, z: -0.9, y: 2.5 }, to: { x: 1.25, z: 0.9, y: 2.5 },
  }), sources, context);
  assert.equal(distant.warnings.some((i) => i.code === 'shear_wall_parallel_route'), false);
  // 垂直穿墙不算并行
  const crossing = lintMepCoordination(sample({
    id: 'parallel-cross', layer: 'weak_power', status: 'inferred', source_status: 'proposed', method: 'low_voltage_conduit',
    diameter: 0.02, from_height: 2.5, to_height: 2.5, from: { x: 0.5, z: -0.9, y: 2.5 }, to: { x: 1.5, z: 0.9, y: 2.5 },
  }), sources, context);
  assert.equal(crossing.warnings.some((i) => i.code === 'shear_wall_parallel_route'), false);
});

// ── 新规则在真实配置上的命中 + (e) 分桶 ──

test('the new geometry rules hit the expected real routes and keep zero errors', () => {
  const result = lintMepCoordination(config, sources, realContext());
  assert.equal(result.counts.routes, 80);
  assert.equal(result.counts.resolvedRoutes, 80);
  assert.equal(result.errors.length, 0);
  // (a) 墙排汇总不足坡 + 地埋全平 + 过陡段
  assert.ok(result.warnings.some((i) => i.code === 'gravity_slope_geometry_mismatch' && i.routeId === 'drain-gbath-vanity-to-riser' && /wall drain drops 0\.010m over 2\.25m/.test(i.message)));
  assert.ok(result.warnings.some((i) => i.code === 'gravity_slope_geometry_mismatch' && i.routeId === 'drain-master-bath'));
  // 同为墙排但汇集落差够（1.03%）的 drain-mbath-vanity-to-riser 不得被误报
  assert.equal(result.warnings.some((i) => i.code === 'gravity_slope_geometry_mismatch' && i.routeId === 'drain-mbath-vanity-to-riser'), false);
  assert.equal(countByCode(result, 'gravity_slope_geometry_mismatch'), 14);
  // (b) 恰好 3 条给水路线的斜线段
  assert.deepEqual(result.warnings.filter((i) => i.code === 'route_not_orthogonal').map((i) => i.routeId).sort(), ['water-garden-requirement', 'water-guest-bath', 'water-master-bath']);
  // (c) 本次 review 的关键风险点：w_strip_east (4.2,4.6) 距门洞 d_mb 仅 0.05m
  const strip = result.warnings.filter((i) => i.code === 'penetration_door_clearance' && i.routeId === 'strong-ac-master');
  assert.equal(strip.length, 1);
  assert.match(strip[0].message, /on w_strip_east at \(4\.20,4\.60\) is 0\.05m from door opening d_mb \(z 4\.65–5\.55\)/);
  assert.equal(countByCode(result, 'penetration_door_clearance'), 15);
  // (d) w_mb_east 两侧 0.08–0.10m 的并行带（最长 strong-power-master 3.60m）
  const masterParallel = result.warnings.find((i) => i.code === 'shear_wall_parallel_route' && i.routeId === 'strong-power-master')!;
  assert.match(masterParallel.message, /parallel to shear wall w_mb_east for 3\.60m at 0\.10m/);
  assert.equal(countByCode(result, 'shear_wall_parallel_route'), 8);
  // 分桶：三桶 count 之和 == error + warning 总数，且每桶 count == 各类 count 之和
  const buckets = bucketsOf(result);
  const total = result.errors.length + result.warnings.length;
  assert.equal(Object.values(buckets).reduce((sum, bucket) => sum + bucket.count, 0), total);
  for (const bucket of Object.values(buckets)) assert.equal(bucket.count, bucket.codes.reduce((sum, entry) => sum + entry.count, 0));
  // 本轮新规则全部落 must_fix_before_briefing
  for (const code of ['gravity_slope_geometry_mismatch', 'route_not_orthogonal', 'penetration_door_clearance', 'shear_wall_parallel_route']) {
    const bucket = buckets.must_fix_before_briefing.codes.find((entry) => entry.code === code)!;
    assert.ok(bucket, `${code} should be bucketed as must_fix_before_briefing`);
    assert.equal(bucket.count, countByCode(result, code));
  }
  // 量房依赖桶 / 包络近似桶的成员口径
  assert.deepEqual(buckets.survey_dependent.codes.map((entry) => entry.code).sort(), ['ceiling_clearance_unverified', 'shear_wall_penetration']);
  assert.deepEqual(buckets.envelope_approximation.codes.map((entry) => entry.code).sort(), ['nonphysical_route', 'reference_constraint_uncertain', 'supply_return_overlap', 'suppressed_wall_crossing']);
  assert.equal(buckets.must_fix_before_briefing.count, 40);
  assert.equal(buckets.survey_dependent.count, 160);
  assert.equal(buckets.envelope_approximation.count, 19);
});
