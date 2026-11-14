import { suppressedWallIds as suppressedWallIdsOf } from '../../shared/suppression.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { endpointSourcesFromFacts, MepCoordinationSchema, parseMepCoordination, resolveMepRoutes } from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination, type MepLintLayoutContext } from '../../shared/mep-hvac-lint.js';
import type { FurnishingsYaml, ProjectRenderFacts, ResolvedLayout, VertexLayoutYaml } from '../../shared/types.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';

const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ProjectRenderFacts['electrical'];
const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as ProjectRenderFacts['plumbing'];
const ceiling = parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'];
const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'];
/** 真实 layout 上下文（与 scripts/verify/mep/verify-mep-lint.ts 同一套输入），用于 (c)(d) 墙相关规则。 */
const realLayout = resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);
const config = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
// 点位宿主墙/家具索引（issue #98 S1/S3）：与 scripts/verify/mep/verify-mep-lint.ts 同一构造。
// S3 起沿墙/挂载点位不再声明绝对 x/z，不传索引则路线端点解析不出。
// 二阶段 S1 起家具宿主索引须走 buildPlacementIndexes 统一解算：anchor 家具无手写 x/z，
// 直读 x/z 的 pointMountHostIndex 会把它静默排除，锚定点位随即断引用。
const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: FurnishingsYaml };
const { mountHosts: realMountHosts } = buildPlacementIndexes({
  geometry: { walls: realLayout.walls },
  furnishings: house.furnishings ?? {},
});
const sources = endpointSourcesFromFacts(
  { electrical, plumbing, ceiling, hvac },
  pointWallIndexFromElements(realLayout.walls),
  realMountHosts,
);
const layers = Object.fromEntries(['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'].map((id) => [id, { label: id, color: '#fff', height: 2 }])) as ProjectRenderFacts extends never ? never : typeof config.layers;

// suppress 改判（2026-11-07 issue #98 第三阶段 S3）：读墙条目自身的 suppressed 属性，
// 唯一权威实现 shared/suppression.ts（原 parseOverlayFiles().suppress 顶层清单已删）。
const suppressedWallIds = suppressedWallIdsOf(realLayout.walls);
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
/**
 * 规则断言取代钉死数值（2026-11-13 断言规则化第一刀）：
 * must_fix 不再钉死总数 / 分码明细——总数随几何变是正常的（#116 删 950 柜 −3、加通顶柜 +2
 * 即一例），钉死数值的代价就是 135→132→127→125→124 一路重钉。改成三条规则：
 * ① 出现的 error 代码必须是已知待决集合的子集（新代码即 fail）；
 * ② 家具相关的实例（碰撞 / 端点被家具遮挡）必须逐条落在已知待决清单里（新实例即 fail）；
 * ③ 其余代码的条数不得超过已知待决上限（只许减少、不许增长；增长须显式登记并写清原因）。
 * 已知待决集合只许显式增删、不得静默扩表；清单是 allowlist——某项消失（家具移走、路由
 * 改道）不使测试变红，复核时顺手清理即可。
 */
