/**
 * penetration at 单一源收敛的回归与可见性（issue #98 第五阶段 S3）。
 *
 * - 钉值断言：69 条已删除的可派生 at，其「路线折线 ∩ 墙段唯一交点」派生值必须逐一等于
 *   删除前的手写声明值（≤1e-9，删除前实跑最大偏差 4.441e-16）。表值即被删字面量的墓碑。
 *   2026-11-26/27 量房回填 PR #270：墙位/走线移动后 46→69（+32 新声明/−9 旧声明），
 *   其中 2 条孤儿声明（refrigerant-child@w_nw_south、condensate-child@w_gbath_west_open_vanity）
 *   不可派生、未进本表，见「穿墙计数契约」测试的注与模型缺口报告。
 * - 可见性断言：16 条保留手写声明（6 共线 C + 5 严格 strict + 5 意图点 E，D 类已空）在 lint 里
 *   不再「静默不可见」——内存突变演练证明删除/漂移会被抓。
 * - fail-closed：孔数计数与冷凝链锚点派生对「不可派生且无手写 at」必须报错，不发明数值。
 * - 计数回归：takeoff 孔数 71（mep-quotes 元/孔增项的量）；lint penetration_* 计数见
 *   「真实配置 lint」测试（2026-11-27 量房回填：door_clearance 17→11、shear 13→17；
 *   orphaned 2 + missing 18 为模型缺口，本文件不钉、不放行）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import { buildMepBaySillCollisionVolumes, buildMepFurnitureCollisionVolumes } from '../../server/mep-lint-context.js';
import { parseOverlayFiles } from '../../server/overlay-merge.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
  type MepCoordination,
  type MepRoute,
} from '../../shared/mep-hvac-coordination-schema.js';
import {
  deriveMepPenetrationPoint,
  lintMepCoordination,
  resolveMepWallCrossingForm,
  type MepLintLayoutContext,
} from '../../shared/mep-hvac-lint.js';
import { computeMepTakeoff, countRoutePenetrations, type MepTakeoffRules } from '../../shared/mep-takeoff.js';
import { deriveMepPenetrationAt } from '../../shared/condensate-chain.js';
import { parseElectricalPoints, parsePlumbingPoints } from '../../shared/project-render-facts-schema.js';
import { pointMountHostIndex, pointWallIndexFromElements } from '../../shared/point-placement.js';
import { suppressedWallIds } from '../../shared/suppression.js';
import type { ProjectRenderFacts } from '../../shared/types.js';

const load = <T,>(p: string): T => yaml.load(readFileSync(p, 'utf8')) as T;
const electrical = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8'));
const plumbing = parsePlumbingPoints(readFileSync('config/plumbing.yaml', 'utf8'));
const ceiling = load<ProjectRenderFacts['ceiling']>('config/model/envelope/ceiling.yaml');
const hvac = load<ProjectRenderFacts['hvac']>('config/hvac.yaml');
const config = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
const layout = resolveLayout(load('config/layout/model-geometry.yaml') as Parameters<typeof resolveLayout>[0]);
const house = load<{ furnishings?: Record<string, Array<Record<string, unknown>>> }>('config/house.yaml');
const catalog = ProjectCatalog.load('.');
const sources = endpointSourcesFromFacts({ electrical, plumbing, ceiling, hvac },
  pointWallIndexFromElements(layout.walls), pointMountHostIndex(Object.values(house.furnishings ?? {}).flat() as never));
const resolution = resolveMepRoutes(config, sources);
const resolvedById = new Map(resolution.routes.map((item) => [item.route.id, item]));
const wallsById = new Map(layout.walls.map((wall) => [wall.id, wall]));

function routePoints(route: MepRoute): Array<{ x: number; z: number }> {
  // 统一出口唯一来源：直接取 resolveMepRoutes 的已解折线，不得用 mepRoutePoints
  // 兼容壳重解 raw via——关系型 via 步（slope_run 等）它会抛错（2026-11-14 全带泵
  // 重画：condensate-master 改 slope_run 后本文件即因此红过）。
  const resolved = resolvedById.get(route.id);
  assert.ok(resolved?.from && resolved.to, `route ${route.id} 端点应可解`);
  return resolved.points;
}

/**
 * 与 verify-mep-lint 同口径的 lint 上下文（不 import 该脚本：其顶层会自跑 CLI 并置
 * process.exitCode）。供内存突变演练用。
 */
function lintContext(): MepLintLayoutContext {
  return {
    layout,
    ceiling,
    baySills: buildMepBaySillCollisionVolumes(layout, parseOverlayFiles()),
    furnitureVolumes: buildMepFurnitureCollisionVolumes(),
    suppressedWallIds: suppressedWallIds(layout.walls),
    referenceConstraints: hvac.plans[0]?.diagram?.reference_constraints,
  };
}

