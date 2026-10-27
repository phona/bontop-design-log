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
  // R19 起 must_fix 桶进 errors[]：按 code 计数须两数组合计，否则分级迁移会让计数假性归零
  return [...result.errors, ...result.warnings].filter((issue) => issue.code === code).length;
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
  assert.equal(result.counts.routes, 137); // DEC-2026-10-27-R01 删床头路线 strong-light-bedrooms-parent-bed 后 138→137； // DEC-2026-10-23-R03 新增客卫沉箱二次排水需求路线 137→138；80→87（R1 给排水兜底）→92（v1 水路估算）→102（客客厅十条）→133（DEC-2026-10-07-M05 再补 23 条：书房/客房/儿童房 8 + 四卧两卫 16 + 走廊入户 7）→132（R15 删除 NP-4b 路线）→134（DEC-2026-10-08-W01 上下水：净水器进水 + 阳台地漏两条）→138（W03）→137（F01 撤并 east-wall 冗余竖直下引路由，取电由 curtain 上行段覆盖）→135（DEC-2026-10-12-R1 删主卧两盏明装床头壁灯及 strong-light-bedrooms-master-wall-l/-r 两条路由）；DEC-2026-10-13-R5 删 strong-light-tv 后 131→130；DEC-2026-10-17-R20 删 strong-ded-fridge / strong-power-parent-child-parentbed-l（冰箱改由 sock_fridge_living 就近取电）后 130→128；DEC-2026-10-17-R20 走线专项为 R20 批次 7 个新点位补 7 条路线（strong-ded-fridge-living / strong-power-waterbar / strong-power-kitchen-east / strong-power-weakbox / weak-ap-master / strong-light-balcony / strong-light-entry-night-mid）128→135；DEC-2026-10-18-R21 补画 strong-power-living-water 下引 1 条（F01 撤并的 sock_living_water 下引回补为实体路线）135→136；DEC-2026-10-19-R25 新增客餐厅DN32共用主管，136→137
  assert.equal(result.counts.resolvedRoutes, 137); // DEC-2026-10-27-R01 删床头路线后与 routes 同步 137； // R25：routes/resolved 同步137，0悬空；DEC-2026-10-23-R03 后同步 138
  assert.equal(result.errors.length, 95); // DEC-2026-10-17-R19/R20 契约（8aef523）：must_fix 桶自此进 errors[]，本用例旧「errors=0」口径随之失效；95 = 无 layout 口径的 must_fix 全集（route_overlap 63 + route_not_orthogonal 28 + 其余 4；R02 后 overlap 67→63、orthogonal 30→28；R01 后 overlap 68→66、orthogonal 32→30，floor_band_method_mismatch 不进本 harness 口径；R01 重算 guest-north 贴墙走线 overlap +1），与下方分桶断言同源互锁
  assert.equal(result.warnings.filter((issue) => issue.code === 'hvac_coverage_missing').length, 0);
  assert.equal(result.warnings.some((issue) => issue.code === 'ceiling_clearance_unverified' && issue.routeId === 'strong-power-living-sofa-r'), false,
    'a floor-branch candidate is not compared against ceiling finish heights; its supports remain checked in 3D');
  // 历史基线：2026-10-04 A1 吊顶净空规则从「要求 zone.area 与 zone.height 同时存在」（本项目交集为 0、
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
  assert.equal(result.warnings.filter((issue) => issue.code === 'ceiling_clearance_unverified').length, 97); // 走地 floor_branch(_candidate) 不参加吊顶净空比较；其起降仍由 3D unsupported_span 检查；51→62 为 R20/R21/R25 路线增补后的现值，62→101 为 DEC-2026-10-23-R04 角点触碰登记 +39（2026-10-23 实测重钉），101→99 为 DEC-2026-10-26-R02 两专线改道东墙、各减 1 hit，99→97 为 DEC-2026-10-27-R01 删床头路线
  // 当前无 layout：通用正交规则仍运行；墙、幕墙与剪力墙规则需要 layout 才运行。
  assert.equal(result.warnings.length, 216); // 2026-10-23 实测重钉（R19 升级前的 114 口径已失效）；DEC-2026-10-23-R03 客卫二次排水示意段两端点 +2 inline，179→181；DEC-2026-10-23-R04 ceiling_clearance 角点触碰 +39，181→220；DEC-2026-10-26-R02 ceiling_clearance −2，220→218；DEC-2026-10-27-R01 ceiling_clearance −2，218→216
  // (e) 当前无 layout 的分桶（2026-10-26 R02 重算实测）：must_fix = route_overlap 63 + route_not_orthogonal 28 + service_conflict 2 + floor_band 1 + endpoint_unusable 1；survey = ceiling 99 + insulation 7 + inline endpoint 6；envelope = clearance 40 + overlap 39 + declared_trunk 14 + nonphysical 8 + not_orthogonal 4 + supply_return 1
  const buckets = bucketsOf(result);
  assert.equal(buckets.must_fix_before_briefing.count, 95); // R02：route_overlap 67→63、route_not_orthogonal 30→28；R01：route_overlap 68→66、route_not_orthogonal 32→30；R01 重算 guest-north 贴墙走线 overlap +1
  assert.equal(buckets.survey_dependent.count, 110); // 无 layout：ceiling_clearance_unverified 97 + route_insulation_unverified 7 + inline_endpoint_without_point_anchor 6
  assert.equal(buckets.envelope_approximation.count, 106);
  assert.equal(Object.values(buckets).reduce((sum, bucket) => sum + bucket.count, 0), result.errors.length + result.warnings.length);
  for (const bucket of Object.values(buckets)) assert.equal(bucket.count, bucket.codes.reduce((sum, entry) => sum + entry.count, 0));
  assert.ok(result.warnings.some((issue) => issue.code === 'supply_return_overlap'));
  assert.ok(result.warnings.some((issue) => issue.code === 'nonphysical_route'));
  const balcony = config.routes.find((r) => r.id === 'drain-balcony')!;
  assert.equal(balcony.from_height, 0.60);
  assert.equal(balcony.to_height, 0.586); // DEC-2026-10-06-R1：洗衣机改向专用墙排→阳台立管（不通地漏），2% 坡回算 0.014/0.70m，单调非升
});

test('missing power relation remains a coverage finding without an equivalent endpoint route', () => {
  const withoutMasterPower = {
    ...config,
    routes: config.routes.filter((route) => route.id !== 'strong-ac-master'),
  };
  const result = lintMepCoordination(withoutMasterPower, sources);
  // hvac_coverage_missing 属 must_fix 桶，DEC-2026-10-17-R19 起进 errors[]（旧断言查 warnings 已失效）
  assert.ok(result.errors.some((issue) => issue.code === 'hvac_coverage_missing' && issue.routeId === 'indoor_master'));
});

test('self-connection is warning for pending requirement and error when confirmed', () => {
  const pending = lintMepCoordination(sample({ id: 'same', layer: 'drainage', status: 'pending', source_status: 'design_requirement', from: { x: 1, z: 1 }, to: { x: 1, z: 1 }, via: [] }), sources);
  assert.ok(pending.errors.some((i) => i.code === 'degenerate_requirement')); // must_fix 桶，R19 起进 errors[]
  const confirmed = lintMepCoordination(sample({ id: 'same', layer: 'drainage', status: 'confirmed', source_status: 'plan_supported', from: { x: 1, z: 1 }, to: { x: 1, z: 1 }, via: [] }), sources);
  assert.ok(confirmed.errors.some((i) => i.code === 'confirmed_self_connection'));
});