const KNOWN_MUST_FIX_CODES: ReadonlySet<string> = new Set([
  'route_overlap',
  'route_not_orthogonal',
  'suppressed_wall_crossing',
  'unsupported_span',
  'mep_endpoint_service_conflict',
  'door_opening_collision',
  'route_endpoint_unusable',
  'floor_band_method_mismatch',
  'route_furniture_collision',
  'endpoint_inaccessible',
]);
// 家具碰撞实例（route ↔ furniture；穿入深度只记 note、不参与断言——柜子一动深度就变）。
const KNOWN_FURNITURE_COLLISIONS: ReadonlyArray<{ routeId: string; furnitureId: string; note: string }> = [
  // PR #226 新柜全高包络引入的两处：改路由另案 / 待改道裁定。
  { routeId: 'condensate-master', furnitureId: 'mb.full_height_cabinet', note: '穿入 1.61m；全带泵改路由时重画' },
  { routeId: 'strong-ded-bathheaters-mbath', furnitureId: 'mb.full_height_cabinet', note: '穿入 1.41m；待改道/开检修槽裁定' },
  { routeId: 'strong-power-living-west-wall', furnitureId: 'ld.wall_cabinet_tall', note: '穿入 1.36m' },
  { routeId: 'strong-power-living-gateway', furnitureId: 'ld.wall_cabinet_tall', note: '穿入 2.35m' },
  { routeId: 'strong-power-living-robot', furnitureId: 'ld.wall_cabinet_tall', note: '穿入 4.42m' },
  { routeId: 'strong-power-child', furnitureId: 'bnw.wardrobe_180', note: '穿入 2.49m' },
  { routeId: 'strong-power-mbath-service', furnitureId: 'mb.washbasin_cabinet', note: '穿入 0.85m' },
  { routeId: 'weak-main-living', furnitureId: 'ld.wall_cabinet_tall', note: '穿入 1.37m' },
  { routeId: 'weak-gateway', furnitureId: 'ld.wall_cabinet_tall', note: '穿入 2.46m' },
];
// 包络桶家具碰撞实例（route ↔ furniture；需求/候选路线在包络近似桶里报 warning，
// 不进 must_fix errors——只读 errors 的旧写法会漏掉它们，见 F1。穿入深度只记 note、
// 不参与断言；两条均为 2026-11-14 实测现值。）
const KNOWN_ENVELOPE_COLLISIONS: ReadonlyArray<{ routeId: string; furnitureId: string; note: string }> = [
  { routeId: 'water-garden-requirement', furnitureId: 'kitchen.cabinet_run_east', note: '穿入约 1.25m；需求路线，包络桶' },
  { routeId: 'condensate-living-dining-trunk', furnitureId: 'gbath.vanity', note: '穿入约 0.89m；需求路线，包络桶' },
];
// 端点被家具遮挡实例（route ↔ point ↔ furniture；与碰撞同源，柜子一动就变）。
const KNOWN_INACCESSIBLE_ENDPOINTS: ReadonlyArray<{ routeId: string; pointId: string; furnitureId: string }> = [
  { routeId: 'strong-power-living-gateway', pointId: 'sock_gateway', furnitureId: 'ld.wall_cabinet_tall' },
  { routeId: 'strong-power-living-robot', pointId: 'sock_gateway', furnitureId: 'ld.wall_cabinet_tall' },
  { routeId: 'strong-power-living-robot', pointId: 'sock_living_robot', furnitureId: 'ld.wall_cabinet_tall' },
  { routeId: 'strong-power-kitchen', pointId: 'sock_kitchen_counter', furnitureId: 'kitchen.dishwasher' },
  { routeId: 'weak-gateway', pointId: 'net_gateway', furnitureId: 'ld.wall_cabinet_tall' },
];
// must_fix 分码上限的公共底座（8 条与路线几何相关的代码；两口径现值相同）。
// 上限只许减少、不许增长；增长须显式登记并写清原因。
const MUST_FIX_ROUTE_CEILINGS: Readonly<Record<string, number>> = {
  route_overlap: 63,
  route_not_orthogonal: 27,
  suppressed_wall_crossing: 7,
  unsupported_span: 8,
  mep_endpoint_service_conflict: 2,
  door_opening_collision: 1,
  route_endpoint_unusable: 1,
  floor_band_method_mismatch: 1,
};
// realContext harness（无家具/飘窗/可达性上下文）的 must_fix 分桶上限：两家具类为 0。
const HARNESS_MUST_FIX_CEILINGS: Readonly<Record<string, number>> = {
  ...MUST_FIX_ROUTE_CEILINGS,
  route_furniture_collision: 0,
  endpoint_inaccessible: 0,
};
// verify:mep 全上下文的 must_fix 上限：两家具类由实例清单长度派生——登记新实例即同步抬上限，不另填数。
const FULL_CONTEXT_MUST_FIX_CEILINGS: Readonly<Record<string, number>> = {
  ...MUST_FIX_ROUTE_CEILINGS,
  route_furniture_collision: KNOWN_FURNITURE_COLLISIONS.length,
  endpoint_inaccessible: KNOWN_INACCESSIBLE_ENDPOINTS.length,
};
// 无 layout 用例的 must_fix 单独立上限（Codex 三审 major）：墙 / 剪力墙 / 依托类检查需要 layout
// 才运行，本口径下这些代码必须为 0。旧写法复用 HARNESS 上限（完整上下文配额：
// suppressed_wall_crossing 7、unsupported_span 8、door_opening_collision 1），墙检查一旦漏进
// 无 layout 口径会静默通过；旧 errors.length == 94 钉死值本会拦下这种漂移，新子集+上限不断言
// 总数，须由这里的 0 上限接住。家具类同 HARNESS 置 0。
const NO_LAYOUT_MUST_FIX_CEILINGS: Readonly<Record<string, number>> = {
  ...MUST_FIX_ROUTE_CEILINGS,
  suppressed_wall_crossing: 0,
  unsupported_span: 0,
  door_opening_collision: 0,
  route_furniture_collision: 0,
  endpoint_inaccessible: 0,
};
function assertMustFixCeilings(codes: ReadonlyArray<{ code: string; count: number }>, ceilings: Readonly<Record<string, number>>, where: string): void {
  for (const { code, count } of codes) {
    const ceiling = ceilings[code];
    assert.ok(ceiling !== undefined, `${where} 出现已知待决集合外的新代码 ${code}：须显式登记并写清原因`);
    assert.ok(count <= ceiling, `${where} 代码 ${code} 由上限 ${ceiling} 增至 ${count}：须显式登记并写清原因`);
  }
}

function furnitureIdOfCollision(issue: { message: string }): string {
  const match = /inside furnishing (\S+);/.exec(issue.message);
  assert.ok(match, `route_furniture_collision 消息格式已变、解析不出家具 id：${issue.message}`);
  return match[1];
}
// 家具碰撞实例身份校验（F1：must_fix errors 与 envelope warnings 共用）。
// ① 每条实际碰撞必须落在已知待决清单里（新实例即 fail）；② 同一实例不得重复出现——
// 子集检查本身拦不住重复：两条重复顶满包络上限 2 时，子集与数量上限同时通过，
// 旧实例消失、新实例出现、总数不变的静默替换就漏网了。
function assertKnownCollisionInstances(
  issues: ReadonlyArray<{ code: string; message: string; routeId?: string }>,
  known: ReadonlyArray<{ routeId: string; furnitureId: string }>,
  where: string,
): void {
  const keys = issues
    .filter((issue) => issue.code === 'route_furniture_collision')
    .map((issue) => `${issue.routeId}↔${furnitureIdOfCollision(issue)}`)
    .sort();
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.equal(duplicates.length, 0, `${where} 出现重复的家具碰撞实例 ${[...new Set(duplicates)].join('、')}：重复不得顶替登记与数量约束`);
  const knownKeys = known.map((entry) => `${entry.routeId}↔${entry.furnitureId}`).sort();
  for (const key of keys) {
    assert.ok(knownKeys.includes(key), `${where} 出现已知待决清单外的新家具碰撞 ${key}：须显式登记并写清原因`);
  }
}
function inaccessibleEndpointOf(issue: { message: string }): { pointId: string; furnitureId: string } {
  const match = /Electrical endpoint (\S+) of (\S+) lies inside furnishing (\S+);/.exec(issue.message);
  assert.ok(match, `endpoint_inaccessible 消息格式已变、解析不出点位/家具：${issue.message}`);
  return { pointId: match[1], furnitureId: match[3] };
}
function assertKnownMustFixCodes(issues: ReadonlyArray<{ code: string }>, where: string): void {
  for (const issue of issues) {
    assert.ok(KNOWN_MUST_FIX_CODES.has(issue.code), `${where} 出现已知待决集合外的新 must_fix 代码 ${issue.code}：须显式登记并写清原因，不得静默扩表`);
  }
}

/**
 * 规则断言取代钉死数值（2026-11-13 断言规则化第二刀，收尾）：
 * 剩余的总数 / 分桶总数 / 分码明细断言全部改成同一套规则——
 * ① 路线 id 必须是已登记集合的子集（新路线即 fail；删路线不 fail）；
 * ② error / warning 代码必须是已知待决集合的子集（新代码即 fail）；
 * ③ 各桶分码条数不得超过上限（现值即上限，只许减少、不许增长；增长须显式登记并写清原因）。
 * 总数断言至此全部取消：总数是各桶之和，桶上限已把守住；消掉一个碰撞、一条警告，
 * 总数下降不再使测试变红（#227 Codex minor 的根因正在于此）。
 * 已知待决集合只许显式增删、不得静默扩表；某项消失（家具移走、路由改道）不使测试变红。
 */