// ── 69 条被删 at 的钉值墓碑（删除前 derive-assert 实跑导出；偏差全部 ≤1e-9） ──
// 2026-11-14 全带泵重画（issue #98 MEP batch 1）：condensate-master 旧 pin
// (w_mbath_south, 2.3, 2.86) 随整条旧路由作废——新路由不再穿主卫，改钉新穿点
// (w_strip_east, 4.2, 4.6)；condensate-child 穿点由 (5.6, 3.87) 改 (5.6, 4.20)。
// condensate-parent 新增穿点 (w_st_north, 5.4, 5.55) 进钉值表。
// 条目数 45→46（master 一换一 + parent 新增 1 条），孔位计数不受影响（新主卧孔与 strong-ac-master 等
// 共用 w_strip_east@4.2,4.6 去重后同一孔）。
// 2026-11-26/27 量房回填 PR #270：46→69。系统性位移：w_strip_east x 4.20→4.16（7 钉）、
// w_st_north z 5.55→5.455（6 钉）、w_nw_south z 4.30→3.75、w_gbath_south z 3.55→3.64、
// w_balc_east/w_vrv_east/w_gbath_east/w_gbath_west/w_mbath_east x 7.2/5.6/2.6→7.5/5.69/2.9、
// w_mbath_south z 2.86→2.655（主卫水路不再穿该墙，旧钉随声明删除）、热水 v1 z 2.76→2.555。
// 新增 32 条：客卫南墙/阳台南墙/客卫东墙穿墙声明（w_gbath_south/w_balc_south/w_gbath_east
// 沿线 10 条东西向路由新穿墙，共 22 条）+ strong-power-child@w_strip_east、
// strong-power-waterbar@w_gbath_east_open_vanity、supply-air-child@w_nw_south/@w_strip_east、
// water-balcony@w_vrv_east、water-v1-recirc-loop@w_balc_west/@w_mbath_east/@w_vrv_east、
// weak-master@w_mb_east、strong-light-child@w_nw_south（后者原在 KEPT_16，本轮 at 删除后可派生）。
// strong-power-living@w_be_west/@w_liv_east_s 两条新声明带手写 at，见 KEPT_16，不进本表。
// 删 9 条：strong-ded-bathheaters-mbath@w_mbath_south、water-master-bath@w_mbath_south、
// drain-mbath-vanity-to-riser@w_mbath_south、water-hot-water-mbath-requirement@w_mbath_south
// （主卫水路重画不再穿该墙）、water-balcony@w_balc_east（改穿 w_vrv_east）、
// refrigerant-trunk@w_vrv_east（改穿 w_balc_south + w_gbath_south）、
// condensate-study@w_be_west（→ KEPT_16，两交点）、refrigerant-child@w_nw_south、
// condensate-child@w_gbath_west_open_vanity（后两条为孤儿声明，不可派生，未进本表）。
// 浮点字面量为派生值的精确 double（如 1.3600000000000003、2.5549999999999997、
// 6.676176470588235），不得四舍五入改写——断言允差 1e-9，但墓碑须与派生值逐位一致。
const PIN_69: Array<[string, string, number, number]> = [
  ['strong-ac-master', 'w_strip_east', 4.16, 4.6],
  ['strong-ac-parent', 'w_st_north', 5.5, 5.455],
  ['strong-ac-child', 'w_nw_south', 4.35, 3.75],
  ['strong-ac-outdoor', 'w_gbath_south', 7.45, 3.64],
  ['strong-ac-outdoor', 'w_balc_south', 7.45, 1.3600000000000003],
  ['strong-light-dining', 'w_gbath_south', 7.45, 3.64],
  ['strong-light-dining', 'w_gbath_east', 7.5, 2.7],
  ['strong-light-entry-base', 'w_ent_south_w', 11.3, 3],
  ['strong-light-entry-base', 'w_cent_north', 12.77, 2.94],
  ['strong-light-entry-base', 'w_blk_south', 11.3, 3.25],
  ['strong-light-entry-base', 'w_blk_east_north', 11.8, 2.94],
  ['strong-light-master', 'w_strip_east', 4.16, 4.6],
  ['strong-light-parent', 'w_st_north', 5.5, 5.455],
  ['strong-light-child', 'w_nw_south', 4.1, 3.75],
  ['strong-light-kitchen', 'w_gbath_south', 7.45, 3.64],
  ['strong-light-kitchen', 'w_gbath_east', 7.5, 3],
  ['strong-ded-dishwasher', 'w_gbath_south', 7.45, 3.64],
  ['strong-ded-dishwasher', 'w_gbath_east', 7.5, 3],
  ['strong-ded-washer-dryer', 'w_balc_east', 7.5, 2.15],
  ['strong-ded-washer-dryer', 'w_balc_south', 5.7, 1.3600000000000003],
  ['strong-ded-washer-dryer', 'w_gbath_south', 7.45, 3.64],
  ['strong-ded-washer-dryer', 'w_gbath_east', 7.5, 3],
  ['strong-ded-bathheaters-mbath', 'w_strip_east', 4.16, 4.6],
  ['strong-ded-bathheaters-gbath', 'w_gbath_south', 6.7, 3.64],
  ['strong-power-master', 'w_strip_east', 4.16, 4.6],
  ['strong-power-parent', 'w_st_north', 5.5, 5.455],
  ['strong-power-child', 'w_strip_east', 4.16, 4],
  ['strong-power-study', 'w_st_north', 5.5, 5.455],
  ['strong-power-kitchen', 'w_gbath_south', 7.45, 3.64],
  ['strong-power-kitchen', 'w_gbath_east', 7.5, 3],
  ['strong-power-gbath', 'w_gbath_south', 6.7, 3.64],
  ['strong-power-mbath-service', 'w_strip_east', 4.16, 4.6],
  ['strong-power-garden', 'w_ent_south_w', 11.2, 3],
  ['strong-power-garden', 'w_blk_south', 11.2, 3.25],
  ['strong-power-garden', 'w_blk_north', 11.2, 2.72],
  ['weak-master', 'w_mb_east', 4.16, 6.3],
  ['weak-parent', 'w_st_north', 5.5, 5.455],
  ['water-balcony', 'w_vrv_east', 7.5, 1.02],
  ['drain-kitchen-requirement', 'w_vrv_east', 7.5, 0.5],
  ['water-garden-requirement', 'w_ent_west', 11.11, 1.42],
  ['water-v1-heater-to-mbath-hot', 'w_gbath_east', 7.5, 2.5549999999999997],
  ['water-v1-heater-to-mbath-hot', 'w_gbath_west', 5.69, 2.5549999999999997],
  ['water-v1-heater-to-mbath-hot', 'w_mbath_east', 2.8999999999999995, 2.5549999999999997],
  ['water-v1-entry-to-mbath-cold', 'w_gbath_east', 7.5, 2.61],
  ['water-v1-entry-to-mbath-cold', 'w_gbath_west', 5.69, 2.61],
  ['water-v1-entry-to-mbath-cold', 'w_mbath_east', 2.8999999999999995, 2.61],
  ['water-v1-recirc-loop', 'w_mbath_east', 2.9, 1],
  ['water-v1-recirc-loop', 'w_balc_west', 5.6899999999999995, 1],
  ['water-v1-recirc-loop', 'w_vrv_east', 7.5, 1],
  ['refrigerant-trunk', 'w_balc_south', 7.45, 1.3600000000000003],
  ['refrigerant-trunk', 'w_gbath_south', 7.45, 3.64],
  ['refrigerant-master', 'w_strip_east', 4.16, 4.6],
  ['refrigerant-parent', 'w_st_north', 5.5, 5.455],
  ['condensate-master', 'w_strip_east', 4.16, 4.6],
  ['condensate-parent', 'w_st_north', 5.4, 5.455],
  ['supply-air-child', 'w_nw_south', 3.7, 3.75],
  ['supply-air-child', 'w_strip_east', 4.16, 4],
  ['strong-power-parent-child-study-curtain', 'w_st_north', 5.5, 5.455],
  ['strong-power-parent-child-guest-north', 'w_be_west', 13.37, 5.9],
  ['strong-ded-fridge-living', 'w_gbath_south', 7.45, 3.64],
  ['strong-ded-fridge-living', 'w_gbath_east', 7.5, 3.3],
  ['strong-power-waterbar', 'w_gbath_east_open_vanity', 7.5, 3.99],
  ['strong-power-kitchen-east', 'w_gbath_south', 7.45, 3.64],
  ['strong-power-kitchen-east', 'w_gbath_east', 7.5, 3],
  ['weak-ap-master', 'w_strip_east', 4.16, 4.48],
  ['strong-light-balcony', 'w_balc_east', 7.5, 2.17],
  ['strong-light-balcony', 'w_gbath_south', 7.45, 3.64],
  ['strong-light-balcony', 'w_gbath_east', 7.5, 3.3],
  ['strong-light-balcony', 'w_balc_south', 6.676176470588235, 1.3600000000000003],
];

