/**
 * penetration at 单一源收敛的回归与可见性（issue #98 第五阶段 S3）。
 *
 * - 钉值断言：45 条已删除的可派生 at，其「路线折线 ∩ 墙段唯一交点」派生值必须逐一等于
 *   删除前的手写声明值（≤1e-9，删除前实跑最大偏差 4.441e-16）。表值即被删字面量的墓碑。
 * - 可见性断言：12 条不可派生的保留手写声明（7 共线 + 1 端点压墙线 + 4 意图点）+ 3 条
 *   偏差待量房（B 类）在 lint 里不再「静默不可见」——内存突变演练证明删除/漂移会被抓。
 * - fail-closed：孔数计数与冷凝链锚点派生对「不可派生且无手写 at」必须报错，不发明数值。
 * - 计数回归：takeoff 孔数 46（mep-quotes 元/孔增项的量）与 lint penetration_* 计数不变。
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
  mepRoutePoints,
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
  const resolved = resolvedById.get(route.id);
  assert.ok(resolved?.from && resolved.to, `route ${route.id} 端点应可解`);
  return mepRoutePoints(route, resolved.from, resolved.to);
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

// ── 45 条被删 at 的钉值墓碑（删除前 derive-assert 实跑导出；偏差全部 ≤1e-9） ──
const PIN_45: Array<[string, string, number, number]> = [
  ['strong-ac-master', 'w_strip_east', 4.2, 4.6],
  ['strong-ac-parent', 'w_st_north', 5.5, 5.55],
  ['strong-ac-child', 'w_nw_south', 4.35, 4.3],
  ['strong-light-entry-base', 'w_ent_south_w', 11.3, 3],
  ['strong-light-entry-base', 'w_cent_north', 12.77, 2.94],
  ['strong-light-entry-base', 'w_blk_south', 11.3, 3.25],
  ['strong-light-entry-base', 'w_blk_east_north', 11.49, 2.94],
  ['strong-light-master', 'w_strip_east', 4.2, 4.6],
  ['strong-light-parent', 'w_st_north', 5.5, 5.55],
  ['strong-ded-washer-dryer', 'w_balc_east', 7.2, 2.15],
  ['strong-ded-bathheaters-mbath', 'w_strip_east', 4.2, 4.6],
  ['strong-ded-bathheaters-mbath', 'w_mbath_south', 2, 2.86],
  ['strong-ded-bathheaters-gbath', 'w_gbath_south', 6.7, 3.55],
  ['strong-power-master', 'w_strip_east', 4.2, 4.6],
  ['strong-power-parent', 'w_st_north', 5.5, 5.55],
  ['strong-power-study', 'w_st_north', 5.5, 5.55],
  ['strong-power-gbath', 'w_gbath_south', 6.7, 3.55],
  ['strong-power-mbath-service', 'w_strip_east', 4.2, 4.6],
  ['strong-power-garden', 'w_ent_south_w', 11, 3],
  ['strong-power-garden', 'w_blk_south', 11, 3.25],
  ['strong-power-garden', 'w_blk_north', 11, 2.72],
  ['weak-parent', 'w_st_north', 5.5, 5.55],
  ['water-master-bath', 'w_mbath_south', 0.575, 2.86],
  ['water-balcony', 'w_balc_east', 7.2, 1.02],
  ['drain-kitchen-requirement', 'w_vrv_east', 7.2, 0.5],
  ['water-garden-requirement', 'w_ent_west', 10.8, 1.42],
  ['drain-mbath-vanity-to-riser', 'w_mbath_south', 0.575, 2.86],
  ['water-hot-water-mbath-requirement', 'w_mbath_south', 0.575, 2.86],
  ['water-v1-heater-to-mbath-hot', 'w_gbath_east', 7.2, 2.76],
  ['water-v1-heater-to-mbath-hot', 'w_gbath_west', 5.6, 2.76],
  ['water-v1-heater-to-mbath-hot', 'w_mbath_east', 2.6, 2.76],
  ['water-v1-entry-to-mbath-cold', 'w_gbath_east', 7.2, 2.76],
  ['water-v1-entry-to-mbath-cold', 'w_gbath_west', 5.6, 2.76],
  ['water-v1-entry-to-mbath-cold', 'w_mbath_east', 2.6, 2.76],
  ['refrigerant-trunk', 'w_vrv_east', 7.2, 0.55],
  ['refrigerant-master', 'w_strip_east', 4.2, 4.6],
  ['refrigerant-parent', 'w_st_north', 5.5, 5.55],
  ['refrigerant-child', 'w_nw_south', 4.35, 4.3],
  ['condensate-master', 'w_mbath_south', 2.3, 2.86],
  ['condensate-study', 'w_be_west', 13.4, 6.29],
  ['condensate-child', 'w_gbath_west_open_vanity', 5.6, 3.87],
  ['strong-power-parent-child-study-curtain', 'w_st_north', 5.5, 5.55],
  ['strong-power-parent-child-guest-north', 'w_be_west', 13.4, 5.9],
  ['weak-ap-master', 'w_strip_east', 4.2, 4.48],
  ['strong-light-balcony', 'w_balc_east', 7.2, 2.17],
];

/** 保留手写的 15 条（12 不可派生 C/D/E + 3 偏差 B），at 不得删。 */
const KEPT_15: Array<[string, string]> = [
  ['strong-light-child', 'w_nw_south'],
  ['weak-master', 'w_strip_east'],
  ['water-hot-water-gbath-requirement', 'w_gbath_south'],
  ['strong-ac-study', 'w_be_west'],
  ['strong-light-study', 'w_be_west'],
  ['water-guest-bath', 'w_gbath_south'],
  ['refrigerant-study', 'w_be_west'],
  ['strong-power-parent-child-childbed', 'w_nw_south'],
  ['strong-power-parent-child-guest-bed-r', 'w_be_west'],
  ['strong-power-parent-child-guest-west', 'w_be_west'],
  ['water-kitchen-requirement', 'w_vrv_east'],
  ['drain-garden-requirement', 'w_ent_west'],
  ['water-water-heater-inlet-requirement', 'w_vrv_east'],
  ['water-entry-valve-requirement', 'w_vrv_east'],
  ['drain-gbath-vanity-to-riser', 'w_gbath_south'],
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

test('45 条被删 at：派生交点逐一等于被删声明值（≤1e-9）', () => {
  const declared = new Set(declarationsOf(config).map((d) => `${d.route.id}@${d.wall}`));
  assert.equal(declarationsOf(config).length, 60, '穿墙声明总数应保持 60（at 删除不改条目数）');
  for (const [routeId, wallId, x, z] of PIN_45) {
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

test('15 条保留手写：at 原样在场，height/note 未动（60 条声明全集不变）', () => {
  const flat = declarationsOf(config);
  for (const [routeId, wallId] of KEPT_15) {
    const found = flat.find((d) => d.route.id === routeId && d.wall === wallId);
    assert.ok(found, `${routeId}@${wallId} 声明在场`);
    assert.ok(found.entry.at !== undefined, `${routeId}@${wallId} 的 at 保留手写`);
    assert.ok(found.entry.height !== undefined, `${routeId}@${wallId} 的 height 在场`);
    assert.ok(typeof found.entry.note === 'string' && found.entry.note.length > 0, `${routeId}@${wallId} 的 note 在场`);
  }
  // 3 条 B 类偏差（0.125/0.05/0.0658m，量房依赖）本期不修路线，声明必须原样保留。
  // 断言口径：派生值 ≠ 声明值（>5mm，这正是它们不能删 at 的原因）且 ≤0.25m（AGENTS 铁律内，
  // lint mismatch 不触发）。
  const deviation = { 'strong-light-child@w_nw_south': 0.125, 'weak-master@w_strip_east': 0.05, 'water-hot-water-gbath-requirement@w_gbath_south': 0.0658 };
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

test('takeoff 孔数 = 46（派生口径），与旧数组长度口径一致', () => {
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
  assert.equal(withWalls.devices.penetrations, 46, '派生口径孔数（喂 mep-quotes extra_penetration 元/孔）');
  assert.equal(legacy.devices.penetrations, 46, '旧口径（未传墙几何的手搭输入路径）同值');
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
  const cClass: Array<[string, string]> = [
    ['strong-ac-study', 'w_be_west'],
    ['strong-light-study', 'w_be_west'],
    ['water-guest-bath', 'w_gbath_south'],
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

test('lint 可见性：C/D 类手写 at 漂移 → penetration_point_mismatch（锚定校验）', () => {
  const context = lintContext();
  // C 类：贴墙段 run 端点 (13.4,5.9)，手写 at 改到 (13.6,5.9) → 漂移 0.2m
  const mutatedC = structuredClone(config) as MepCoordination;
  const routeC = mutatedC.routes.find((item) => item.id === 'strong-ac-study')!;
  const entryC = ((routeC as unknown as { penetration: Array<Record<string, unknown>> }).penetration)[0]!;
  entryC.at = { x: 13.6, z: 5.9 };
  const resultC = lintMepCoordination(mutatedC, sources, context);
  assert.ok([...resultC.errors, ...resultC.warnings].some((issue) => issue.code === 'penetration_point_mismatch' && issue.routeId === 'strong-ac-study'),
    'C 类 at 偏离贴墙段端点应显形（D 轨 §4.3-1：改两处都不对的风险原为零感知）');
  // D 类：端点压墙线 at=(6.9,3.55)，改到 (6.8,3.55) → 漂移 0.1m
  const mutatedD = structuredClone(config) as MepCoordination;
  const routeD = mutatedD.routes.find((item) => item.id === 'drain-gbath-vanity-to-riser')!;
  const entryD = ((routeD as unknown as { penetration: Array<Record<string, unknown>> }).penetration)[0]!;
  entryD.at = { x: 6.8, z: 3.55 };
  const resultD = lintMepCoordination(mutatedD, sources, context);
  assert.ok([...resultD.errors, ...resultD.warnings].some((issue) => issue.code === 'penetration_point_mismatch' && issue.routeId === 'drain-gbath-vanity-to-riser'),
    'D 类 at 偏离压墙端点应显形（D 轨 sim3 演练：along 改 1.2 后 at 无人校验）');
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

test('真实配置 lint：penetration_* 计数与 S2 结束态一致（行为零变化）', () => {
  const result = lintMepCoordination(config, sources, lintContext());
  const all = [...result.errors, ...result.warnings];
  const count = (code: string): number => all.filter((issue) => issue.code === code).length;
  assert.equal(count('penetration_door_clearance'), 16);
  assert.equal(count('penetration_wall_unknown'), 0);
  assert.equal(count('penetration_declaration_orphaned'), 0);
  assert.equal(count('penetration_declaration_incomplete'), 0);
  assert.equal(count('penetration_missing'), 0);
  assert.equal(count('penetration_point_mismatch'), 0);
  assert.equal(count('shear_wall_penetration'), 11);
});

test('冷凝链锚点 deriveMepPenetrationAt：派生值 == 被删声明 (2.3, 2.86)，fail-closed 三态', () => {
  const derived = deriveMepPenetrationAt(
    config.routes.find((route) => route.id === 'condensate-master'),
    'w_mbath_south',
    { sources, walls: layout.walls },
  );
  assert.equal(derived.diagnostic, undefined);
  assert.ok(derived.point);
  assert.ok(Math.hypot(derived.point!.x - 2.3, derived.point!.z - 2.86) <= 1e-9,
    `派生锚点 (${derived.point!.x},${derived.point!.z}) 应等于被删声明 (2.3, 2.86)`);
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