// 路线 id 登记集（137 条，2026-11-13 实测；新增路线须显式登记，删除不使测试变红）。
const KNOWN_ROUTE_IDS: ReadonlySet<string> = new Set([
  'strong-main', 'strong-ac-living', 'strong-ac-dining', 'strong-ac-master',
  'strong-ac-parent', 'strong-ac-child', 'strong-ac-study', 'strong-ac-outdoor',
  'strong-light-dining', 'strong-light-living', 'strong-light-corridor', 'strong-light-entry-base',
  'strong-light-master', 'strong-light-parent', 'strong-light-child', 'strong-light-study',
  'strong-light-kitchen', 'strong-ded-dishwasher', 'strong-ded-washer-dryer', 'strong-ded-bathheaters-mbath',
  'strong-ded-bathheaters-gbath', 'strong-power-living', 'strong-power-living-west-wall', 'strong-power-living-tv-high',
  'strong-power-living-tv-led', 'strong-power-living-gateway', 'strong-power-living-robot', 'strong-power-living-curtain',
  'strong-power-living-water', 'strong-power-living-sofa-l', 'strong-power-living-sofa-r', 'strong-power-living-table',
  'strong-power-master', 'strong-power-parent', 'strong-power-child', 'strong-power-study',
  'strong-power-kitchen', 'strong-power-gbath', 'strong-power-mbath-service', 'strong-power-garden',
  'weak-main-living', 'weak-master', 'weak-parent', 'weak-study',
  'weak-gateway', 'weak-ap', 'water-master-bath', 'drain-master-bath',
  'water-guest-bath', 'drain-guest-bath', 'water-balcony', 'drain-balcony',
  'water-kitchen-requirement', 'drain-kitchen-requirement', 'water-garden-requirement', 'drain-garden-requirement',
  'drain-mbath-vanity-to-riser', 'drain-gbath-vanity-to-riser', 'drain-kitchen-sink-to-riser', 'drain-kitchen-dishwasher-to-riser',
  'drain-mbath-toilet-to-riser', 'drain-mbath-shower-to-riser', 'drain-mbath-floor-to-riser', 'drain-gbath-shower-to-riser',
  'drain-gbath-floor-to-riser', 'water-water-heater-inlet-requirement', 'water-hot-water-mbath-requirement', 'water-hot-water-gbath-requirement',
  'water-water-heater-recirc-requirement', 'water-kitchen-dishwasher-branch', 'water-v1-heater-to-mbath-hot', 'water-v1-entry-to-mbath-cold',
  'water-v1-heater-to-gbath-hot', 'water-v1-entry-to-gbath-cold', 'water-purifier-branch', 'drain-balcony-floor-to-riser',
  'water-v1-recirc-loop', 'water-entry-valve-requirement', 'drain-mbath-secondary-requirement', 'drain-gbath-secondary-requirement',
  'refrigerant-trunk', 'refrigerant-master', 'refrigerant-parent', 'refrigerant-study',
  'refrigerant-child', 'condensate-living', 'condensate-master', 'condensate-study',
  'condensate-parent', 'condensate-child', 'supply-air-living', 'return-air-living',
  'supply-air-master', 'return-air-master', 'supply-air-study', 'return-air-study',
  'supply-air-parent', 'return-air-parent', 'supply-air-child', 'return-air-child',
  'refrigerant-dining', 'condensate-dining', 'condensate-living-dining-trunk', 'supply-air-dining',
  'return-air-dining', 'supply-air-living-bottom', 'supply-air-dining-bottom', 'strong-power-parent-child-study-curtain',
  'strong-power-parent-child-childbed', 'strong-power-parent-child-guest-bed-r', 'strong-power-parent-child-guest-bed-l', 'strong-power-parent-child-guest-west',
  'strong-power-parent-child-guest-west-curtain', 'strong-power-parent-child-guest-north', 'strong-light-bedrooms-master-bed-north', 'strong-light-bedrooms-master-bed-l',
  'strong-light-bedrooms-master-door', 'strong-light-bedrooms-parent-door', 'strong-light-bedrooms-study-night-side', 'strong-light-bedrooms-study-door',
  'strong-light-bedrooms-study-guest-bed', 'strong-light-bedrooms-study-guest-night', 'strong-light-bedrooms-child-door', 'strong-light-bedrooms-child-bed',
  'strong-light-entry-switch-garden', 'strong-light-entry-foyer', 'strong-light-entry-switch-corridor', 'strong-light-entry-night-living-north',
  'strong-light-entry-night-guest-door', 'strong-light-entry-night-corridor', 'strong-ded-fridge-living', 'strong-power-waterbar',
  'strong-power-kitchen-east', 'strong-power-weakbox', 'weak-ap-master', 'strong-light-balcony',
  'strong-light-entry-night-mid',
]);
// 警告代码已知待决集合（survey + envelope 两桶的并集；must_fix 见 KNOWN_MUST_FIX_CODES）。
const KNOWN_WARNING_CODES: ReadonlySet<string> = new Set([
  'ceiling_clearance_unverified',
  'route_overlap',
  'route_clearance_unverified',
  'route_overlap_declared_trunk',
  'nonphysical_route',
  'route_insulation_unverified',
  'inline_endpoint_without_point_anchor',
  'route_not_orthogonal',
  'supply_return_overlap',
  'penetration_door_clearance',
  'shear_wall_penetration',
  'reference_constraint_uncertain',
  'shear_wall_parallel_route',
  'unsupported_span',
  'bay_sill_crossing_declared',
  'route_furniture_collision',
]);
// survey 分桶分码上限（现值即上限；realContext 与 verify:mep 全上下文共用）。
const SURVEY_CEILINGS: Readonly<Record<string, number>> = {
  ceiling_clearance_unverified: 50,
  penetration_door_clearance: 16,
  shear_wall_penetration: 11,
  shear_wall_parallel_route: 8,
  route_insulation_unverified: 7,
  inline_endpoint_without_point_anchor: 6,
};
// envelope 分桶分码上限（现值即上限；verify:mep 全上下文配额。realContext 与无 layout
// 用例各有单独立上限，见 REAL_CONTEXT_ENVELOPE_CEILINGS / NO_LAYOUT_ENVELOPE_CEILINGS）。
const ENVELOPE_CEILINGS: Readonly<Record<string, number>> = {
  route_overlap: 39,
  route_clearance_unverified: 35,
  route_overlap_declared_trunk: 14,
  bay_sill_crossing_declared: 11,
  reference_constraint_uncertain: 11,
  nonphysical_route: 8,
  route_not_orthogonal: 4,
  route_furniture_collision: KNOWN_ENVELOPE_COLLISIONS.length, // 由实例清单长度派生——登记新实例即同步抬上限，不另填数（与 must_fix 侧同口径）
  supply_return_overlap: 2,
  unsupported_span: 2,
};
// 无 layout 用例的 survey / envelope 单独立上限（与 must_fix 同一 Codex 三审 major）：
// 门洞 / 剪力墙 / 依托 / 参照约束类警告需要 layout 或上下文才运行，本口径下必须为 0，
// 否则墙检查漏进无 layout 口径会静默通过（旧总数钉死值本会拦下这种漂移）。
const NO_LAYOUT_SURVEY_CEILINGS: Readonly<Record<string, number>> = {
  ...SURVEY_CEILINGS,
  penetration_door_clearance: 0,
  shear_wall_penetration: 0,
  shear_wall_parallel_route: 0,
};
const NO_LAYOUT_ENVELOPE_CEILINGS: Readonly<Record<string, number>> = {
  ...ENVELOPE_CEILINGS,
  bay_sill_crossing_declared: 0,
  reference_constraint_uncertain: 0,
  route_furniture_collision: 0,
  unsupported_span: 0,
};
// realContext 用例的 envelope 单独立上限（Codex 五审 major）：realContext() 不传 baySills /
// furnitureVolumes，飘窗穿越与家具碰撞两码本口径下必须为 0；复用全上下文配额（11 / 2）
// 会让这两类检查漏进来时静默通过（旧分码 deepEqual 本要求二者不存在）。完整配额只
// 用于 verify:mep 全上下文。
const REAL_CONTEXT_ENVELOPE_CEILINGS: Readonly<Record<string, number>> = {
  ...ENVELOPE_CEILINGS,
  bay_sill_crossing_declared: 0,
  route_furniture_collision: 0,
};
// 无依托段总数上限（must_fix ≤8 + envelope ≤2；只许减少）。
const UNSUPPORTED_SPAN_CEILING = 10;
// 最长无依托段上限（condensate-living 现值 3.82m；只许缩短）。
const LONGEST_UNSUPPORTED_SPAN_CEILING_M = 3.82;
function assertKnownRouteIds(routes: ReadonlyArray<{ id: string }>, where: string): void {
  for (const route of routes) {
    assert.ok(KNOWN_ROUTE_IDS.has(route.id), `${where} 出现未登记的新路线 ${route.id}：须显式登记并写清原因`);
  }
}
function assertKnownWarningCodes(issues: ReadonlyArray<{ code: string }>, where: string): void {
  for (const issue of issues) {
    assert.ok(KNOWN_WARNING_CODES.has(issue.code), `${where} 出现已知待决集合外的新警告代码 ${issue.code}：须显式登记并写清原因，不得静默扩表`);
  }
}
function assertBucketCeilings(codes: ReadonlyArray<{ code: string; count: number }>, ceilings: Readonly<Record<string, number>>, where: string): void {
  for (const { code, count } of codes) {
    const ceiling = ceilings[code];
    assert.ok(ceiling !== undefined, `${where} 出现已知待决集合外的新代码 ${code}：须显式登记并写清原因`);
    assert.ok(count <= ceiling, `${where} 代码 ${code} 由上限 ${ceiling} 增至 ${count}：须显式登记并写清原因`);
  }
}