/** 保留手写的 16 条。构成（2026-11-27 量房回填后实测 crossing form）：
 * 6 共线 C（collinear_run）：strong-ac-study、strong-light-study、refrigerant-study、
 *   strong-power-parent-child-childbed、strong-power-parent-child-guest-bed-r、
 *   strong-power-parent-child-guest-west；
 * 5 严格 strict：strong-light-child@w_strip_east、strong-power-mbath-service@w_mbath_south、
 *   weak-master@w_strip_east、drain-garden-requirement@w_ent_west、condensate-study@w_be_west；
 * 5 意图点 E（form none，未触墙）：strong-power-living ×2、water-kitchen-requirement、
 *   water-water-heater-inlet-requirement、water-entry-valve-requirement。D 类已空。
 * 出：strong-light-child@w_nw_south（→ PIN_69，at 已删、可派生）、
 *   water-hot-water-gbath-requirement@w_gbath_south、water-guest-bath@w_gbath_south、
 *   drain-gbath-vanity-to-riser@w_gbath_south（后三条声明已删除）。
 * 入：condensate-study@w_be_west（form strict、两交点，必须保留手写）、
 *   strong-power-living@w_be_west/@w_liv_east_s（form none，C 类共线贴墙意图点）、
 *   strong-power-mbath-service@w_mbath_south（form strict，B 类偏差 0.06：at (2.86,2.655)
 *   为插座轴线 x=2.86 处开孔，派生 (2.80,2.655)）。
 * 注意：strong-light-child@w_strip_east 的 at (4.2,4.6) 随墙 w_strip_east 4.20→4.16 已滞后
 *   0.04m（派生 (4.16,4.6)），lint 容忍（mismatch=0）——属配置侧 at 未随墙重打，见偏差表下注。 */
const KEPT_16: Array<[string, string]> = [
  ['strong-light-child', 'w_strip_east'],
  ['weak-master', 'w_strip_east'],
  ['strong-ac-study', 'w_be_west'],
  ['strong-light-study', 'w_be_west'],
  ['refrigerant-study', 'w_be_west'],
  ['strong-power-parent-child-childbed', 'w_nw_south'],
  ['strong-power-parent-child-guest-bed-r', 'w_be_west'],
  ['strong-power-parent-child-guest-west', 'w_be_west'],
  ['water-kitchen-requirement', 'w_vrv_east'],
  ['drain-garden-requirement', 'w_ent_west'],
  ['water-water-heater-inlet-requirement', 'w_vrv_east'],
  ['water-entry-valve-requirement', 'w_vrv_east'],
  ['condensate-study', 'w_be_west'],
  ['strong-power-living', 'w_be_west'],
  ['strong-power-living', 'w_liv_east_s'],
  ['strong-power-mbath-service', 'w_mbath_south'],
];

const declarationsOf = (parsed: MepCoordination): Array<{ route: MepRoute; wall: string; entry: Record<string, unknown> }> => {
  const out: Array<{ route: MepRoute; wall: string; entry: Record<string, unknown> }> = [];
  for (const route of parsed.routes) {
    const raw = (route as unknown as { penetration?: unknown }).penetration;
    if (!Array.isArray(raw)) continue;
    for (const entry of raw as Array<Record<string, unknown>>) out.push({ route, wall: String(entry.wall), entry });
  }
  return out;
};

