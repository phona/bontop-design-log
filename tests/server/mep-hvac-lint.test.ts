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
  assert.equal(result.counts.routes, 132); // 80→87（R1 给排水兜底）→92（v1 水路估算）→102（客客厅十条）→133（DEC-2026-10-07-M05 再补 23 条：书房/客房/儿童房 8 + 四卧两卫 16 + 走廊入户 7）→132（R15 删除 NP-4b 路线）
  assert.equal(result.counts.resolvedRoutes, 132);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((issue) => issue.code === 'hvac_coverage_missing').length, 0);
  // 2026-10-04 A1：吊顶净空规则从「要求 zone.area 与 zone.height 同时存在」（本项目交集为 0、
  // 永不触发）改为按 thickness 反算完成面，因此本用例从 9 条变成 9 + 144 条。
  // 149 与 facts 契约 c.mep_layer_below_drop_bottom 的登记基数同源（docs/pending-site-data.md #41）：
  // 2026-10-05 给排水 v1 新增 5 条排水路线，每条在所属厨卫铝扣板吊顶范围内新增 1 处（144→149）。
  // 2026-10-05 登记基数 149 → 154（docs/mep-construction-guidance.md 与 config/facts.yaml 已同步）：
  //   · DEC-2026-10-05-R11 客餐厅冷凝水改线（condensate-living/dining 移入走廊/客卫吊顶网络）；
  //   · DEC-2026-10-05-R13 书房电脑专用回路改道（strong-power-study 复用 x=5.5 穿孔带，与同孔区三条既有路线同一类别）。
  // DEC-2026-10-06-R1：新增 7 条 floor-branch 路线，每条在所经厨卫/套间吊顶 footprint 内新增 1 处低于完成面 hit，153→160。
  // DEC-2026-10-06-R5（#41 裁定，管线分层升入降板空舱）：160 → 24。
  //   · 分层标高按 A 区（完成面 2.50）≥2.55 / B 区铝扣板（完成面 2.65）≥2.70 分区抬升，
  //     参考梁约束带内 ≤ 梁底−0.05，强电/弱电/冷媒/冷凝水/送风/回风六层全部进入吊顶空腔；
  //   · 配套口径修正（DEC 明文授权）：water_supply / drainage 两个走地分层退出「低于吊顶完成面」比较，
  //     原 20 处地面管 hit 不再计入（地面管与吊顶完成面无可比性）；
  //   · 残留 24 处为显式登记的少数项：竖直下引至设备点位的末点（to_height 0.02–1.60m）、
  //     贴在完成面上的设备开口（回风格栅 2.49）、窗帘盒内电动窗帘电源（0.7m），
  //     以及 2 条绕不开梁带的冷凝水候选路线（condensate-living / condensate-dining，见下条用例与 reason 全引）。
  // 2026-10-07 DEC-2026-10-07-M04/M05：声明式补 33 条电源路由后，ceiling 由 24 增至 56
  //（新增全部为"路由下行至声明设备点位的竖直末段"，与既有 24 处①类残留同源）。
  assert.equal(result.warnings.filter((issue) => issue.code === 'ceiling_clearance_unverified').length, 56);
  // DEC-2026-10-06-R5：177 → 41 → 2026-10-07 M04/M05：90 → 125（见上）
  assert.equal(result.warnings.length, 66); // 无 layout 上下文：穿墙/剪力墙类（59 条）不触发
  // (e) 分桶：无 layout 时 must_fix = 0（重力坡度/斜线已清、穿墙类需 layout 不出现），survey_dependent = 24 ceiling，envelope = 9 nonphysical + 8 overlap
  const buckets = bucketsOf(result);
  assert.equal(buckets.must_fix_before_briefing.count, 0);
  assert.equal(buckets.survey_dependent.count, 56); // 无 layout：survey_dependent 只剩 ceiling_clearance_unverified 56
  assert.equal(buckets.envelope_approximation.count, 10); // 无 layout：supply_return_overlap 8 + nonphysical_route 2（reference_constraint_uncertain 需 hvac plan 不触发）
  assert.equal(Object.values(buckets).reduce((sum, bucket) => sum + bucket.count, 0), result.errors.length + result.warnings.length);
  for (const bucket of Object.values(buckets)) assert.equal(bucket.count, bucket.codes.reduce((sum, entry) => sum + entry.count, 0));
  assert.ok(result.warnings.some((issue) => issue.code === 'supply_return_overlap'));
  assert.ok(result.warnings.some((issue) => issue.code === 'nonphysical_route'));
  const balcony = config.routes.find((r) => r.id === 'drain-balcony')!;
  assert.equal(balcony.from_height, 0.60);
  assert.equal(balcony.to_height, 0.586); // DEC-2026-10-06-R1：洗衣机改向专用墙排→阳台立管（不通地漏），2% 坡回算 0.014/0.70m，单调非升
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
  // DEC-2026-10-06-R1：declared height 2.50m > 门头 2.10m = 合法过门头穿梁 → survey_dependent
  const close = lintMepCoordination(doorCrossingRoute({ x: 1, z: 0.5 }), sources, context);
  const found = close.warnings.find((i) => i.code === 'penetration_door_clearance')!;
  assert.match(found.message, /at \(1\.00,0\.50\) is 0\.05m from door opening d_test \(z -0\.45–0\.45\)/);
  assert.match(found.message, /above the door head 2\.10m \(过门头穿梁，需核梁底与套管/);
  assert.equal(found.category, 'survey_dependent');
  assert.equal(close.errors.some((i) => i.code === 'penetration_door_clearance'), false);
  // DEC-2026-10-06-R1：declared height 1.50m 落在门洞高度带内（<门头 2.10m）且贴门垛 → must_fix_before_briefing
  const jamb = lintMepCoordination(doorCrossingRoute({ x: 1, z: 0.5 }, 1.5), sources, context);
  const jambFound = jamb.warnings.find((i) => i.code === 'penetration_door_clearance')!;
  assert.match(jambFound.message, /is inside the door opening height 2\.10m/);
  assert.equal(jambFound.category, 'must_fix_before_briefing');
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

test('DEC-2026-10-06-R1 geometry fixes clear slope/orthogonal and reclassify over-header penetrations', () => {
  const result = lintMepCoordination(config, sources, realContext());
  assert.equal(result.counts.routes, 132);
  assert.equal(result.counts.resolvedRoutes, 132);
  assert.equal(result.errors.length, 0);
  // (a) 重力坡度：R1 后 14 条全清（地埋全平/过陡、冷凝水候选沿程、drain-balcony 2% 回算、墙排汇总不足坡）
  assert.equal(countByCode(result, 'gravity_slope_geometry_mismatch'), 0);
  assert.equal(result.warnings.some((i) => i.code === 'gravity_slope_geometry_mismatch' && i.routeId === 'drain-gbath-vanity-to-riser'), false);
  // (b) 斜线：3 条给水路线正交化后归零
  assert.equal(countByCode(result, 'route_not_orthogonal'), 0);
  // (c) 穿点距门洞：2026-10-07 M05 声明式补路由后 15 → 19；过门头 → survey_dependent，门洞高度内贴门垛 → must_fix
  const strip = result.warnings.filter((i) => i.code === 'penetration_door_clearance' && i.routeId === 'strong-ac-master');
  assert.equal(strip.length, 1);
  assert.match(strip[0].message, /on w_strip_east at \(4\.20,4\.60\) is 0\.05m from door opening d_mb \(z 4\.65–5\.55\)/);
  assert.match(strip[0].message, /过门头穿梁，需核梁底与套管/);
  assert.equal(strip[0].category, 'survey_dependent');
  assert.equal(countByCode(result, 'penetration_door_clearance'), 19);
  // 门洞高度带内贴门垛（water-balcony declared height 0.80m < 门头 2.10m）→ 留 must_fix
  const balconyDoor = result.warnings.find((i) => i.code === 'penetration_door_clearance' && i.routeId === 'water-balcony')!;
  assert.equal(balconyDoor.category, 'must_fix_before_briefing');
  assert.match(balconyDoor.message, /is inside the door opening height 2\.10m/);
  // (d) 剪力墙并行 8 → 14（2026-10-07 M04/M05 补路由贴剪力墙竖槽，见各条 reason 扫筋声明）
  const masterParallel = result.warnings.find((i) => i.code === 'shear_wall_parallel_route' && i.routeId === 'strong-power-master')!;
  assert.match(masterParallel.message, /parallel to shear wall w_mb_east for 3\.60m at 0\.10m/);
  assert.equal(countByCode(result, 'shear_wall_parallel_route'), 14);
  // 分桶核算：三桶之和 == error + warning 总数，且每桶 count == 各类 count 之和
  const buckets = bucketsOf(result);
  const total = result.errors.length + result.warnings.length;
  assert.equal(Object.values(buckets).reduce((sum, bucket) => sum + bucket.count, 0), total);
  for (const bucket of Object.values(buckets)) assert.equal(bucket.count, bucket.codes.reduce((sum, entry) => sum + entry.count, 0));
  // 分桶代码明细必须与实算完全一致（gravity_slope/orthogonal 已出 must_fix；penetration_door_clearance 拆 must_fix 2 / survey 13）
  assert.deepEqual(Object.fromEntries(buckets.must_fix_before_briefing.codes.map((e) => [e.code, e.count])), { shear_wall_parallel_route: 14, penetration_missing: 7, penetration_door_clearance: 2 });
  assert.deepEqual(Object.fromEntries(buckets.survey_dependent.codes.map((e) => [e.code, e.count])), { ceiling_clearance_unverified: 56, penetration_door_clearance: 17, shear_wall_penetration: 10 });
  assert.deepEqual(Object.fromEntries(buckets.envelope_approximation.codes.map((e) => [e.code, e.count])), { nonphysical_route: 2, supply_return_overlap: 8, reference_constraint_uncertain: 5, suppressed_wall_crossing: 4 });
  assert.equal(buckets.must_fix_before_briefing.count, 23); // 2026-10-07 M04/M05：shear_wall_parallel 8→14、penetration_missing 7 新增
  assert.equal(buckets.survey_dependent.count, 83); // ceiling 24→56、penetration_door_clearance 15→19、shear_wall_penetration 7→10
  assert.equal(buckets.envelope_approximation.count, 19); // nonphysical 9→2、suppressed_wall_crossing 3→4
});

// ── DEC-2026-10-06-R5：#41 分层标高升入降板空腔（A/B 分区 + 梁硬约束 + 走地分层豁免）──

/** 取一条真实路线在吊顶 footprint 内的 via 点标高（只查 via：from/to 可能是设备末点，本就该低于完成面）。 */
function viaYsInCeilings(routeId: string): Array<{ y: number; zone: string }> {
  const route = config.routes.find((r) => r.id === routeId)!;
  const out: Array<{ y: number; zone: string }> = [];
  for (const v of route.via ?? []) {
    const zone = (ceiling as Array<{ id: string; area?: number[]; type: string; thickness?: number }>).find((z) => z.area
      && v.x >= Math.min(z.area[0], z.area[2]) && v.x <= Math.max(z.area[0], z.area[2])
      && v.z >= Math.min(z.area[1], z.area[3]) && v.z <= Math.max(z.area[1], z.area[3]));
    if (zone && typeof v.y === 'number') out.push({ y: v.y, zone: zone.id });
  }
  return out;
}
/** 走廊满吊 footprint（ceiling_main_corridor，完成面 2.50 → A 区下限 2.55）。 */
const CORRIDOR: [number, number, number, number] = [4.2, 4.3, 7.2, 5.55];
/** 厨房铝扣板 footprint（ceiling_kitchen，完成面 2.65 → B 区下限 2.70）。 */
const KITCHEN: [number, number, number, number] = [7.2, 0, 10.8, 2.4];
/** 客卫铝扣板 footprint（ceiling_guest_bath，完成面 2.65 → B 区下限 2.70）。 */
const GUEST_BATH: [number, number, number, number] = [5.6, 2.2, 7.1, 4.3];

test('DEC-2026-10-06-R5: carried layers are lifted into the drop-ceiling cavity on both A and B bands', () => {
  // A 区（完成面 2.50）：四层承载管在吊顶 footprint 内 ≥2.55 且 ≤2.75
  for (const id of ['strong-main', 'strong-light-child', 'weak-main-living', 'weak-ap', 'refrigerant-master', 'refrigerant-child', 'strong-ac-parent']) {
    const pts = viaYsInCeilings(id);
    assert.ok(pts.length > 0, `${id} 应有 via 点落在吊顶 footprint 内`);
    for (const p of pts) assert.ok(p.y >= 2.55 && p.y <= 2.75, `${id} 在 ${p.zone} 内应为 2.55–2.75（A 区），实际 ${p.y}`);
  }
  // 走廊服务带参考梁底 2.65 → 带内 ≤2.60；主干必经 bend_corridor (7.2,4.3) 与 z=4.6 轴线
  for (const id of ['strong-main', 'strong-ac-living', 'weak-master', 'refrigerant-master']) {
    const route = config.routes.find((r) => r.id === id)!;
    const spine = (route.via ?? []).filter((v) => v.x >= 6.9 && v.x <= 7.5 && v.z >= 3.6 && v.z <= 8).map((v) => v.y as number);
    assert.ok(spine.length > 0, `${id} 应有点落在走廊服务带梁带内`);
    for (const y of spine) assert.ok(y <= 2.60, `${id} 在走廊服务带梁带内应 ≤2.60（参考梁底 2.65 − 0.05）`);
  }
  // B 区（厨房铝扣板，完成面 2.65）：进入该区的管路段 ≥2.70 且 ≤2.76
  for (const id of ['strong-power-kitchen', 'strong-ded-dishwasher', 'strong-ded-washer-dryer', 'strong-light-kitchen', 'refrigerant-trunk']) {
    const route = config.routes.find((r) => r.id === id)!;
    const inKitchen = (route.via ?? []).filter((v) => v.x >= KITCHEN[0] && v.x <= KITCHEN[2] && v.z >= KITCHEN[1] && v.z <= KITCHEN[3]).map((v) => v.y as number);
    assert.ok(inKitchen.length > 0, `${id} 应有段落进入厨房铝扣板 footprint`);
    for (const y of inKitchen) assert.ok(y >= 2.70 && y <= 2.76, `${id} 厨房段应在 2.70–2.76（B 区），实际 ${y}`);
  }
  // B 区（客卫铝扣板）：≥2.70
  for (const id of ['strong-light-gbath', 'strong-power-gbath', 'strong-ded-bathheaters-gbath']) {
    const route = config.routes.find((r) => r.id === id)!;
    const inBath = (route.via ?? []).filter((v) => v.x >= GUEST_BATH[0] && v.x <= GUEST_BATH[2] && v.z >= GUEST_BATH[1] && v.z <= GUEST_BATH[3]).map((v) => v.y as number);
    assert.ok(inBath.length > 0, `${id} 应有段落进入客卫铝扣板 footprint`);
    for (const y of inBath) assert.ok(y >= 2.70 && y <= 2.76, `${id} 客卫段应在 2.70–2.76（B 区），实际 ${y}`);
  }
  // 层间关系仍在：强电最低 → 弱电 → 冷凝水 → 冷媒 → 送风 2.68 / 回风 2.72
  const h = (layer: string) => config.layers[layer as keyof typeof config.layers].height;
  assert.ok(h('strong_power') < h('weak_power') && h('weak_power') < h('condensate') && h('condensate') < h('supply_air'));
  assert.equal(h('strong_power'), 2.55);
  assert.equal(h('weak_power'), 2.60);
  assert.equal(h('condensate'), 2.65);
  assert.equal(h('supply_air'), 2.68);
  assert.equal(h('return_air'), 2.72);
  // 穿点高度随层高同步抬升（不能低于所在吊顶承载层标高，否则穿墙段埋在墙里）
  for (const route of config.routes) {
    for (const p of (route.penetration ?? []) as Array<{ height?: number }>) {
      if (typeof p.height !== 'number') continue;
      if (p.height >= 2.5) assert.ok(p.height >= 2.55, `${route.id} 穿点高度 ${p.height} 低于 A 区承载层下限 2.55`);
      else assert.ok(p.height <= 0.8, `${route.id} 走地穿点高度应 ≤0.80m（给排水），实际 ${p.height}`);
    }
  }
  // 冷凝水坡度铁律在抬高后仍成立：全程非升 + 声明 1% 与几何一致（由 gravity_slope_geometry_mismatch = 0 兜住）
  assert.equal(countByCode(lintMepCoordination(config, sources, realContext()), 'gravity_slope_geometry_mismatch'), 0);
  for (const route of config.routes.filter((r) => r.layer === 'condensate' && r.method?.includes('gravity'))) {
    const ys = [route.from_height as number, ...(route.via ?? []).map((v) => v.y as number)];
    for (let i = 1; i < ys.length; i += 1) assert.ok(ys[i] <= ys[i - 1] + 1e-9, `${route.id} 第 ${i} 段上弯，违反重力铁律`);
  }
  // 绕不开梁带的两条冷凝水候选路线：保留原标高并逐条显式登记（DEC-2026-10-06-R5 允许的残留）
  for (const id of ['condensate-living', 'condensate-dining']) {
    const route = config.routes.find((r) => r.id === id)!;
    assert.equal(route.from_height, 2.35, `${id} 应保留原 from_height 2.35（绕不开走廊服务带梁带）`);
    assert.match(route.reason ?? '', /DEC-2026-10-06-R5 显式残留/);
  }
});

test('DEC-2026-10-06-R5: floor-level plumbing layers are exempt from the ceiling clearance comparison', () => {
  // 走地给排水分层（water_supply 0.18 / drainage 0.10）与吊顶完成面无可比性，退出比较（DEC 明文授权）
  const result = lintMepCoordination(config, sources, realContext());
  const flagged = result.warnings.filter((issue) => issue.code === 'ceiling_clearance_unverified').map((issue) => issue.routeId);
  for (const route of config.routes) {
    if (route.layer === 'water_supply' || route.layer === 'drainage') {
      assert.equal(flagged.includes(route.id), false, `走地分层 ${route.id} 不应参与 ceiling_clearance_unverified 比较`);
    }
  }
  // 同一份配置、同一批点位：只要把 layer 换成吊顶承载层，比较立即恢复（证明不是"规则被关掉"而是"范围收窄"）
  const asCarried = structuredClone(config);
  const target = asCarried.routes.find((r) => r.id === 'water-kitchen-requirement')!;
  (target as { layer: string }).layer = 'strong_power';
  const lifted = lintMepCoordination(asCarried, sources, realContext());
  assert.ok(lifted.warnings.some((issue) => issue.code === 'ceiling_clearance_unverified' && issue.routeId === 'water-kitchen-requirement'));
  // 六个承载层都参与；water_supply / drainage 都不参与
  for (const layer of ['strong_power', 'weak_power', 'refrigerant', 'condensate', 'supply_air', 'return_air']) {
    const probe = structuredClone(config);
    const route = probe.routes.find((r) => r.id === 'water-kitchen-requirement')!;
    (route as { layer: string }).layer = layer;
    const res = lintMepCoordination(probe, sources, realContext());
    assert.ok(res.warnings.some((issue) => issue.code === 'ceiling_clearance_unverified' && issue.routeId === 'water-kitchen-requirement'), `${layer} 应参与 clearance 比较`);
  }
  for (const layer of ['water_supply', 'drainage']) {
    const probe = structuredClone(config);
    const route = probe.routes.find((r) => r.id === 'water-kitchen-requirement')!;
    (route as { layer: string }).layer = layer;
    const res = lintMepCoordination(probe, sources, realContext());
    assert.equal(res.warnings.some((issue) => issue.code === 'ceiling_clearance_unverified' && issue.routeId === 'water-kitchen-requirement'), false, `${layer} 应退出 clearance 比较`);
  }
});