test('dimension semantics, missing gravity slope, and complete via route overlap are linted', () => {
  const result = lintMepCoordination(sample({ id: 'duct', layer: 'supply_air', status: 'pending', from: { x: 0, z: 0 }, via: [{ x: 1, z: 0, y: 2 }], to: { x: 2, z: 0 }, diameter: 0.2 }), sources);
  assert.ok(result.errors.some((i) => i.code === 'diameter_not_for_duct')); // 三条均属 must_fix 桶，R19 起进 errors[]
  assert.ok(result.errors.some((i) => i.code === 'duct_dimension_incomplete'));
  const gravity = lintMepCoordination(sample({ id: 'gravity', layer: 'drainage', status: 'pending', source_status: 'plan_supported', method: 'gravity_floor_drain', from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, diameter: 0.075 }), sources);
  assert.ok(gravity.errors.some((i) => i.code === 'gravity_slope_pending'));
  const explicitGravity = lintMepCoordination(sample({ id: 'gravity-explicit', layer: 'drainage', status: 'pending', source_status: 'plan_supported', method: 'gravity_floor_drain', flow_direction: 'downstream', from_height: 0.1, to_height: 0.2, from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, diameter: 0.075 }), sources);
  assert.ok(explicitGravity.errors.some((i) => i.code === 'gravity_direction_height_conflict'));
  const crossing = lintMepCoordination(sample({ id: 'cross', layer: 'strong_power', status: 'confirmed', source_status: 'plan_supported', diameter: 0.05, from_height: 2, to_height: 2, from: { x: 0, z: 0, y: 2 }, via: [{ x: 1, z: 0, y: 2 }], to: { x: 2, z: 0, y: 2 } }), sources);
  assert.ok([...crossing.errors, ...crossing.warnings].some((i) => i.code === 'round_dimension_missing') === false);
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

test('coincident requirement/candidate emits one clear finding', () => {
  const result = lintMepCoordination(sample({ id: 'same-candidate', layer: 'water_supply', status: 'pending', source_status: 'design_requirement', from: { x: 1, z: 1 }, to: { x: 1, z: 1 }, via: [] }), sources);
  const routeFindings = [...result.errors, ...result.warnings].filter((i) => i.routeId === 'same-candidate');
  assert.equal(routeFindings.filter((i) => i.code === 'degenerate_requirement').length, 1); // must_fix 桶，R19 起在 errors[]
  assert.equal(routeFindings.some((i) => i.code === 'nonphysical_route'), false);
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
  // DEC-2026-10-17-R19/R20 契约：must_fix 清零前 verify:mep 以 exit=1 退出（8aef523 起 must_fix 桶
  // 升级为 error），execFileSync 会把非零退出抛成异常——这里显式接住并钉住 exit code，
  // 让「JSON 结构稳定 + 计数显形 + 退出码契约」三条都仍然被断言，而不是回退成不跑。
  let status: number | undefined;
  let output = '';
  try {
    output = execFileSync('npx', ['tsx', 'scripts/verify/mep/verify-mep-lint.ts', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    status = 0;
  } catch (error) {
    status = (error as { status?: number }).status;
    output = (error as { stdout?: string }).stdout ?? '';
  }
  const result = JSON.parse(output) as { errors: unknown[]; warnings: unknown[]; counts: { errors: number; warnings: number; routes: number }; categories: Record<string, { count: number }> };
  assert.equal(status, 1); // DEC-2026-10-17-R20：must_fix_before_briefing 166 > 0 → exit=1 属预期，清零前不得伪装成功
  assert.ok(Array.isArray(result.errors));
  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.counts.routes, 137); // DEC-2026-10-27-R01 删床头路线 strong-light-bedrooms-parent-bed 后 138→137； // DEC-2026-10-18-R21 补画 strong-power-living-water 后135→136；R25新增主管后137；DEC-2026-10-23-R03 新增客卫二次排水需求路线后138
  assert.equal(result.counts.errors, 126); // 2026-10-26 实测重钉：DEC-2026-10-26-R02 书房墙垛建模 + 书桌东移 + 衣柜南延后 route_overlap 63、route_not_orthogonal 28、route_furniture_collision 10、unsupported_span 9，132→127；此前 DEC-2026-10-25-R01 厨房东南角墙线改判后 route_overlap 68→66、route_not_orthogonal 32→30、floor_band_method_mismatch 0→1，135→132；此前 DEC-2026-10-23-R04 几何改判（东南玻璃线 9.88 / 客卫东墙 7.20）后 route_overlap −1、suppressed_wall_crossing −1、bay_sill_collision −1 → 135
  assert.equal(result.counts.warnings, 276); // survey_dependent 147 + envelope_approximation 132（2026-10-26 DEC-2026-10-26-R02 重算后实测：ceiling_clearance 101→99、shear_wall_parallel 12→8、bay_sill 13→11；此前 2026-10-25 DEC-2026-10-25-R01 重算后实测：shear_wall_penetration 10→11（w_cent_north 声明穿孔）、shear_wall_parallel_route 11→12；同日梁体修正：参考梁约束 5→11 条，reference_constraint_uncertain +6，其余不变）
  assert.equal(result.categories.survey_dependent?.count, 144); // ceiling_clearance_unverified 99 + penetration_door_clearance 16 + shear_wall_parallel_route 8 + shear_wall_penetration 11 + route_insulation_unverified 7 + inline_endpoint 6（R02 ceiling −2、shear_parallel −4；R01 w_cent_north 声明穿孔 +1；R01 重算 shear_parallel +1；R04 角点触碰 +39；R03 客卫二次排水示意段两端点 +2）
  assert.equal(result.categories.envelope_approximation?.count, 132); // route_clearance_unverified 40 + route_overlap 39 + route_overlap_declared_trunk 14 + bay_sill_crossing_declared 11 + nonphysical_route 8 + reference_constraint_uncertain 11 + 其余零星（2026-10-26 R02：bay_sill 13→11，两专线不再过南窗台；2026-10-25 梁体修正：约束 5→11）
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
  assert.ok(missing.errors.some((i) => i.code === 'penetration_missing')); // penetration_missing 属 must_fix 桶，R19 起 inferred 也进 errors[]（与 shear_wall_penetration 的分级不同，系 R19 一并升级）
  const missingConfirmed = lintMepCoordination(crossingRoute({ status: 'confirmed', reason: 'x' }), sources, wallContext({}));
  assert.ok(missingConfirmed.errors.some((i) => i.code === 'penetration_missing'));
  const aligned = lintMepCoordination(crossingRoute({ penetration: [{ wall: 'w_test', at: { x: 1, z: 0 }, height: 2.5 }] }), sources, wallContext({}));
  assert.equal(aligned.warnings.some((i) => i.code === 'penetration_missing' || i.code === 'penetration_point_mismatch'), false);
  const off = lintMepCoordination(crossingRoute({ penetration: [{ wall: 'w_test', at: { x: 1, z: 0.5 }, height: 2.5 }] }), sources, wallContext({}));
  assert.ok(off.errors.some((i) => i.code === 'penetration_point_mismatch')); // 同属 must_fix 桶，R19 起进 errors[]
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
  const found = rise.errors.filter((i) => i.code === 'gravity_slope_geometry_mismatch'); // must_fix 桶，R19 起进 errors[]
  assert.equal(found.length, 1);
  assert.match(found[0].message, /segment #2 \(1,0\)→\(2,0\) rises 0\.040m → 0\.050m/);
  // confirmed 路线同样命中且只报一次（分级由类别桶决定，不随 route status 再变）
  const confirmedRise = lintMepCoordination(sample({
    id: 'gravity-confirmed-rise', layer: 'drainage', status: 'confirmed', source_status: 'plan_supported', reason: 'x',
    method: 'gravity_floor_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.05, to_height: 0.06, from: { x: 0, z: 0, y: 0.05 }, via: [{ x: 1, z: 0, y: 0.04 }], to: { x: 2, z: 0, y: 0.06 },
  }), sources); // 注：端点 y 由 from/to_height 决定（解析口径），故 to_height 须与 to.y 同为 0.06 上升才成立
  assert.equal(confirmedRise.errors.filter((i) => i.code === 'gravity_slope_geometry_mismatch').length, 1);
  assert.equal(confirmedRise.warnings.some((i) => i.code === 'gravity_slope_geometry_mismatch'), false);
});

test('declared slope is checked per segment, but wall drains are judged on the whole run', () => {
  // 地埋管：折线全平（y 恒等）却声明 1% 坡度 → 逐段判命中（bf29283 起 code 为 gravity_slope_below_design_target、进 errors[]）
  const flat = gravityRoute({ from_height: 0.02, to_height: 0.02, from: { x: 0, z: 0, y: 0.02 }, via: [{ x: 1, z: 0, y: 0.02 }], to: { x: 2, z: 0, y: 0.02 } });
  const flatIssue = flat.errors.find((i) => i.code === 'gravity_slope_below_design_target')!;
  assert.match(flatIssue.message, /segment #1 has 0\.0mm fall over 1\.00m \(0\.00%\); the declared minimum is 1\.00%/);
  // 墙排：柜内转 90° 吃掉大部分落差，逐段判会把 1.40m 平段刷成告警；按全线汇总 0.02m/1.94m≈1.03% 合格（DEC-2026-10-23-R02 恢复全线口径）
  const wallDrain = lintMepCoordination(sample({
    id: 'wall-drain-ok', layer: 'drainage', status: 'inferred', source_status: 'plan_supported',
    method: 'gravity_wall_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.35, to_height: 0.33,
    from: { x: 0.575, z: 2.96, y: 0.35 }, via: [{ x: 0.575, z: 2.70, y: 0.34 }, { x: 0.3, z: 2.70, y: 0.33 }], to: { x: 0.3, z: 1.3, y: 0.33 },
  }), sources);
  assert.equal([...wallDrain.errors, ...wallDrain.warnings].some((i) => i.code === 'gravity_slope_below_design_target' && i.routeId === 'wall-drain-ok'), false);
  // 同一个墙排几何只把汇集落差改小：全线 0.44% < 声明 1% → 按全线口径命中一条（对照真实配置 drain-gbath-vanity-to-riser 的 R1 原始几何）
  const wallDrainFlat = lintMepCoordination(sample({
    id: 'wall-drain-flat', layer: 'drainage', status: 'inferred', source_status: 'plan_supported',
    method: 'gravity_wall_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.30, to_height: 0.29,
    from: { x: 6.9, z: 3.55, y: 0.30 }, via: [{ x: 6.9, z: 2.45, y: 0.30 }, { x: 5.8, z: 2.45, y: 0.29 }], to: { x: 5.8, z: 2.4, y: 0.29 },
  }), sources);
  const wallIssue = wallDrainFlat.errors.find((i) => i.code === 'gravity_slope_below_design_target')!;
  assert.match(wallIssue.message, /wall-drain run has 10\.0mm fall over 2\.25m \(0\.44%\); the declared minimum is 1\.00% judged on the whole run/);
  // PR #14 评审回归：全线落差必须带方向——上坡 20mm/2m 的绝对值恰为 1% 会被 abs() 误判达标。
  // down 流向净上坡（端点倒坡另有方向冲突兜底，本条专守全线判坡自身）与 up 流向墙排均须命中。
  const wallDrainUphill = lintMepCoordination(sample({
    id: 'wall-drain-uphill', layer: 'drainage', status: 'inferred', source_status: 'plan_supported',
    method: 'gravity_wall_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.30, to_height: 0.32,
    from: { x: 0, z: 0, y: 0.30 }, to: { x: 2, z: 0, y: 0.32 },
  }), sources);
  assert.ok(wallDrainUphill.errors.some((i) => i.code === 'gravity_slope_below_design_target' && i.routeId === 'wall-drain-uphill'), 'down 流向墙排净上坡应按带方向落差命中');
  const wallDrainUpFlow = lintMepCoordination(sample({
    id: 'wall-drain-upflow', layer: 'drainage', status: 'inferred', source_status: 'plan_supported',
    method: 'gravity_wall_drain', diameter: 0.075, flow_direction: 'up', slope: 0.01,
    from_height: 0.30, to_height: 0.32,
    from: { x: 0, z: 0, y: 0.30 }, to: { x: 2, z: 0, y: 0.32 },
  }), sources);
  assert.ok(wallDrainUpFlow.errors.some((i) => i.code === 'gravity_slope_below_design_target' && i.routeId === 'wall-drain-upflow'), 'up 流向墙排不得把上升算成落差');
});

test('wall drain vertical drop must not subsidize an under-sloped horizontal run', () => {
  // PR #14 评审回归：先竖直下落 0.30m、再接 2.00m 仅跌 5mm（0.25%）的横管。旧全线口径
  // 用首末点总落差 0.305m 对 2.00m 判 15.25%「达标」，竖直落差把横管欠坡补贴掉了；
  // 横管坡度只能由横管段自身落差供（与逐段口径 gravitySlopeDeficits 的 R01 原则一致：
  // 纯竖直段与近竖直段是落水不是横管，不供落差）。
  const subsidized = lintMepCoordination(sample({
    id: 'wall-drain-vertical-subsidy', layer: 'drainage', status: 'inferred', source_status: 'plan_supported',
    method: 'gravity_wall_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.60, to_height: 0.295,
    from: { x: 0, z: 0, y: 0.60 }, via: [{ x: 0, z: 0, y: 0.30 }], to: { x: 2, z: 0, y: 0.295 },
  }), sources);
  const issue = subsidized.errors.find((i) => i.code === 'gravity_slope_below_design_target' && i.routeId === 'wall-drain-vertical-subsidy');
  assert.ok(issue, '竖直落差不得让欠坡横管达标');
  assert.match(issue.message, /wall-drain run has 5\.0mm fall over 2\.00m \(0\.25%\); the declared minimum is 1\.00% judged on the whole run/);
  // 近竖直斜段（平面 0.10m 跌 0.30m，>45°）同理不供落差：其后横管仍只有 5mm/2.00m
  const steep = lintMepCoordination(sample({
    id: 'wall-drain-steep-subsidy', layer: 'drainage', status: 'inferred', source_status: 'plan_supported',
    method: 'gravity_wall_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.60, to_height: 0.295,
    from: { x: 0, z: 0, y: 0.60 }, via: [{ x: 0.1, z: 0, y: 0.30 }], to: { x: 2.1, z: 0, y: 0.295 },
  }), sources);
  assert.ok(steep.errors.some((i) => i.code === 'gravity_slope_below_design_target' && i.routeId === 'wall-drain-steep-subsidy'), '近竖直段落差不得让欠坡横管达标');
  // 对照：同样的竖直下落 + 横管自身达标（2.00m 跌 25mm = 1.25%）→ 不得误报
  const okRun = lintMepCoordination(sample({
    id: 'wall-drain-vertical-ok', layer: 'drainage', status: 'inferred', source_status: 'plan_supported',
    method: 'gravity_wall_drain', diameter: 0.075, flow_direction: 'down', slope: 0.01,
    from_height: 0.60, to_height: 0.275,
    from: { x: 0, z: 0, y: 0.60 }, via: [{ x: 0, z: 0, y: 0.30 }], to: { x: 2, z: 0, y: 0.275 },
  }), sources);
  assert.equal(okRun.errors.some((i) => i.code === 'gravity_slope_below_design_target' && i.routeId === 'wall-drain-vertical-ok'), false);
});

// ── (b) 相邻点斜线段 ──

test('diagonal segments are flagged across MEP layers while coordinate jitter stays quiet', () => {
  // 注：via 无 y 时按 layer 高度兜底（现行点位解析口径），夹具须显式给 via 的 y 才是纯平面几何
  const diagonal = lintMepCoordination(sample({
    id: 'diag', layer: 'water_supply', status: 'pending', source_status: 'plan_supported', method: 'floor_branch',
    diameter: 0.025, from_height: 0.18, to_height: 0.18, from: { x: 0, z: 0 }, via: [{ x: 1, z: 0.3, y: 0.18 }], to: { x: 2, z: 0 },
  }), sources);
  const found = diagonal.errors.find((i) => i.code === 'route_not_orthogonal')!; // must_fix 桶，R19 起进 errors[]；消息格式现带 y 坐标
  assert.match(found.message, /segment #1 \(0,0\.18,0\)→\(1,0\.18,0\.3\) moves Δx=1\.00m and Δz=0\.30m at once/);
  // 阈值 0.02m：0.01m 级的坐标抖动不算斜线
  const jitter = lintMepCoordination(sample({
    id: 'jitter', layer: 'water_supply', status: 'pending', source_status: 'plan_supported', method: 'floor_branch',
    diameter: 0.025, from_height: 0.18, to_height: 0.18, from: { x: 0, z: 0 }, via: [{ x: 1, z: 0.01, y: 0.18 }], to: { x: 2, z: 0 },
  }), sources);
  assert.equal([...jitter.errors, ...jitter.warnings].some((i) => i.code === 'route_not_orthogonal'), false);
  // carried layer 平面两轴各超过 0.15m 且斜长超过 0.3m 时也会显形。
  const power = lintMepCoordination(sample({
    id: 'power-diag', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.45, to_height: 2.45, from: { x: 0, z: 0 }, via: [{ x: 1, z: 0.3, y: 2.45 }], to: { x: 2, z: 0 },
  }), sources);
  assert.equal(power.errors.some((i) => i.code === 'route_not_orthogonal'), true);
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
  const jambFound = jamb.errors.find((i) => i.code === 'penetration_door_clearance')!; // must_fix 桶进 errors[]
  assert.match(jambFound.message, /is inside the door opening height 2\.10m/);
  assert.equal(jambFound.category, 'must_fix_before_briefing');
  const far = lintMepCoordination(doorCrossingRoute({ x: 1, z: 0.9 }), sources, context);
  assert.equal([...far.errors, ...far.warnings].some((i) => i.code === 'penetration_door_clearance'), false);
  // 没有可解析门洞数据的墙：静默跳过，既不报错也不误报（单路由夹具恒带全局 coverage error，故按 routeId 断言本路线无 finding）
  const noOpening = lintMepCoordination(doorCrossingRoute({ x: 1, z: 0.5 }), sources, doorWallContext([]));
  assert.equal([...noOpening.errors, ...noOpening.warnings].some((i) => i.code === 'penetration_door_clearance'), false);
  assert.equal(noOpening.errors.some((i) => i.routeId === 'door-cross' && (i.code === 'penetration_door_clearance' || i.code === 'door_opening_collision')), false); // 门洞规则静默；该夹具另有坡度/依托类 finding 与门洞无关
  const brokenOpening = lintMepCoordination(doorCrossingRoute({ x: 1, z: 0.5 }), sources, doorWallContext([{ id: 'd_broken', type: 'door' }]));
  assert.equal(brokenOpening.errors.some((i) => i.routeId === 'door-cross' && (i.code === 'penetration_door_clearance' || i.code === 'door_opening_collision')), false);
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
  assert.equal(confirmed.errors.some((i) => i.code === 'shear_wall_parallel_route'), false); // survey 桶不升级；errors 总数断言已失效（单路由夹具恒带全局 coverage error）
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
  assert.equal(result.counts.routes, 137); // DEC-2026-10-27-R01 删床头路线 strong-light-bedrooms-parent-bed 后 138→137； // DEC-2026-10-23-R03 新增客卫沉箱二次排水需求路线后 138（前史：DEC-2026-10-18-R21 补画 strong-power-living-water 后 135→136（前史：DEC-2026-10-17-R20 删 strong-ded-fridge / strong-power-parent-child-parentbed-l 后 130→128（前史：R1 删两条照明路由 137→135；R2 删四条卫浴照明路由后 131；DEC-2026-10-13-R5 删 strong-light-tv 后 130）；同批走线专项 +7 条新点位路线后 128→135
  assert.equal(result.counts.resolvedRoutes, 137); // DEC-2026-10-27-R01 删床头路线后与 routes 同步 137； // DEC-2026-10-18-R21后136；R25新增主管后与routes同步137；DEC-2026-10-23-R03 后同步 138（前史：R1 删 strong-light-bedrooms-master-wall-l/-r 后 135；R2 删 strong-light-gbath/-mbath-panel/-mbath-switch/-gbath-switch 四条卫浴照明路由后 routes/resolved 均 131；DEC-2026-10-17-R20 后 128；走线专项后与 routes 同步 135
  assert.equal(result.errors.length, 111); // DEC-2026-10-27-R01 删床头路线，must_fix 悬空 hit −1 // R19/R20 起 must_fix 桶即 errors[]。本 harness（realContext 无家具/飘窗/可达性上下文）为 112（DEC-2026-10-26-R02 书房墙垛建模 + 书桌东移 + 衣柜南延后实测：route_overlap 63、route_not_orthogonal 28、unsupported_span 9、floor_band_method_mismatch 1，自 116 降至 112）；verify:mep 全上下文口径为 127（R02 登记值），差 15 = route_furniture_collision 10 + endpoint_inaccessible 5，只在全上下文下产生（bay_sill_collision 两口径均为 0）
  // (a) 重力坡度：R1 后 14 条全清（地埋全平/过陡、冷凝水候选沿程、drain-balcony 2% 回算、墙排汇总不足坡）
  assert.equal(countByCode(result, 'gravity_slope_geometry_mismatch'), 0);
  assert.equal(result.warnings.some((i) => i.code === 'gravity_slope_geometry_mismatch' && i.routeId === 'drain-gbath-vanity-to-riser'), false);
  // (b) 全专业正交检查覆盖现行强弱电、冷媒、风管和给排水折点。
  assert.equal(countByCode(result, 'route_not_orthogonal'), 32); // 2026-10-26 实测重钉（must_fix 28 + envelope 4；R02 干线东腿水平+起升分段、冷凝水首段正交化后自 R01 期 34 下降）
  // (c) 穿点距门洞：2026-10-07 M05 声明式补路由后 15 → 19；过门头 → survey_dependent，门洞高度内贴门垛 → must_fix
  const strip = result.warnings.filter((i) => i.code === 'penetration_door_clearance' && i.routeId === 'strong-ac-master');
  assert.equal(strip.length, 1);
  assert.match(strip[0].message, /on w_strip_east at \(4\.20,4\.60\) is 0\.05m from door opening d_mb \(z 4\.65–5\.55\)/);
  assert.match(strip[0].message, /过门头穿梁，需核梁底与套管/);
  assert.equal(strip[0].category, 'survey_dependent');
  assert.equal(countByCode(result, 'penetration_door_clearance'), 16); // 本 harness 实测 16（全 survey）；verify:mep 全上下文另有 2 条 must_fix（含 water-balcony 门洞带内贴门垛，其门洞数据只在全上下文 layout 下解析）——带内贴门垛的分级由上方合成夹具用例覆盖
  // (d) 剪力墙并行 8 → 14（2026-10-07 M04/M05 补路由贴剪力墙竖槽，见各条 reason 扫筋声明）
  const masterParallel = result.warnings.find((i) => i.code === 'shear_wall_parallel_route' && i.routeId === 'strong-power-master')!;
  assert.match(masterParallel.message, /parallel to shear wall w_mb_east for 3\.60m at 0\.10m/);
  assert.equal(countByCode(result, 'shear_wall_parallel_route'), 7); // DEC-2026-10-26-R02：两专线不再贴 w_mb_east 南下 −2；干线/冷凝水东腿离墙 0.65/0.75、脱离贴墙并行 −2；DEC-2026-10-27-R01 删床头路线（贴 w_mb_east 南下段）−1，12→8；DEC-2026-10-12-R1 删 strong-light-bedrooms-master-wall-l（贴 w_mb_east 平行 1.355m）后 14→13；DEC-2026-10-13-R3 主卧吸顶灯移位后两条照明路由改走门头盒空腔、不再贴 w_mb_east 长距离平行，13→11；R01 重算 guest-north 贴北墙面 1.10m +1
  // DEC-2026-10-13-R3 锁定改善：重画后的两条路由不得再贴 w_mb_east 长距离平行。
  // 若将来有人把几何改回贴墙（或把灯位改回 (2.60,7.60) 而不同步路由），这里立即 fail——
  // 正是本轮第一次提交时漏掉同步、导致 shear 13→11 / unsupported_span 7→9 双向漂移的那个失效模式。
  const shearRouteIds = result.warnings.filter((i) => i.code === 'shear_wall_parallel_route').map((i) => i.routeId);
  assert.equal(shearRouteIds.includes('strong-light-master'), false, 'strong-light-master 应走 ceiling_master_ac 门头盒空腔，不得贴 w_mb_east 长距离平行');
  assert.equal(shearRouteIds.includes('strong-light-bedrooms-master-bed-north'), false, 'strong-light-bedrooms-master-bed-north 同上');
  // 未改动的南床头联络管仍贴墙（证明上面的 false 不是"规则失效"而是"这两条真的改了"）
  assert.equal(shearRouteIds.includes('strong-light-bedrooms-master-bed-l'), true);
  // 分桶核算：三桶之和 == error + warning 总数，且每桶 count == 各类 count 之和
  const buckets = bucketsOf(result);
  const total = result.errors.length + result.warnings.length;
  assert.equal(Object.values(buckets).reduce((sum, bucket) => sum + bucket.count, 0), total);
  for (const bucket of Object.values(buckets)) assert.equal(bucket.count, bucket.codes.reduce((sum, entry) => sum + entry.count, 0));
  // 分桶代码明细必须与实算完全一致（gravity_slope/orthogonal 已出 must_fix；penetration_door_clearance 拆 must_fix 2 / survey 13）
  // unsupported_span：F01/F02 首轮只检查水平段；2026-10-17 R2 后按3D长度检查水平/斜向/竖直段。
  // inline_endpoint_without_point_anchor 5 条：DEC-2026-10-08-W02 端点绑定兜底（给排水无锚点端点的量房判读清单；W03 客卫热水改绑 faucet_gbath_vanity 后由 5 降为 4；DEC-2026-10-23-R03 客卫二次排水示意段两端点 +2 至 6）
  // 2026-10-23 按本 harness 现行实测整体重钉（R21 期旧表已被 R25 拓扑/R01 登记/DEC-2026-10-23-R02 墙排口径取代；与 verify:mep 全上下文的差异见 errors 断言注释）
  assert.deepEqual(Object.fromEntries(buckets.must_fix_before_briefing.codes.map((e) => [e.code, e.count])), { route_overlap: 63, route_not_orthogonal: 28, suppressed_wall_crossing: 7, unsupported_span: 8, mep_endpoint_service_conflict: 2, door_opening_collision: 1, route_endpoint_unusable: 1, floor_band_method_mismatch: 1 }); // DEC-2026-10-26-R02：route_overlap 67→63、route_not_orthogonal 30→28、unsupported_span 7→9（干线/冷凝水东腿走开放空间）；DEC-2026-10-25-R01：route_overlap 68→66、route_not_orthogonal 32→30、floor_band_method_mismatch 0→1；R01 重算 overlap +1
  assert.deepEqual(Object.fromEntries(buckets.survey_dependent.codes.map((e) => [e.code, e.count])), { ceiling_clearance_unverified: 97, penetration_door_clearance: 16, shear_wall_parallel_route: 7, shear_wall_penetration: 11, route_insulation_unverified: 7, inline_endpoint_without_point_anchor: 6 }); // R02：ceiling_clearance 101→99（两专线改道东墙）、shear_wall_parallel_route 12→8（两专线离墙 + 干线/冷凝水东腿离墙）；R01：shear_wall_penetration 10→11（w_cent_north 声明穿孔）；R01 重算 shear_wall_parallel_route 11→12（guest-north 贴北墙面 1.10m）；R04：ceiling_clearance 62→101 角点触碰登记
  assert.deepEqual(Object.fromEntries(buckets.envelope_approximation.codes.map((e) => [e.code, e.count])), { route_clearance_unverified: 40, route_overlap: 39, route_overlap_declared_trunk: 14, nonphysical_route: 8, reference_constraint_uncertain: 11, route_not_orthogonal: 4, unsupported_span: 2, supply_return_overlap: 1 }); // 2026-10-25 梁体修正：参考梁约束 5→11 条
  assert.equal(buckets.must_fix_before_briefing.count, 111); // DEC-2026-10-27-R01 删床头路线，must_fix 悬空 hit −1 // R02 重算后与 errors.length 同值（见上）
  assert.equal(buckets.survey_dependent.count, 144); // DEC-2026-10-27-R01 ceiling_clearance −2、shear_wall_parallel −1，147→144；DEC-2026-10-26-R02 ceiling_clearance −2、shear_wall_parallel −4，153→147；DEC-2026-10-25-R01 shear_wall_penetration +1（w_cent_north 声明穿孔），151→152；R01 重算 shear_wall_parallel_route +1，152→153；此前 DEC-2026-10-23-R04 ceiling_clearance +39（角点触碰登记），112→151；此前 DEC-2026-10-23-R03 inline +2
  assert.equal(buckets.envelope_approximation.count, 119); // 2026-10-25 梁体修正：reference_constraint_uncertain 5→11
  // 飞线依托检查自证：最长飞线是 strong-power-living 出边吊后的 4.16m 无依托段（reason 声称「平吊板上方敷设」
  // 但 weak-ap reason 明说客厅中部保持原顶 2.80m 无吊顶——两处自相矛盾被机器显形）
  // F01 改线批：33 条命中清至 8 条显式保留（每条 reason 带 DEC-2026-10-07-F01 归因）
  const flying = [...result.errors, ...result.warnings].filter((i) => i.code === 'unsupported_span');
  assert.equal(flying.length, 10); // DEC-2026-10-27-R01 删床头路线，must_fix unsupported_span 9→8，合计 11→10；2026-10-26 实测重钉（must_fix 9 + envelope 2；R02 干线/冷凝水东腿走开放空间、must_fix unsupported_span 7→9；R19 前的 14 为 warnings 单数组旧口径）
  const worstFlying = flying.reduce((a, b) => (b.message.match(/for (\d+\.\d\d)m/)?.[1] ?? '0') > (a.message.match(/for (\d+\.\d\d)m/)?.[1] ?? '0') ? b : a);
  assert.equal(worstFlying.routeId, 'condensate-living');
  assert.match(worstFlying.message, /flies unsupported for 3\.82m/); // R25 汇流改线后最长无依托段为该斜段；DEC-2026-10-23-R04 餐厅西服务带东移 0.10 后依托段增长、无依托段 3.92→3.82m（2026-10-23 实测重钉）
  assert.equal(flying.some((i) => i.routeId === 'strong-power-living-sofa-r'), false, '箱体侧垂直段贴墙、水平段在垫层，不应报无依托');
  assert.equal(flying.some((i) => i.routeId === 'strong-power-living-sofa-l'), false, '左沙发地插路线现行几何已不飞线（2026-10-23 实测；旧断言的开放空间长竖降已被后续改线消除）');
  // 改线自证：strong-power-living 干线已改走 w_be_west 东脸 + 窗帘盒带（原 4.16m 横穿客厅中部已清）
  assert.equal(flying.some((i) => i.routeId === 'strong-power-living'), false);
  // 走地给排水两层不参与依托检查（与 ceiling_clearance 口径修正同源：地面管与吊顶依托无可比性）
  assert.equal(flying.some((i) => result.warnings.find((w) => w === i && w.routeId?.startsWith('drain-') === true && config.routes.find((r) => r.id === w.routeId)?.layer === 'drainage')), false);
});

// ── DEC-2026-10-06-R5：#41 分层标高升入降板空腔（A/B 分区 + 梁硬约束 + 走地分层豁免）──

/** 取一条真实路线在吊顶 footprint 内的 via 点标高（只查 via：from/to 可能是设备末点，本就该低于完成面）。
 * 只查承载段 via（y≥2.0）：R21 起部分路线在 footprint 平面范围内带下引分发段（如 strong-power-kitchen
 * 沿墙下引至台面插座，via y=0.02 是垫层点位），那不是吊顶承载段、不受带高约束。 */
function viaYsInCeilings(routeId: string): Array<{ y: number; zone: string }> {
  const route = config.routes.find((r) => r.id === routeId)!;
  const out: Array<{ y: number; zone: string }> = [];
  for (const v of route.via ?? []) {
    const zone = (ceiling as Array<{ id: string; area?: number[]; type: string; thickness?: number }>).find((z) => z.area
      && v.x >= Math.min(z.area[0], z.area[2]) && v.x <= Math.max(z.area[0], z.area[2])
      && v.z >= Math.min(z.area[1], z.area[3]) && v.z <= Math.max(z.area[1], z.area[3]));
    if (zone && typeof v.y === 'number' && v.y >= 2.0) out.push({ y: v.y, zone: zone.id });
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
    const inKitchen = (route.via ?? []).filter((v) => v.x >= KITCHEN[0] && v.x <= KITCHEN[2] && v.z >= KITCHEN[1] && v.z <= KITCHEN[3] && (v.y as number) >= 2.0).map((v) => v.y as number); // 同 viaYsInCeilings：只查承载段，排除下引分发低位点
    assert.ok(inKitchen.length > 0, `${id} 应有段落进入厨房铝扣板 footprint`);
    for (const y of inKitchen) assert.ok(y >= 2.70 && y <= 2.76, `${id} 厨房段应在 2.70–2.76（B 区），实际 ${y}`);
  }
  // B 区（客卫铝扣板）：≥2.70
  // DEC-2026-10-12-R2：strong-light-gbath（客卫照明）已随平板灯删除，故 B 区客卫只剩电源与浴霸两条
  for (const id of ['strong-power-gbath', 'strong-ded-bathheaters-gbath']) {
    const route = config.routes.find((r) => r.id === id)!;
    const inBath = (route.via ?? []).filter((v) => v.x >= GUEST_BATH[0] && v.x <= GUEST_BATH[2] && v.z >= GUEST_BATH[1] && v.z <= GUEST_BATH[3] && (v.y as number) >= 2.0).map((v) => v.y as number);
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
  // 具名豁免：weak-ap-master 的 2.51 穿点是 DEC-2026-10-17-R20/R25 的刻意降层（在冷媒/强电
  // 交叉下方穿行、逐项净距已在该路线 reason 里算清，且仍高于走廊完成面 2.50）——豁免按精确值钉死，改值即红。
  const SUB_BAND_PENETRATION_EXEMPTIONS: Record<string, number> = { 'weak-ap-master': 2.51 };
  for (const route of config.routes) {
    for (const p of (route.penetration ?? []) as Array<{ height?: number }>) {
      if (typeof p.height !== 'number') continue;
      if (SUB_BAND_PENETRATION_EXEMPTIONS[route.id] !== undefined && p.height === SUB_BAND_PENETRATION_EXEMPTIONS[route.id]) continue;
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
  // 绕不开梁带的两条冷凝水候选路线：标高逐条显式登记（DEC-2026-10-06-R5 允许的残留；
  // from_height 2.35 → 2.52 为 DEC-2026-10-19-R25 汇流拓扑建模后的现值，残留登记仍在 reason 中）
  for (const id of ['condensate-living', 'condensate-dining']) {
    const route = config.routes.find((r) => r.id === id)!;
    assert.equal(route.from_height, 2.52, `${id} 应保留登记 from_height 2.52（绕不开走廊服务带梁带）`);
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
  target.method = 'conduit';
  const lifted = lintMepCoordination(asCarried, sources, realContext());
  assert.ok(lifted.warnings.some((issue) => issue.code === 'ceiling_clearance_unverified' && issue.routeId === 'water-kitchen-requirement'));
  // 六个承载层都参与；water_supply / drainage 都不参与
  for (const layer of ['strong_power', 'weak_power', 'refrigerant', 'condensate', 'supply_air', 'return_air']) {
    const probe = structuredClone(config);
    const route = probe.routes.find((r) => r.id === 'water-kitchen-requirement')!;
    (route as { layer: string }).layer = layer;
    route.method = 'conduit';
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

// ── (f) 飞线依托检查（unsupported_span）：吊顶承载层的水平段必须有依托 ──

/** 支持检查专用 context：可注自定墙 / 实心吊顶分区 / suppressed 墙，不传墙时默认一面 x=1 的测试墙。 */
function supportContext(walls: Array<Record<string, unknown>> = [], zones: Array<Record<string, unknown>> = [], suppressed: string[] = []): MepLintLayoutContext {
  return {
    layout: {
      rooms: [], vertices: [], openEdges: [],
      walls: (walls.length ? walls : [{}]).map((w) => ({ id: 'w_test', x1: 1, z1: -1, x2: 1, z2: 1, height: 2.8, ...w })),
    } as unknown as ResolvedLayout,
    ...(zones.length ? { ceiling: zones as unknown as MepLintLayoutContext['ceiling'] } : {}),
    ...(suppressed.length ? { suppressedWallIds: suppressed } : {}),
  };
}
const FAR_WALL = { id: 'w_far', x1: 50, z1: 0, x2: 50, z2: 2 };
function flyingRoute(extra: Record<string, unknown> = {}) {
  return sample({
    id: 'fly', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.55, to_height: 2.55, from: { x: 0, z: 0, y: 2.55 }, to: { x: 3, z: 0, y: 2.55 }, ...extra,
  });
}

test('a mid-room horizontal run with no ceiling, wall, or screed support is flagged as flying', () => {
  const result = lintMepCoordination(flyingRoute(), sources, supportContext([FAR_WALL]));
  const found = result.errors.find((i) => i.code === 'unsupported_span')!; // must_fix 桶，R19 起进 errors[]
  assert.match(found.message, /flies unsupported for 3\.00m from \(0\.00,0\.00\) to \(3\.00,0\.00\) at 2\.55m/);
  assert.equal(found.category, 'must_fix_before_briefing');
  // 多段飞线：报最长一段 + 缺口统计；两段各 1.20m、共 2.40m
  const crossed = lintMepCoordination(flyingRoute(), sources, supportContext([{ id: 'w_mid', x1: 1.5, z1: -1, x2: 1.5, z2: 1 }]));
  const crossedFound = crossed.errors.find((i) => i.code === 'unsupported_span')!;
  assert.match(crossedFound.message, /flies unsupported for 1\.20m/);
  assert.match(crossedFound.message, /2 unsupported gaps totalling 2\.40m/);
});

test('runs inside a solid ceiling cavity, hugging a wall, crossing a wall, or in the screed are supported; open vertical drops are not', () => {
  // 吊顶空腔：实心分区（drop，完成面 = 2.8 − 0.3 = 2.50），管路 2.55 ≥ 2.50 即有依托
  const cavity = { id: 'cz', room: 'r', type: 'drop', thickness: 0.3, area: [-1, -1, 4, 1] };
  const covered = lintMepCoordination(flyingRoute(), sources, supportContext([FAR_WALL], [cavity]));
  assert.equal([...covered.errors, ...covered.warnings].some((i) => i.code === 'unsupported_span'), false);
  // 贴墙：0.10m ≤ 0.25m
  const hugged = lintMepCoordination(flyingRoute({ from: { x: 1.1, z: -0.9, y: 2.5 }, to: { x: 1.1, z: 0.9, y: 2.5 }, from_height: 2.5, to_height: 2.5 }), sources, supportContext());
  assert.equal([...hugged.errors, ...hugged.warnings].some((i) => i.code === 'unsupported_span'), false);
  // 穿墙：短距穿越段全程在墙的贴墙距离内（声明缺口由 penetration_missing 另行负责）
  const crossing = lintMepCoordination(flyingRoute({ from: { x: 0.8, z: 0, y: 2.5 }, to: { x: 1.2, z: 0, y: 2.5 }, from_height: 2.5, to_height: 2.5 }), sources, supportContext());
  assert.equal([...crossing.errors, ...crossing.warnings].some((i) => i.code === 'unsupported_span'), false);
  // 纯竖直段：开放空间里的长下引必须有依托；贴实体墙下引仍合法。
  const drop = lintMepCoordination(sample({
    id: 'drop', layer: 'strong_power', route_kind: 'physical', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.55, to_height: 0.3, from: { x: 0, z: 0 }, to: { x: 0, z: 0 },
  }), sources, supportContext([FAR_WALL]));
  assert.match(drop.errors.find((i) => i.code === 'unsupported_span')!.message, /vertical segment/);
  const wallDrop = lintMepCoordination(sample({
    id: 'wall-drop', layer: 'strong_power', route_kind: 'physical', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.55, to_height: 0.3, from: { x: 1.1, z: 0 }, to: { x: 1.1, z: 0 },
  }), sources, supportContext());
  assert.equal([...wallDrop.errors, ...wallDrop.warnings].some((i) => i.code === 'unsupported_span'), false);
  // 0.30m 平面就位步里若高度落差穿过开放空间，也按3D长度采样，不能被短平面阈值漏掉。
  const diagonalDrop = lintMepCoordination(sample({
    id: 'diagonal-drop', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 0.02, to_height: 2.55,
    from: { x: 0, z: 0, y: 0.02 }, to: { x: 0, z: 0.3, y: 2.55 },
  }), sources, supportContext([FAR_WALL]));
  assert.match(diagonalDrop.errors.find((i) => i.code === 'unsupported_span')!.message, /diagonal segment/);
  // floor_branch_candidate is not a blanket clearance exemption: it must actually enter the floor band,
  // and its elevated portion still goes through the 3D support check.
  const mislabeledFloor = lintMepCoordination(flyingRoute({ method: 'floor_branch_candidate' }), sources, supportContext([FAR_WALL]));
  assert.ok([...mislabeledFloor.errors, ...mislabeledFloor.warnings].some((i) => i.code === 'floor_branch_missing_floor_band'));
  assert.ok([...mislabeledFloor.errors, ...mislabeledFloor.warnings].some((i) => i.code === 'unsupported_span'));
  // 垫层内水平段：floor_branch_candidate 进垫层后的平移
  const screed = lintMepCoordination(flyingRoute({ from_height: 0.02, to_height: 0.02, from: { x: 0, z: 0, y: 0.02 }, to: { x: 3, z: 0, y: 0.02 } }), sources, supportContext([FAR_WALL]));
  assert.equal([...screed.errors, ...screed.warnings].some((i) => i.code === 'unsupported_span'), false);
});

test('hugging a suppressed curtain wall is not support, and confirmed routes escalate to error', () => {
  // 幕墙不能挂载不能剔槽（AGENTS.md 铁律）→ 贴幕墙不构成依托
  const curtain = lintMepCoordination(flyingRoute({ from: { x: 1.1, z: -0.9, y: 2.5 }, to: { x: 1.1, z: 0.9, y: 2.5 }, from_height: 2.5, to_height: 2.5 }), sources, supportContext([], [], ['w_test']));
  assert.ok(curtain.errors.some((i) => i.code === 'unsupported_span')); // must_fix 桶，R19 起进 errors[]
  // confirmed 路由飞线升 error（与 penetration_missing 同策略）；requirement/candidate 归 envelope_approximation
  const confirmed = lintMepCoordination(flyingRoute({ status: 'confirmed', reason: 'x' }), sources, supportContext([FAR_WALL]));
  assert.ok(confirmed.errors.some((i) => i.code === 'unsupported_span'));
  const requirement = lintMepCoordination(flyingRoute({ source_status: 'design_requirement' }), sources, supportContext([FAR_WALL]));
  assert.equal(requirement.warnings.find((i) => i.code === 'unsupported_span')!.category, 'envelope_approximation');
});

test('endpoint jogs shorter than 0.3m and water layers stay out of the flying check', () => {
  // 0.25m 无依托 jog < 0.3m 阈值：不报
  const jog = lintMepCoordination(flyingRoute({ to: { x: 0.25, z: 0, y: 2.55 } }), sources, supportContext([FAR_WALL]));
  assert.equal([...jog.errors, ...jog.warnings].some((i) => i.code === 'unsupported_span'), false);
  // 走地给排水分层不在吊顶承载层口径内（依托问题由坡度/正交规则管）
  const water = lintMepCoordination(sample({
    id: 'water-fly', layer: 'water_supply', status: 'pending', source_status: 'plan_supported', method: 'floor_branch',
    diameter: 0.025, from_height: 0.18, to_height: 0.80, from: { x: 0, z: 0, y: 0.18 }, to: { x: 3, z: 0, y: 0.8 },
  }), sources, supportContext([FAR_WALL]));
  assert.equal([...water.errors, ...water.warnings].some((i) => i.code === 'unsupported_span'), false);
});

test('fixture tail/head runs (≤2m at soffit band, endpoint on a point) count as support, mid-runs and out-of-band y do not', () => {
  // 末段+首段设备接线段：两端都是点位、各 ≤2m、y=2.70（原顶暗敷带）→ 全豁免（DEC-2026-10-07-F02）
  // sock_mbath_vanity (0.78,2.96) / sock_mbath_batheheater (1.30,2.70) 为 fixture 用真实点位
  const tail = lintMepCoordination(sample({
    id: 'tail-ok', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.7, to_height: 2.7,
    from: 'sock_mbath_vanity', via: [{ x: 2.0, z: 1.5, y: 2.7 }], to: 'sock_mbath_batheheater',
  }), sources, supportContext([FAR_WALL]));
  assert.equal([...tail.errors, ...tail.warnings].some((i) => i.code === 'unsupported_span'), false);
  // 首段设备起升段：from 为点位（outdoor_a2 6.4,0.5）、0.91m、y 在带内 → 豁免（外机连接管先例）
  const head = lintMepCoordination(sample({
    id: 'head-ok', layer: 'refrigerant', status: 'inferred', source_status: 'preliminary', method: 'insulated_copper_trunk',
    diameter: 0.032, from_height: 2.7, to_height: 2.7,
    from: 'outdoor_a2', via: [], to: { x: 5.5, z: 0.35, y: 2.7 },
  }), sources, supportContext([FAR_WALL]));
  assert.equal([...head.errors, ...head.warnings].some((i) => i.code === 'unsupported_span'), false);
  // 中段不豁免：首末段都合规，中间 1.25m 横移照报
  const mid = lintMepCoordination(sample({
    id: 'mid-no', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.7, to_height: 2.7,
    from: 'sock_mbath_vanity', via: [{ x: 2.0, z: 1.5, y: 2.7 }, { x: 2.6, z: 0.4, y: 2.7 }], to: 'sock_mbath_batheheater',
  }), sources, supportContext([FAR_WALL]));
  assert.ok([...mid.errors, ...mid.warnings].some((i) => i.code === 'unsupported_span'));
  // y 不在原顶暗敷带（2.55 条带高）：bend_corridor (7.2,4.3) 首段 1.12m ≤2m 但 y=2.55 → 照报
  const offBand = lintMepCoordination(sample({
    id: 'band-no', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.55, to_height: 2.55,
    from: 'bend_corridor', via: [{ x: 6.2, z: 4.0, y: 2.55 }], to: 'net_gateway',
  }), sources, supportContext([FAR_WALL]));
  assert.ok([...offBand.errors, ...offBand.warnings].some((i) => i.code === 'unsupported_span'));
  // 超长：首段 0.95m 豁免后，末段 3.86m > 2.0m（客厅中部原顶区无依托）→ 照报
  // （sock_living_sofa_l (11.0,6.05) / net_living (7.2,7.7) 均为真实点位；z>5.2 出 ceiling_living 无吊顶）
  const tooLong = lintMepCoordination(sample({
    id: 'long-no', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.7, to_height: 2.7,
    from: 'sock_living_sofa_l', via: [{ x: 11.0, z: 7.0, y: 2.7 }], to: 'net_living',
  }), sources, supportContext([FAR_WALL]));
  assert.ok([...tooLong.errors, ...tooLong.warnings].some((i) => i.code === 'unsupported_span'));
  // 端点是内联坐标（非点位）：不构成设备接线语义，不豁免
  const inlineEnd = lintMepCoordination(sample({
    id: 'inline-no', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.7, to_height: 2.7,
    from: { x: 3, z: 0, y: 2.7 }, via: [{ x: 2.25, z: 0, y: 2.7 }], to: { x: 1.5, z: 0, y: 2.7 },
  }), sources, supportContext([FAR_WALL]));
  assert.ok([...inlineEnd.errors, ...inlineEnd.warnings].some((i) => i.code === 'unsupported_span'));
});

// ── (e) DEC-2026-10-17-R16 共槽/汇流声明通道 ──

test('shared_trunk_with 声明对跳过 overlap；未声明的同线汇入仍报', () => {
  const base = {
    layer: 'drainage', status: 'inferred', source_status: 'plan_supported', construction_status: 'pending',
    method: 'gravity_floor_drain', diameter: 0.05, from_height: 0.02, to_height: 0.02,
    flow_direction: 'down', slope: 0.01,
  };
  // 干管沿 z=1（x 1→4）；支管沿 x=2 北来汇入 (2,1)——物理上是三通合流，不是碰撞。
  const trunk = { ...base, id: 'trunk-a', from: { x: 1, z: 1, y: 0.02 }, to: { x: 4, z: 1, y: 0.02 } };
  const branch = {
    ...base, id: 'branch-b', from: { x: 2, z: 2, y: 0.02 },
    via: [{ x: 2, z: 1.2, y: 0.016 }], to: { x: 2, z: 1, y: 0.012 },
  };
  const build = (routes: Array<Record<string, unknown>>) =>
    MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes });

  const undeclared = lintMepCoordination(build([trunk, branch]), sources);
  assert.ok(
    [...undeclared.errors, ...undeclared.warnings].some((i) => i.code === 'route_overlap'),
    '未声明的同线汇入必须保持显形',
  );

  const declared = lintMepCoordination(build([
    trunk,
    { ...branch, shared_trunk_with: ['trunk-a'], reason: '支管经三通汇入干管（DEC-2026-10-17-R16/R18 口径）' },
  ]), sources);
  assert.equal(
    declared.errors.filter((i) => i.code === 'route_overlap').length, 0,
    '声明 shared_trunk_with 后不再阻断',
  );
  // R18（业主裁定「不怕红,怕静默」）：声明不等于消失——以显形 warning 留在报告里供量房复核
  assert.ok(
    declared.warnings.some((i) => i.code === 'route_overlap_declared_trunk' && /DECLARED shared trunk/.test(i.message)),
    '声明对必须以 route_overlap_declared_trunk warning 显形',
  );
});

test('sill_crossings 声明跳过台体碰撞；未声明仍报（DEC-2026-10-17-R17）', () => {
  const route = {
    id: 'drop-through-sill', layer: 'strong_power', status: 'inferred', source_status: 'proposed',
    construction_status: 'pending', method: 'conduit', diameter: 0.02,
    from_height: 2.7, to_height: 0.3, from: { x: 3, z: 0.5, y: 2.7 },
    via: [{ x: 3, z: 0.5, y: 2.4 }], to: { x: 3, z: 0.5, y: 0.3 },
  };
  const bay = { id: 'test_bay', outline: [{ x: 2.5, z: 0 }, { x: 3.5, z: 0 }, { x: 3.5, z: 1 }, { x: 2.5, z: 1 }], sill: 2.12, height: 0.71 };
  const build = (routes: Array<Record<string, unknown>>) =>
    MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes });
  const context = { baySills: [bay] };

  const undeclared = lintMepCoordination(build([route]), sources, context);
  assert.ok(undeclared.errors.some((i) => i.code === 'bay_sill_collision'), '未声明的台体穿越必须显形');

  const declared = lintMepCoordination(
    build([{ ...route, sill_crossings: ['test_bay'] }]),
    sources,
    context,
  );
  assert.equal(
    declared.errors.filter((i) => i.code === 'bay_sill_collision').length, 0,
    '声明 sill_crossings 后不再阻断',
  );
  // R18：声明以 bay_sill_crossing_declared warning 显形,不静默
  assert.ok(
    declared.warnings.some((i) => i.code === 'bay_sill_crossing_declared' && /DECLARED bay_sill/.test(i.message)),
    '声明穿越必须以 bay_sill_crossing_declared warning 显形',
  );
});