test('69 条被删 at：派生交点逐一等于被删声明值（≤1e-9）', () => {
  const declared = new Set(declarationsOf(config).map((d) => `${d.route.id}@${d.wall}`));
  // 2026-11-14 全带泵重画：声明总数 60→61——condensate-parent 新路由正交穿
  // w_st_north (5.40,5.55)，新增 1 条穿墙声明（旧路由 z=6.0/6.10 全程在墙南、
  // 从未穿该墙）；condensate-master 1 换 1（w_mbath_south→w_strip_east），
  // condensate-child 声明不变（穿点由 (5.6,3.87) 改 (5.6,4.20)）。
  // 2026-11-16 关系化批：声明总数 61→62——strong-light-child 新增 w_strip_east
  // 声明 1 条（gap-2 斜线拆正交：旧对角 (4.35,4.6)→(4.1,4.0) 不穿该墙，新正交腿
  // (4.35,4.6)→(4.1,4.6) 在 (4.2,4.6) 严格穿墙，带手写 at，见 KEPT_16；PIN_46 派生表不变）。
  // 2026-11-26/27 量房回填 PR #270：声明总数 62→87（+34/−9）。新增 34 条：
  //   客卫南墙/阳台南墙/客卫东墙穿墙声明（w_gbath_south/w_balc_south/w_gbath_east 沿线
  //   10 条东西向路由新穿墙，共 22 条：strong-ac-outdoor、strong-ded-dishwasher、
  //   strong-ded-fridge-living、strong-ded-washer-dryer、strong-light-balcony、
  //   strong-light-dining、strong-light-kitchen、strong-power-kitchen、
  //   strong-power-kitchen-east、refrigerant-trunk）+ strong-power-child@w_strip_east、
  //   strong-power-living@w_be_west/@w_liv_east_s、strong-power-mbath-service@w_mbath_south、
  //   strong-power-waterbar@w_gbath_east_open_vanity、supply-air-child@w_nw_south/@w_strip_east、
  //   water-balcony@w_vrv_east、water-v1-recirc-loop@w_balc_west/@w_mbath_east/@w_vrv_east、
  //   weak-master@w_mb_east（12 条）。删除 9 条：drain-gbath-vanity-to-riser@w_gbath_south、
  //   drain-mbath-vanity-to-riser@w_mbath_south、refrigerant-trunk@w_vrv_east、
  //   strong-ded-bathheaters-mbath@w_mbath_south、water-balcony@w_balc_east、
  //   water-guest-bath@w_gbath_south、water-hot-water-gbath-requirement@w_gbath_south、
  //   water-hot-water-mbath-requirement@w_mbath_south、water-master-bath@w_mbath_south。
  //   另有 2 条孤儿声明仍计入 87（refrigerant-child@w_nw_south、
  //   condensate-child@w_gbath_west_open_vanity），但不可派生、未进 PIN_69——
  //   69 = 87 − 16 条保留手写 at − 2 条孤儿声明，见计数契约测试注。
  assert.equal(declarationsOf(config).length, 87, '穿墙声明总数应为 87（62 + 34 − 9）');
  for (const [routeId, wallId, x, z] of PIN_69) {
    const route = config.routes.find((item) => item.id === routeId);
    assert.ok(route, `route ${routeId} 存在`);
    assert.ok(!declarationsOf(config).some((d) => d.route.id === routeId && d.wall === wallId && d.entry.at !== undefined),
      `${routeId}@${wallId} 的 at 应已删除`);
    const wall = wallsById.get(wallId);
    assert.ok(wall, `wall ${wallId} 存在`);
    const derived = deriveMepPenetrationPoint(routePoints(route), wall);
    assert.ok('point' in derived, `${routeId}@${wallId} 应可派生唯一交点`);
    assert.ok(Math.hypot(derived.point.x - x, derived.point.z - z) <= 1e-9,
      `${routeId}@${wallId}: 派生 (${derived.point.x},${derived.point.z}) vs 被删声明 (${x},${z})`);
  }
});

test('16 条保留手写：at 原样在场，height/note 未动', () => {
  const flat = declarationsOf(config);
  for (const [routeId, wallId] of KEPT_16) {
    const found = flat.find((d) => d.route.id === routeId && d.wall === wallId);
    assert.ok(found, `${routeId}@${wallId} 声明在场`);
    assert.ok(found.entry.at !== undefined, `${routeId}@${wallId} 的 at 保留手写`);
    assert.ok(found.entry.height !== undefined, `${routeId}@${wallId} 的 height 在场`);
    assert.ok(typeof found.entry.note === 'string' && found.entry.note.length > 0, `${routeId}@${wallId} 的 note 在场`);
  }
  // 2 条 B 类偏差（量房依赖）本期不修路线，声明必须原样保留。
  // 断言口径：派生值 ≠ 声明值（>5mm，这正是它们不能删 at 的原因）且 ≤0.25m（AGENTS 铁律内，
  // lint mismatch 不触发）。
  // weak-master@w_strip_east：2026-11-27 量房回填后派生 (4.16,4.55) vs at (4.2,4.6)，
  //   偏差 0.064（旧值 0.05：墙 w_strip_east 4.20→4.16 且弱电主干在该墙段的
  //   穿点由 (4.2,4.6) 移至 (4.16,4.55)）；at 的 x=4.2 同 strong-light-child@w_strip_east
  //   一样随墙滞后 0.04m，属配置侧 at 未随墙重打，lint 容忍（mismatch=0）。
  // strong-power-mbath-service@w_mbath_south：2026-11-27 干湿分离放弃重画后新增声明，
  //   派生 (2.80,2.655) vs at (2.86,2.655)，偏差 0.06——穿孔打在插座轴线 x=2.86 处，
  //   不是路线交点，见 KEPT_16 头注。
  // 已删：strong-light-child@w_nw_south（0.125，at 已删→ PIN_69）、
  //   water-hot-water-gbath-requirement@w_gbath_south（0.0658，声明已删除）。
  const deviation = { 'weak-master@w_strip_east': 0.064, 'strong-power-mbath-service@w_mbath_south': 0.06 };
  for (const [key, expected] of Object.entries(deviation)) {
    const [routeId, wallId] = key.split('@');
    const route = config.routes.find((item) => item.id === routeId)!;
    const wall = wallsById.get(wallId)!;
    const declaredAt = declarationsOf(config).find((d) => d.route.id === routeId && d.wall === wallId)!.entry.at as { x: number; z: number };
    const derived = deriveMepPenetrationPoint(routePoints(route), wall);
    assert.ok('point' in derived);
    const drift = Math.hypot(derived.point.x - declaredAt.x, derived.point.z - declaredAt.z);
    assert.ok(drift > 0.005 && drift <= 0.25,
      `${key} 派生偏差应落在 (0.005, 0.25]（声明约 ${expected}m，实 ${drift}）——路线未修的既定事实，at 不可删`);
  }
});