function sample(route: Record<string, unknown>) {
  return MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes: [route] });
}

test('real MEP configuration lints without false errors and reports warnings structurally', () => {
  const result = lintMepCoordination(config, sources);
  // 规则断言：路线 id 必须是已登记集合的子集（新路线即 fail；删路线不 fail）；lint 不得丢路线。
  assertKnownRouteIds(config.routes, 'real MEP config');
  assert.equal(result.counts.routes, config.routes.length, 'lint 不得丢路线');
  assert.equal(result.counts.resolvedRoutes, result.counts.routes, '所有路线都必须解析出端点，悬空路线即 fail');
  const buckets = bucketsOf(result);
  // 规则断言：error 代码必须是已知待决集合的子集，分码不得超过上限；总数随几何变是正常的，不再钉死。
  assertKnownMustFixCodes(result.errors, 'no-layout harness');
  // 本口径无 layout：用单独立上限——墙 / 剪力墙 / 依托类代码置 0，漏进来的墙检查即 fail。
  assertMustFixCeilings(buckets.must_fix_before_briefing.codes, NO_LAYOUT_MUST_FIX_CEILINGS, 'no-layout must_fix 分桶');
  assert.equal(result.warnings.filter((issue) => issue.code === 'hvac_coverage_missing').length, 0);
  assert.equal(result.warnings.some((issue) => issue.code === 'ceiling_clearance_unverified' && issue.routeId === 'strong-power-living-sofa-r'), false,
    'a floor-branch candidate is not compared against ceiling finish heights; its supports remain checked in 3D');
  // 当前无 layout：通用正交规则仍运行；墙、幕墙与剪力墙规则需要 layout 才运行。
  // 规则断言：警告代码必须是已知待决集合的子集；总数随几何变是正常的，不再钉死。
  assertKnownWarningCodes(result.warnings, 'no-layout harness');
  assertBucketCeilings(buckets.survey_dependent.codes, NO_LAYOUT_SURVEY_CEILINGS, 'no-layout survey 分桶');
  assertBucketCeilings(buckets.envelope_approximation.codes, NO_LAYOUT_ENVELOPE_CEILINGS, 'no-layout envelope 分桶');
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
  const result = JSON.parse(output) as { errors: unknown[]; warnings: unknown[]; counts: { errors: number; warnings: number; routes: number }; categories: Record<string, { count: number; codes?: Array<{ code: string; count: number }> }> };
  assert.ok(Array.isArray(result.errors));
  assert.ok(Array.isArray(result.warnings));
  // F4：退出码按 JSON 实际 errors 是否非空动态断言——must_fix 清零后 exit 0 属预期，
  // 错误仍存在时必须 exit 1（生产契约：scripts/verify/mep/verify-mep-lint.ts 末尾
  // `if (result.errors.length > 0) process.exitCode = 1`）。现值 errors 124 条，仍断言 exit 1。
  assert.equal(status, result.errors.length > 0 ? 1 : 0, `verify:mep 退出码须与 errors 是否非空一致：errors ${result.errors.length} 条时应 exit ${result.errors.length > 0 ? 1 : 0}，实际 ${status}`);
  // Codex 二审 major：删掉钉死总数后 JSON 汇总字段 counts.errors / counts.warnings 再无人读，
  // 汇总算错会静默通过。补内部一致性断言（汇总 == 数组长度），不是钉死总数：总数随几何变仍自由，
  // 但汇总与数组不一致即 fail。
  assert.equal(result.counts.errors, result.errors.length, 'verify:mep JSON 汇总 errors 须等于 errors 数组长度（汇总错算即 fail）');
  assert.equal(result.counts.warnings, result.warnings.length, 'verify:mep JSON 汇总 warnings 须等于 warnings 数组长度（汇总错算即 fail）');
  assertKnownRouteIds(config.routes, 'verify:mep');
  assert.equal(result.counts.routes, config.routes.length, 'verify:mep 路线数须与配置一致');
  // 规则断言取代钉死总数 124：error 代码必须是已知待决集合的子集；家具相关实例逐条落在清单里。
  // 总数随几何变是正常的（#116 删柜 −3、加柜 +2 即一例），不再钉死。
  const jsonErrors = result.errors as Array<{ code: string; message: string; routeId?: string }>;
  assertKnownMustFixCodes(jsonErrors, 'verify:mep');
  // F1：must_fix 家具碰撞按实例登记（helper 内含去重检查，防重复顶替登记与数量约束）。
  assertKnownCollisionInstances(jsonErrors, KNOWN_FURNITURE_COLLISIONS, 'verify:mep must_fix 家具碰撞');
  const actualInaccessible = jsonErrors
    .filter((issue) => issue.code === 'endpoint_inaccessible')
    .map((issue) => {
      const parsed = inaccessibleEndpointOf(issue);
      return `${issue.routeId}↔${parsed.pointId}↔${parsed.furnitureId}`;
    })
    .sort();
  const knownInaccessible = KNOWN_INACCESSIBLE_ENDPOINTS.map((entry) => `${entry.routeId}↔${entry.pointId}↔${entry.furnitureId}`).sort();
  for (const key of actualInaccessible) {
    assert.ok(knownInaccessible.includes(key), `verify:mep 出现已知待决清单外的新端点遮挡 ${key}：须显式登记并写清原因`);
  }
  // 各代码条数不得超过全上下文上限：家具移动会拖动挂载点位、改动路线几何（实测：通顶柜东移
  // 0.50m 使 route_not_orthogonal 27→28、unsupported_span 8→9），只断言代码子集会漏掉这类新增实例。
  const errorCounts = new Map<string, number>();
  for (const issue of jsonErrors) errorCounts.set(issue.code, (errorCounts.get(issue.code) ?? 0) + 1);
  assertMustFixCeilings([...errorCounts].map(([code, count]) => ({ code, count })), FULL_CONTEXT_MUST_FIX_CEILINGS, 'verify:mep');
  // 规则断言：警告代码必须是已知待决集合的子集，两桶分码不得超过上限；总数随几何变是正常的，不再钉死。
  assertKnownWarningCodes(result.warnings as Array<{ code: string }>, 'verify:mep');
  // F1：包络桶家具碰撞同样按实例登记——需求/候选路线在包络近似桶里报 warning，不进
  // errors；只读 errors 的旧写法会让包络实例的静默替换漏网（旧实例消失、新实例出现、
  // 总数仍为 2 时子集与上限同时通过）。不升级为 must_fix。
  const jsonEnvelopeCollisions = (result.warnings as Array<{ code: string; message: string; routeId?: string; category?: string }>)
    .filter((issue) => issue.code === 'route_furniture_collision' && issue.category === 'envelope_approximation');
  assertKnownCollisionInstances(jsonEnvelopeCollisions, KNOWN_ENVELOPE_COLLISIONS, 'verify:mep envelope 家具碰撞');
  const jsonSurveyCodes = result.categories.survey_dependent?.codes;
  assert.ok(jsonSurveyCodes, 'verify:mep JSON 须带 survey 分桶分码明细');
  assertBucketCeilings(jsonSurveyCodes, SURVEY_CEILINGS, 'verify:mep survey 分桶');
  const jsonEnvelopeCodes = result.categories.envelope_approximation?.codes;
  assert.ok(jsonEnvelopeCodes, 'verify:mep JSON 须带 envelope 分桶分码明细');
  assertBucketCeilings(jsonEnvelopeCodes, ENVELOPE_CEILINGS, 'verify:mep envelope 分桶');
  // F2：分桶内部一致性（同 no-layout / realContext harness 的分桶核算）：每桶 count ==
  // codes 计数之和，各桶合计 == errors + warnings 总数。不是钉死总数——现值（survey 98 /
  // envelope 128）只作参照，分桶汇总算错即 fail。
  for (const [bucketName, bucket] of Object.entries(result.categories)) {
    assert.ok(bucket.codes, `verify:mep JSON 分桶 ${bucketName} 须带分码明细`);
    assert.equal(bucket.count, bucket.codes.reduce((sum, entry) => sum + entry.count, 0), `verify:mep JSON 分桶 ${bucketName} 的 count ${bucket.count} 须等于分码计数之和`);
  }
  assert.equal(
    Object.values(result.categories).reduce((sum, bucket) => sum + bucket.count, 0),
    result.errors.length + result.warnings.length,
    'verify:mep JSON 各桶 count 之和须等于 errors + warnings 总数',
  );
});