test('takeoff 孔数 = 71（派生口径），与旧数组长度口径一致', () => {
  const rules = load<MepTakeoffRules>('config/mep-takeoff.yaml');
  const topology = load<{ circuits: never[]; controls?: never[] }>(rules.sources.circuits);
  const takeoffInput = {
    electrical: electrical as never,
    plumbing: plumbing as never,
    circuits: topology.circuits,
    controls: topology.controls ?? [],
    routes: config.routes,
    resolution,
    rules,
  };
  const withWalls = computeMepTakeoff({ ...takeoffInput, penetrationWalls: catalog.getWalls() });
  const legacy = computeMepTakeoff(takeoffInput);
  // 2026-11-16 关系化批：46→47——strong-light-child 新增 w_strip_east 声明 1 条
  // （(4.2,4.6)，height 2.55，派生严格交点与声明 at 相等），该孔计入 takeoff。
  // 2026-11-26/27 量房回填 PR #270：47→71（+24）。takeoff 只计 covered 层
  // （strong/weak/water/drainage）physical 路由上的声明：新增计入 +30（新增 34 条声明中
  //   supply-air-child ×2、refrigerant-trunk ×2 层不在 covered 内，不计）− 删除计入 −6
  //   （删除 9 条中 refrigerant-trunk@w_vrv_east 层不在 covered 内、
  //   water-hot-water-gbath-requirement 与 water-hot-water-mbath-requirement 为 candidate
  //   路由，均不计；其余 6 条 drain-gbath-vanity、drain-mbath-vanity、
  //   strong-ded-bathheaters-mbath、water-balcony、water-guest-bath、water-master-bath 均计入）。
  //   另：strong-ac-child 的 1 条声明因 sock_child_ac 双 pending（deferred）被 takeoff
  //   整路跳过，不计；2 条孤儿声明（refrigerant-child、condensate-child）所在路由层不在
  //   covered 内 / 为 candidate，均不到计数行，故 deriveErrors 仍为空。
  assert.equal(withWalls.devices.penetrations, 71, '派生口径孔数（喂 mep-quotes extra_penetration 元/孔）');
  assert.equal(legacy.devices.penetrations, 71, '旧口径（未传墙几何的手搭输入路径）同值');
  const deriveErrors = withWalls.unresolved.filter((item) => item.reason.includes('穿墙声明'));
  assert.deepEqual(deriveErrors, [], '派生口径下不允许出现不可定位的穿墙声明');
});

test('countRoutePenetrations fail-closed：不可派生且无手写 at → unresolved 且不计孔', () => {
  const unresolved: Array<{ id: string; reason: string; kind?: 'error' | 'pending' }> = [];
  const wall = { id: 'w_x', x1: 0, z1: 5, x2: 10, z2: 5 };
  const walls = new Map([['w_x', wall]]);
  // 唯一 strict 交点、无 at → 计孔
  const crossingPoints = [{ x: 1, z: 4 }, { x: 1, z: 6 }];
  const crossing = { id: 'r1', penetration: [{ wall: 'w_x', height: 2.55 }] } as unknown as MepRoute;
  assert.equal(countRoutePenetrations(crossing, crossingPoints, walls, unresolved), 1);
  assert.equal(unresolved.length, 0);
  // 贴墙段穿越（无唯一交点）且无 at → 不计孔 + error
  const huggingPoints = [{ x: 1, z: 4 }, { x: 1, z: 5 }, { x: 9, z: 5 }, { x: 9, z: 6 }];
  const hugging = { id: 'r2', penetration: [{ wall: 'w_x', height: 2.55 }] } as unknown as MepRoute;
  assert.equal(countRoutePenetrations(hugging, huggingPoints, walls, unresolved), 0);
  assert.equal(unresolved.length, 1);
  assert.match(unresolved[0]!.reason, /fail-closed/);
  // 同形路线但保留手写 at → 计孔、无 error
  unresolved.length = 0;
  const huggingDeclared = { ...hugging, penetration: [{ wall: 'w_x', at: { x: 9, z: 5 }, height: 2.55 }] } as unknown as MepRoute;
  assert.equal(countRoutePenetrations(huggingDeclared, huggingPoints, walls, unresolved), 1);
  assert.equal(unresolved.length, 0);
  // 墙不在几何里 → error 不计孔
  unresolved.length = 0;
  const unknownWall = { ...crossing, penetration: [{ wall: 'w_missing', height: 2.55 }] } as unknown as MepRoute;
  assert.equal(countRoutePenetrations(unknownWall, crossingPoints, walls, unresolved), 0);
  assert.equal(unresolved.length, 1);
});

test('lint 可见性：删任一 C 类（共线穿越）声明 → penetration_missing 显形', () => {
  const context = lintContext();
  // 2026-11-27 量房回填后 C 类剩 6 条；water-guest-bath@w_gbath_south 声明已删除
  // （客卫给水重画不再穿该墙，路线亦不穿越——删声明演练不再适用，移除本条）。
  const cClass: Array<[string, string]> = [
    ['strong-ac-study', 'w_be_west'],
    ['strong-light-study', 'w_be_west'],
    ['refrigerant-study', 'w_be_west'],
    ['strong-power-parent-child-childbed', 'w_nw_south'],
    ['strong-power-parent-child-guest-bed-r', 'w_be_west'],
    ['strong-power-parent-child-guest-west', 'w_be_west'],
  ];
  for (const [routeId, wallId] of cClass) {
    const mutated = structuredClone(config) as MepCoordination;
    const route = mutated.routes.find((item) => item.id === routeId)!;
    const raw = (route as unknown as { penetration?: unknown[] }).penetration!;
    (route as unknown as { penetration: unknown[] }).penetration = raw.filter((entry) => (entry as { wall?: string }).wall !== wallId);
    const result = lintMepCoordination(mutated, sources, context);
    const all = [...result.errors, ...result.warnings];
    const missing = all.filter((issue) => issue.code === 'penetration_missing' && issue.routeId === routeId);
    assert.ok(missing.length >= 1, `删 ${routeId}@${wallId} 声明后 penetration_missing 应显形（D 轨演练 B3 原为 0 告警）`);
    assert.ok(missing.some((issue) => issue.message.includes(wallId)));
  }
});

test('lint 可见性：C 类手写 at 漂移 → penetration_point_mismatch（锚定校验）', () => {
  const context = lintContext();
  // C 类：贴墙段 run 端点 (13.37,5.9)，手写 at 改到 (13.6,5.9) → 漂移 0.23m
  const mutatedC = structuredClone(config) as MepCoordination;
  const routeC = mutatedC.routes.find((item) => item.id === 'strong-ac-study')!;
  const entryC = ((routeC as unknown as { penetration: Array<Record<string, unknown>> }).penetration)[0]!;
  entryC.at = { x: 13.6, z: 5.9 };
  const resultC = lintMepCoordination(mutatedC, sources, context);
  assert.ok([...resultC.errors, ...resultC.warnings].some((issue) => issue.code === 'penetration_point_mismatch' && issue.routeId === 'strong-ac-study'),
    'C 类 at 偏离贴墙段端点应显形（D 轨 §4.3-1：改两处都不对的风险原为零感知）');
  // D 类已空：唯一的 D 类成员 drain-gbath-vanity-to-riser@w_gbath_south 声明已随
  // 2026-11-27 量房回填删除（客卫给水重画，路线不再穿该墙），本测试不再设 D 半——
  // 不虚构合成 D 例，D 形锚定校验随成员回归而恢复。
});

test('lint 可见性：E 类（未触墙意图点）at 丢失 → orphaned/… 显形', () => {
  const context = lintContext();
  const mutated = structuredClone(config) as MepCoordination;
  const route = mutated.routes.find((item) => item.id === 'water-kitchen-requirement')!;
  const entry = ((route as unknown as { penetration: Array<Record<string, unknown>> }).penetration)[0]!;
  delete entry.at;
  const result = lintMepCoordination(mutated, sources, context);
  const all = [...result.errors, ...result.warnings];
  assert.ok(all.some((issue) => issue.routeId === 'water-kitchen-requirement' && (issue.code === 'penetration_declaration_orphaned' || issue.code === 'penetration_declaration_incomplete')),
    'E 类意图点失去 at 后应显形（设计意图不可派生，删除即丢语义）');
});

test('lint 可见性（验伪轮）：E 类 at 漂移 0.10m 不再静默——正交脱钩/离墙线即 mismatch', () => {
  const context = lintContext();
  // 验伪变异③复演：water-kitchen-requirement at (7.5,0.45)→(7.5,0.55)——仍在 0.25m 邻近豁免
  // 圈内（距折线 0.1803m），但与最近点 (7.65,0.45) 变成斜对角（Δx=0.15、Δz=0.10）→ 必须红。
  const mutatedDiagonal = structuredClone(config) as MepCoordination;
  const routeDiagonal = mutatedDiagonal.routes.find((item) => item.id === 'water-kitchen-requirement')!;
  ((routeDiagonal as unknown as { penetration: Array<Record<string, unknown>> }).penetration)[0]!.at = { x: 7.5, z: 0.55 };
  const resultDiagonal = lintMepCoordination(mutatedDiagonal, sources, context);
  const diagonalIssues = [...resultDiagonal.errors, ...resultDiagonal.warnings]
    .filter((issue) => issue.code === 'penetration_point_mismatch' && issue.routeId === 'water-kitchen-requirement');
  assert.ok(diagonalIssues.length >= 1, 'E 类 at 斜对角漂移（正交脱钩）必须显形——原 0.25m 邻近豁免圈内静默的洞');
  assert.ok(diagonalIssues.some((issue) => issue.message.includes('orthogonally')), '诊断应点名正交对齐约束');
  // 漂离墙线方向：at x+0.10 → (7.6,0.45)，距墙线 x=7.5 垂距 0.10m → 必须红。
  const mutatedOffWall = structuredClone(config) as MepCoordination;
  const routeOffWall = mutatedOffWall.routes.find((item) => item.id === 'water-kitchen-requirement')!;
  ((routeOffWall as unknown as { penetration: Array<Record<string, unknown>> }).penetration)[0]!.at = { x: 7.6, z: 0.45 };
  const resultOffWall = lintMepCoordination(mutatedOffWall, sources, context);
  const offWallIssues = [...resultOffWall.errors, ...resultOffWall.warnings]
    .filter((issue) => issue.code === 'penetration_point_mismatch' && issue.routeId === 'water-kitchen-requirement');
  assert.ok(offWallIssues.some((issue) => issue.message.includes('off the wall line')), 'E 类 at 漂离墙线必须显形');
  // 真实 5 条 E 类锚定量全 0（垂距=0、正交对齐）——真实配置不新增告警由
  // 「真实配置 lint penetration_* 计数」测试的 mismatch=0 钉住。
});

test('lint 可见性（验伪轮）：E 类沿墙正交滑动不误伤（设计自由度论证）', () => {
  // at 沿墙线滑到与路线平行段保持正交对齐的位置（water-entry-valve 的 x=7.65 竖直段跟随，
  // 路线折线 (9.5,0.3)→(7.65,0.3)→(7.65,0.45)，at 由 (7.5,0.3) 沿墙 x=7.5 滑到 (7.5,0.4)）：
  // 这是「孔位沿墙最终位置待量房定」的设计自由度（D 轨 §6.1-E：不可派生），没有第二事实
  // 可对照——锚定只钉「离墙线」「斜对角」两个可验证方向，不为滑动方向发明锚。
  // 该方向的出圈兜底是既有 0.25m 邻近豁免（>0.25m → orphaned，验伪员变异③b 实测红）。
  const context = lintContext();
  const mutated = structuredClone(config) as MepCoordination;
  const route = mutated.routes.find((item) => item.id === 'water-entry-valve-requirement')!;
  ((route as unknown as { penetration: Array<Record<string, unknown>> }).penetration)[0]!.at = { x: 7.5, z: 0.4 };
  const result = lintMepCoordination(mutated, sources, context);
  const mismatch = [...result.errors, ...result.warnings]
    .filter((issue) => issue.code === 'penetration_point_mismatch' && issue.routeId === 'water-entry-valve-requirement');
  assert.deepEqual(mismatch, [], '保持压墙线+正交对齐的沿墙滑动不误伤（量房自由度）');
});