// F1 永久反证：包络桶家具碰撞的“旧实例消失、新实例出现、总数不变”必须失败。
// 只断言数量上限（2）与只读 errors 的旧写法都会放过这种替换；实例身份 + 去重才拦得住。
// fixture 直接跑生产 lint：两条需求路线各穿入一个家具包络，均报 warning + envelope 桶。
test('envelope furniture collision swap fails even when the count stays the same', () => {
  const furnitureVolumes = [
    { id: 'fix-a', type: 'cabinet', bounds: { minX: 0, maxX: 1, minY: 0, maxY: 2, minZ: 0, maxZ: 1 } },
    { id: 'fix-b', type: 'cabinet', bounds: { minX: 2, maxX: 3, minY: 0, maxY: 2, minZ: 0, maxZ: 1 } },
  ];
  const requirementRoute = (id: string, x: number) => ({
    id, layer: 'strong_power', status: 'pending', source_status: 'design_requirement',
    diameter: 0.02, from_height: 1.0, to_height: 1.0,
    from: { x: x + 0.1, z: 0.5, y: 1.0 }, to: { x: x + 0.9, z: 0.5, y: 1.0 },
  });
  const swapped = lintMepCoordination(MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers, routes: [
    requirementRoute('req-a', 0),
    requirementRoute('req-b', 2),
  ] }), sources, { furnitureVolumes });
  const envelopeCollisions = swapped.warnings.filter((issue) => issue.code === 'route_furniture_collision' && issue.category === 'envelope_approximation');
  assert.equal(envelopeCollisions.length, 2, 'fixture 须产生两条包络桶家具碰撞');
  // 只登记第一条、第二条是新实例：总数仍为 2，但身份检查必须失败。
  assert.throws(
    () => assertKnownCollisionInstances(envelopeCollisions, [{ routeId: 'req-a', furnitureId: 'fix-a' }], 'swap fixture'),
    /新家具碰撞/,
  );
  // 两条都登记：通过。
  assert.doesNotThrow(() => assertKnownCollisionInstances(envelopeCollisions, [
    { routeId: 'req-a', furnitureId: 'fix-a' },
    { routeId: 'req-b', furnitureId: 'fix-b' },
  ], 'swap fixture'));
  // 同一实例出现两次：子集与数量上限都拦不住，必须由去重断言失败。
  assert.throws(
    () => assertKnownCollisionInstances([envelopeCollisions[0], envelopeCollisions[0]], [{ routeId: 'req-a', furnitureId: 'fix-a' }], 'duplicate fixture'),
    /重复/,
  );
  // 旧实例消失：空集通过（问题已清是好事）。
  assert.doesNotThrow(() => assertKnownCollisionInstances([], [{ routeId: 'req-a', furnitureId: 'fix-a' }], 'cleared fixture'));
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
  // 规则断言：路线 id 必须是已登记集合的子集（新路线即 fail；删路线不 fail）；lint 不得丢路线。
  assertKnownRouteIds(config.routes, 'realContext harness');
  assert.equal(result.counts.routes, config.routes.length, 'lint 不得丢路线');
  assert.equal(result.counts.resolvedRoutes, result.counts.routes, '所有路线都必须解析出端点，悬空路线即 fail');
  // 规则断言取代钉死总数 110：本 harness 的 errors 必须全部来自已知待决代码集合；新代码即 fail。
  // 总数随几何变是正常的，不再钉死；分码上限由下方 must_fix 分桶断言把守。
  assertKnownMustFixCodes(result.errors, 'realContext harness');
  // (a) 重力坡度：R1 后 14 条全清（地埋全平/过陡、冷凝水候选沿程、drain-balcony 2% 回算、墙排汇总不足坡）
  assert.equal(countByCode(result, 'gravity_slope_geometry_mismatch'), 0);
  assert.equal(result.warnings.some((i) => i.code === 'gravity_slope_geometry_mismatch' && i.routeId === 'drain-gbath-vanity-to-riser'), false);
  // (b) 全专业正交检查覆盖现行强弱电、冷媒、风管和给排水折点。
  // route_not_orthogonal 总数由 must_fix 上限 27 + envelope 上限 4 把守，不再钉死 31。
  // (c) 穿点距门洞：2026-10-07 M05 声明式补路由后 15 → 19；过门头 → survey_dependent，门洞高度内贴门垛 → must_fix
  const strip = result.warnings.filter((i) => i.code === 'penetration_door_clearance' && i.routeId === 'strong-ac-master');
  assert.ok(strip.length <= 1, 'strong-ac-master 门洞穿点不得超过已知待决上限 1 处：新增即须显式登记并写清原因');
  // Codex 二审 minor：上限允许 0 条，strip[0] 无条件访问会在该警告消失时抛 TypeError。
  // 实例细节只在实例存在时查；0 条即该问题已清，是好事，不 fail。
  if (strip.length === 1) {
    // F3：穿点坐标 / 门洞范围只解析为变量、不钉死——穿点移动、净距改善（仍 < 报警阈值）
    // 时不再要求改测试。只断言身份（墙 / 门洞）+ 净距仍在报警侧 + 解析出的净距与解析出
    // 的几何一致（点到门洞区间的距离，计两位小数舍入容差 0.02m）。报警阈值仍为
    // DOOR_CLEARANCE_MIN = 0.15m（shared/mep-hvac-lint.ts），舍入容差沿用四审口径。
    const stripMatch = /on (\S+) at \((\d+\.\d+),(\d+\.\d+)\) is (\d+\.\d+)m from door opening (\S+) \((\w+) (\d+\.\d+)–(\d+\.\d+)\)/.exec(strip[0].message);
    assert.ok(stripMatch, `门洞穿点消息格式已变、解析不出墙/穿点/净距/门洞：${strip[0].message}`);
    const [, stripWall, pointX, pointZ, clearance, doorId, axis, doorFrom, doorTo] = stripMatch;
    assert.equal(stripWall, 'w_strip_east', '门洞穿点须在 w_strip_east 墙上');
    assert.equal(doorId, 'd_mb', '门洞穿点须对应门洞 d_mb');
    const pointCoord = axis === 'x' ? Number(pointX) : Number(pointZ);
    const geometricClearance = pointCoord < Number(doorFrom)
      ? Number(doorFrom) - pointCoord
      : pointCoord > Number(doorTo) ? pointCoord - Number(doorTo) : 0;
    assert.ok(Math.abs(Number(clearance) - geometricClearance) <= 0.02, `门洞穿点净距 ${clearance}m 与解析出的几何（穿点 ${axis}=${pointCoord}，门洞 ${doorFrom}–${doorTo}）不一致：消息口径已变`);
    assert.ok(Number(clearance) <= 0.15, `strong-ac-master 门洞穿点净距 ${clearance}m 已 > 报警阈值 0.15m（计舍入容差）：该警告应已消失或消息口径已变`);
    assert.match(strip[0].message, /过门头穿梁，需核梁底与套管/);
    assert.equal(strip[0].category, 'survey_dependent');
  }
  // penetration_door_clearance 由 survey 上限 16 把守，不再钉死 16。
  // (d) 剪力墙并行 8 → 14（2026-10-07 M04/M05 补路由贴剪力墙竖槽，见各条 reason 扫筋声明）
  // 同 strip 一样用 if 守卫：该实例消失即问题已清，不抛 TypeError。
  const masterParallel = result.warnings.find((i) => i.code === 'shear_wall_parallel_route' && i.routeId === 'strong-power-master');
  if (masterParallel) {
    // Codex 三审 minor：并行长度 / 贴墙距离不得钉死精确值——缩短改善（仍在报警侧）时消息一变即红。
    // 只断言身份（墙）+ 仍在报警侧：长度 > SHEAR_PARALLEL_MIN_RUN 1.0m、距离 ≤ SHEAR_PARALLEL_MAX_DISTANCE 0.15m
    //（shared/mep-hvac-lint.ts）。
    // Codex 四审 minor：同门洞净距，生产侧按原始精度判、消息只保留两位小数；lint 结果不暴露未舍入值，
    // 故长度用舍入容差断言：长度 1.004m 显示为 1.00m，仍是合法报警。显示值 < 1.00 即原始值 < 0.995，
    // 报警本不应触发，才 fail。距离的 <= 已是舍入容差形式（生产侧只累计原始距离 ≤ 0.15 的段，
    // 合法报警的显示值不可能超过 0.15），保持不变。
    const parts = /parallel to shear wall w_mb_east for (\d+\.\d+)m at (\d+\.\d+)m/.exec(masterParallel.message);
    assert.ok(parts, `剪力墙并行消息格式已变、解析不出长度/距离：${masterParallel.message}`);
    assert.ok(Number(parts[1]) >= 1.0, `strong-power-master 剪力墙并行长度 ${parts[1]}m 已 < 报警阈值 1.0m（计舍入容差）：该警告应已消失或消息口径已变`);
    assert.ok(Number(parts[2]) <= 0.15, `strong-power-master 剪力墙贴墙距离 ${parts[2]}m 已 > 报警阈值 0.15m：该警告应已消失或消息口径已变`);
  }
  // shear_wall_parallel_route 由 survey 上限 8 把守，不再钉死 8。
  // DEC-2026-10-13-R3 锁定改善：重画后的两条路由不得再贴 w_mb_east 长距离平行。
  // 若将来有人把几何改回贴墙（或把灯位改回 (2.60,7.60) 而不同步路由），这里立即 fail——
  // 正是本轮第一次提交时漏掉同步、导致 shear 13→11 / unsupported_span 7→9 双向漂移的那个失效模式。
  const shearRouteIds = result.warnings.filter((i) => i.code === 'shear_wall_parallel_route').map((i) => i.routeId);
  assert.equal(shearRouteIds.includes('strong-light-master'), false, 'strong-light-master 应走 ceiling_master_ac 门头盒空腔，不得贴 w_mb_east 长距离平行');
  assert.equal(shearRouteIds.includes('strong-light-bedrooms-master-bed-north'), false, 'strong-light-bedrooms-master-bed-north 同上');
  // F4：上面两条 false 是负向保护（已消除问题不得重现），保留；“已知问题必须存在”
  // 的正向断言已删——检测规则有效的证明在合成 fixture 用例
  // 'long parallel runs beside a shear wall are flagged, short ones are not'，
  // 真实配置只断言禁止新增问题，旧警告消失即通过。
  // 分桶核算：三桶之和 == error + warning 总数，且每桶 count == 各类 count 之和
  const buckets = bucketsOf(result);
  const total = result.errors.length + result.warnings.length;
  assert.equal(Object.values(buckets).reduce((sum, bucket) => sum + bucket.count, 0), total);
  for (const bucket of Object.values(buckets)) assert.equal(bucket.count, bucket.codes.reduce((sum, entry) => sum + entry.count, 0));
  // 分桶代码明细必须与实算完全一致（gravity_slope/orthogonal 已出 must_fix；penetration_door_clearance 拆 must_fix 2 / survey 13）
  // unsupported_span：F01/F02 首轮只检查水平段；2026-10-17 R2 后按3D长度检查水平/斜向/竖直段。
  // inline_endpoint_without_point_anchor 5 条：DEC-2026-10-08-W02 端点绑定兜底（给排水无锚点端点的量房判读清单；W03 客卫热水改绑 faucet_gbath_vanity 后由 5 降为 4；DEC-2026-10-23-R03 客卫二次排水示意段两端点 +2 至 6）
  // 2026-10-23 按本 harness 现行实测整体重钉（R21 期旧表已被 R25 拓扑/R01 登记/DEC-2026-10-23-R02 墙排口径取代；与 verify:mep 全上下文的差异见 errors 断言注释）
  // 规则断言取代钉死分码明细：must_fix 分桶不得出现已知待决集合外的新代码，
  // 各代码条数不得超过上限（现值即上限，只许减少、不许增长；增长须显式登记并写清原因）。
  assertMustFixCeilings(buckets.must_fix_before_briefing.codes, HARNESS_MUST_FIX_CEILINGS, 'must_fix 分桶');
  assertBucketCeilings(buckets.survey_dependent.codes, SURVEY_CEILINGS, 'survey 分桶');
  // Codex 五审 major：本 harness 无 baySills / furnitureVolumes 上下文，飘窗穿越与家具碰撞
  // 两码必须为 0，用单独立上限 REAL_CONTEXT_ENVELOPE_CEILINGS；全上下文配额只用于 verify:mep。
  assertBucketCeilings(buckets.envelope_approximation.codes, REAL_CONTEXT_ENVELOPE_CEILINGS, 'envelope 分桶');
  // must_fix 总数断言已删（Codex minor）：总数是各桶之和，上限已把守住；消掉问题不再使测试变红。
  // 飞线依托检查自证：最长飞线是 strong-power-living 出边吊后的 4.16m 无依托段（reason 声称「平吊板上方敷设」
  // 但 weak-ap reason 明说客厅中部保持原顶 2.80m 无吊顶——两处自相矛盾被机器显形）
  // F01 改线批：33 条命中清至 8 条显式保留（每条 reason 带 DEC-2026-10-07-F01 归因）
  const flying = [...result.errors, ...result.warnings].filter((i) => i.code === 'unsupported_span');
  assert.ok(flying.length <= UNSUPPORTED_SPAN_CEILING, '无依托段总数不得超过已知待决上限 10（must_fix ≤8 + envelope ≤2）：增长须显式登记并写清原因');
  // Codex 二审 minor：flying.reduce 无初始值，空数组抛错；且下文曾强制 condensate-living 在飞线集里，
  // 该飞线清掉时测试反会红。空集即全部飞线已清，是好事：最长段只在非空时查，成员身份不再强制。
  if (flying.length > 0) {
    // Codex 四审 major：旧写法按字符串比较长度（'3.82' > '10.00'），两位数长度会被漏判、
    // 悄悄通过上限。逐条解析为数值并校验解析成功，再取数值最大；上限本身不变。
    const spanOf = (issue: { message: string }): number => {
      const m = issue.message.match(/for (\d+\.\d\d)m/);
      assert.ok(m, `无依托段消息格式已变、解析不出长度：${issue.message}`);
      const n = Number(m[1]);
      assert.ok(Number.isFinite(n), `无依托段长度解析失败：${issue.message}`);
      return n;
    };
    const worstSpan = Math.max(...flying.map(spanOf));
    assert.ok(worstSpan <= LONGEST_UNSUPPORTED_SPAN_CEILING_M, `最长无依托段不得超过已知待决上限 3.82m，实际 ${worstSpan}m：增长须显式登记并写清原因`);
  }
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
/** （二阶段 S1）一条路线的已解 via 点：统一出口的 viaPoints（与声明的绝对 via 同值）。 */
let mepResolutionCache: ReturnType<typeof resolveMepRoutes> | undefined;
function viaPointsOf(routeId: string): Array<{ x: number; y?: number; z: number }> {
  mepResolutionCache ??= resolveMepRoutes(config, sources);
  return mepResolutionCache.routes.find((item) => item.route.id === routeId)?.viaPoints ?? [];
}
function viaYsInCeilings(routeId: string): Array<{ y: number; zone: string }> {
  // （二阶段 S1）via 点读统一出口的 viaPoints，不读原始 route.via。
  const out: Array<{ y: number; zone: string }> = [];
  for (const v of viaPointsOf(routeId)) {
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
    const spine = viaPointsOf(id).filter((v) => v.x >= 6.9 && v.x <= 7.5 && v.z >= 3.6 && v.z <= 8).map((v) => v.y as number);
    assert.ok(spine.length > 0, `${id} 应有点落在走廊服务带梁带内`);
    for (const y of spine) assert.ok(y <= 2.60, `${id} 在走廊服务带梁带内应 ≤2.60（参考梁底 2.65 − 0.05）`);
  }
  // B 区（厨房铝扣板，完成面 2.65）：进入该区的管路段 ≥2.70 且 ≤2.76
  for (const id of ['strong-power-kitchen', 'strong-ded-dishwasher', 'strong-ded-washer-dryer', 'strong-light-kitchen', 'refrigerant-trunk']) {
    const inKitchen = viaPointsOf(id).filter((v) => v.x >= KITCHEN[0] && v.x <= KITCHEN[2] && v.z >= KITCHEN[1] && v.z <= KITCHEN[3] && (v.y as number) >= 2.0).map((v) => v.y as number); // 同 viaYsInCeilings：只查承载段，排除下引分发低位点
    assert.ok(inKitchen.length > 0, `${id} 应有段落进入厨房铝扣板 footprint`);
    for (const y of inKitchen) assert.ok(y >= 2.70 && y <= 2.76, `${id} 厨房段应在 2.70–2.76（B 区），实际 ${y}`);
  }
  // B 区（客卫铝扣板）：≥2.70
  // DEC-2026-10-12-R2：strong-light-gbath（客卫照明）已随平板灯删除，故 B 区客卫只剩电源与浴霸两条
  for (const id of ['strong-power-gbath', 'strong-ded-bathheaters-gbath']) {
    const inBath = viaPointsOf(id).filter((v) => v.x >= GUEST_BATH[0] && v.x <= GUEST_BATH[2] && v.z >= GUEST_BATH[1] && v.z <= GUEST_BATH[3] && (v.y as number) >= 2.0).map((v) => v.y as number);
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
  // y 不在原顶暗敷带（2.66–2.85）且低于客卫完成面（2026-11-12 由 2.65 降至 2.50）：bend_corridor (7.2,4.3) 首段 1.12m ≤2m 但 y=2.40 → 照报
  // （原 y=2.55 在 2.65 完成面之下为暴露段；完成面降至 2.50 后 2.55 落入空腔有依托，改取 2.40 保持 off-band 前提）
  const offBand = lintMepCoordination(sample({
    id: 'band-no', layer: 'strong_power', status: 'inferred', source_status: 'proposed', method: 'conduit',
    diameter: 0.02, from_height: 2.4, to_height: 2.4,
    from: 'bend_corridor', via: [{ x: 6.2, z: 4.0, y: 2.4 }], to: 'net_gateway',
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