test('真实配置 lint：penetration_* 计数与 2026-11-16 关系化批后一致', () => {
  const result = lintMepCoordination(config, sources, lintContext());
  const all = [...result.errors, ...result.warnings];
  const count = (code: string): number => all.filter((issue) => issue.code === code).length;
  // 2026-11-14 全带泵重画（issue #98 MEP batch 1）：penetration_door_clearance
  // 16→17、shear_wall_penetration 11→12——均来自 condensate-master 新穿点
  // w_strip_east (4.20,4.60)：距门洞 d_mb 仅 0.05m（过门头穿梁），墙体剪力墙
  // inferred；其余 penetration_* 计数不变（parent 新增的 w_st_north 穿点
  // (5.40,5.55) 在门洞 d_study 西侧、无剪力墙声明，不进这两项）。
  // 2026-11-16 关系化批：penetration_door_clearance 17→18、shear_wall_penetration
  // 12→13——均来自 strong-light-child 新增的同一穿点 w_strip_east (4.20,4.60)
  // 声明（实测 lint：door_clearance 新增 strong-light-child 1 条，shear 新增
  // strong-light-child 1 条；其余 penetration_* 计数不变）。
  // 2026-11-23 通长假梁改道：strong-ded-bathheaters-mbath 穿 w_mbath_south
  // 由 x=2.0（门洞 d_mbath 内）改到 x=2.43（门洞以东实体垛），该条
  // penetration_door_clearance 消失，实算 18→17。lint 上限仍是 18，这里只改
  // 实算快照。shear_wall_penetration 仍是 13。
  // 2026-11-26/27 量房回填 PR #270：door_clearance 17→11、shear 13→17（均与 master 实跑对账）。
  // door −6 = 东南卧门洞 d_bese 南移（z 5.65–6.55 → 4.43–5.31）后旧穿点带
  //   (13.40,5.90/6.29) 脱离门洞 0.15m 圈（strong-ac-study、strong-light-study、
  //   refrigerant-study、condensate-study、strong-power-parent-child-guest-bed-r/
  //   guest-west/guest-north 共 7 条消失）+ 厨房阳台门 d_kit_balc 作废
  //   （strong-ded-washer-dryer 1 条消失）+ weak-ap-master 穿点 (4.16,4.48) 距
  //   d_mb 仅 0.07m 新入圈（+1）；新 d_bese 圈内剩 strong-power-living 1 条
  //   （(13.37,5.46)，0.14m）。shear +4：新增声明落在剪力墙上
  //   （strong-power-child@w_strip_east、weak-master@w_mb_east、
  //   water-v1-recirc-loop@w_mbath_east、supply-air-child@w_strip_east），旧 13 条全留。
  // orphaned/missing 仍钉 0：实算 orphaned 2（refrigerant-child@w_nw_south、
  //   condensate-child@w_gbath_west_open_vanity，量房回填后路线移出墙段、声明未删）
  //   与 missing 18（新墙 w_gbath_south_entry 上 18 条穿越路由缺穿透声明）均为
  //   模型缺口——配置侧待补声明，本测试不放行、不改值，见本轮报告。
  assert.equal(count('penetration_door_clearance'), 11);
  assert.equal(count('penetration_wall_unknown'), 0);
  assert.equal(count('penetration_declaration_orphaned'), 0);
  assert.equal(count('penetration_declaration_incomplete'), 0);
  assert.equal(count('penetration_missing'), 0);
  assert.equal(count('penetration_point_mismatch'), 0);
  assert.equal(count('shear_wall_penetration'), 17);
});

test('冷凝链锚点 deriveMepPenetrationAt：新穿点 (4.16,4.60) 可派生，旧墙正确诊断，fail-closed 三态', () => {
  // 2026-11-14 全带泵重画：condensate-master 不再穿 w_mbath_south，改穿
  // w_strip_east (4.20,4.60)（与 strong-ac-master 等共用一孔）。旧 pin
  // (2.3, 2.86) 随旧路由作废——本测试改钉新穿点，并断言旧墙改报「无严格交点」
  // 诊断（链已退役，旧墙不再是该路由的穿墙点），不是静默给错点。
  // 2026-11-27 量房回填：w_strip_east x 4.20→4.16，穿点 (4.20,4.60)→(4.16,4.60)。
  const derived = deriveMepPenetrationAt(
    config.routes.find((route) => route.id === 'condensate-master'),
    'w_strip_east',
    { sources, walls: layout.walls },
  );
  assert.equal(derived.diagnostic, undefined);
  assert.ok(derived.point);
  assert.ok(Math.hypot(derived.point!.x - 4.16, derived.point!.z - 4.6) <= 1e-9,
    `派生锚点 (${derived.point!.x},${derived.point!.z}) 应等于新穿点 (4.16, 4.6)`);
  assert.ok(deriveMepPenetrationAt(
    config.routes.find((route) => route.id === 'condensate-master'),
    'w_mbath_south',
    { sources, walls: layout.walls },
  ).diagnostic, '新路由不穿 w_mbath_south 时必须给诊断、不发明穿点');
  // fail-closed：路线缺失 / 墙缺失
  assert.ok(deriveMepPenetrationAt(undefined, 'w_mbath_south', { sources, walls: layout.walls }).diagnostic);
  assert.ok(deriveMepPenetrationAt(config.routes.find((route) => route.id === 'condensate-master'), 'w_missing', { sources, walls: layout.walls }).diagnostic);
  // C 形路线无唯一交点 → 诊断不给点
  const hugForm = resolveMepWallCrossingForm(
    [{ x: 1, z: 4 }, { x: 1, z: 5 }, { x: 9, z: 5 }, { x: 9, z: 6 }],
    { id: 'w_x', x1: 0, z1: 5, x2: 10, z2: 5 },
  );
  assert.equal(hugForm.form, 'collinear_run');
  const hugDerived = deriveMepPenetrationPoint([{ x: 1, z: 4 }, { x: 1, z: 5 }, { x: 9, z: 5 }, { x: 9, z: 6 }], { id: 'w_x', x1: 0, z1: 5, x2: 10, z2: 5 });
  assert.ok(!('point' in hugDerived) && typeof hugDerived.diagnostic === 'string', 'C 形无唯一交点必须 fail-closed 给诊断');
});

test('穿墙计数契约：87 条声明 / 48 个孔位（手写 at 或派生点去重），与施工指导文档清点句同值', () => {
  // config/facts.yaml 的 fact.mep_penetration_declarations 只锚定文档清点句的文本（facts-lint 的
  // derived 选择器表达不了「跨路线嵌套数组求和 + 去重」）；本断言从配置机器计算两数并要求文档
  // 同值——guidance:37 的「40 条 / 21 孔位」正是这样 stale 的。孔位 = 同墙同坐标去重（多条路线共用一孔）。
  // **覆盖边界（评审员变异实测，勿过度声称）**：本测试只钉「孔位计数 + 声明条目数」两个数。
  // ① 孔位**坐标移动**（路线改道但孔数不变）它抓不到——由同文件 PIN_69 逐点钉值测试负责；
  // ② 文档里另一处历史旧值句它抓不到（只查规范句，verify:facts 的 mirror 同口径）；
  // ③ 有手写 at 的声明改指向不存在的墙它抓不到（孔 key 照算），由 KEPT_16 + takeoff + lint 抓。
  // 三条边界都有既有守卫兜底，但不要以为这一条是全能的。
  const declarations = declarationsOf(config);
  const holes = new Set<string>();
  for (const { route, wall, entry } of declarations) {
    const at = entry.at as { x?: unknown; z?: unknown } | undefined;
    let point: { x: number; z: number };
    if (at && typeof at.x === 'number' && typeof at.z === 'number') {
      point = { x: at.x, z: at.z };
    } else {
      const wallGeometry = wallsById.get(wall);
      assert.ok(wallGeometry, `wall ${wall} 存在`);
      const derived = deriveMepPenetrationPoint(routePoints(route), wallGeometry);
      assert.ok('point' in derived, `${route.id}@${wall} 无手写 at 时必须可派生唯一交点`);
      point = derived.point;
    }
    holes.add(`${wall}@${point.x.toFixed(3)},${point.z.toFixed(3)}`);
  }
  // 2026-11-14 全带泵重画：声明 60→61（parent 新增 w_st_north 1 条），孔位
  // 仍 33——旧主卧孔 w_mbath_south@2.300,2.860 随旧路由消失（−1），新 parent
  // 孔 w_st_north@5.400,5.550 补入（+1），新主卧孔与 strong-ac-master 等共用
  // w_strip_east@4.200,4.600（+0），儿童房孔 (5.6,3.87)→(5.6,4.20) 平移（+0）。
  // 2026-11-16 关系化批：声明 61→62（strong-light-child 新增 w_strip_east 1 条），
  // 孔位仍 33——新声明点 (4.2,4.6) 与既有孔 w_strip_east@4.200,4.600 去重同孔（+0）。
  // 2026-11-17 量价算法审计跟进 blocking 2：冷热立管错开 150mm，冷腿 z=2.76→2.61
  // 后三处穿墙点与热腿分孔（w_gbath_east/w_gbath_west/w_mbath_east 各 +1），孔位 33→36；声明仍 62。
  // 2026-11-26/27 量房回填 PR #270：声明 62→87（+34/−9，见 PIN_69 测试头注），
  // 孔位 36→48（+12，机器对账：新增键 44 − 消失键 32）。其中 genuinely 新孔 +17：
  //   w_balc_south@5.700/@6.676/@7.450,1.360、w_balc_west@5.690,1.000、
  //   w_be_west@13.370,5.455、w_gbath_east@7.500,2.700/3.000/3.300、
  //   w_gbath_east_open_vanity@7.500,3.990、w_gbath_south@7.450,3.640、
  //   w_liv_east_s@13.370,9.650、w_mb_east@4.160,6.300、w_mbath_east@2.900,1.000、
  //   w_mbath_south@2.860,2.655、w_nw_south@3.700/@4.100,3.750、
  //   w_strip_east@4.160,4.000；genuinely 消失孔 −6：w_gbath_south@6.900/@7.050,3.550
  //   （声明删除）、w_gbath_west_open_vanity@5.600,4.200（孤儿旧 pin）、
  //   w_mbath_south@0.575/@2.430,2.860（声明删除）、w_vrv_east@7.200,0.550
  //   （声明删除）；+1 来自 w_strip_east@4.600 分裂：派生点随墙移至 (4.16,4.6)，
  //   而 strong-light-child/weak-master 的手写 at (4.2,4.6) 未随墙重打、仍占一孔
  //   （属配置侧 at 滞后，见 KEPT_16 头注）。其余键均为量房墙位移动的同孔改号（净 0）。
  // 注意：本断言的文档清点句部分依赖 docs/mep-construction-guidance.md 同步更新
  // （另一路负责；该文档现行句仍为 62 条，更新前本测试的文档句断言会红）。
  // 模型缺口（本测试当前即因此红）：2 条孤儿声明 refrigerant-child@w_nw_south、
  // condensate-child@w_gbath_west_open_vanity 不可派生，循环到它们时即断言失败——
  // 声明数 87 含这两条（它们是声明，只是不产生孔位），孔位 48 不含它们；配置侧须删
  // 声明或修路线后本测试方能通过，勿为通过而改本测试的派生断言。
  assert.equal(declarations.length, 87, '穿墙声明条目数变了：同步施工指导文档清点句与 facts 契约');
  assert.equal(holes.size, 48, '孔位数变了：同步施工指导文档清点句与 facts 契约');
  const guidance = readFileSync('docs/mep-construction-guidance.md', 'utf8');
  assert.ok(guidance.includes(`合计 **${declarations.length} 条声明、落在 ${holes.size} 个不同孔位**`),
    'docs/mep-construction-guidance.md 的穿墙清点句必须与配置机器计数同值');
});
