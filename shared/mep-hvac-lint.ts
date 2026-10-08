import type { CeilingZone, HvacAnchor, HvacTerminal, ResolvedLayout, ResolvedWall, ResolvedWallSegment, Vertex } from './types.js';
import {
  isMepPhysicalRoute,
  mepRoutePoints,
  resolveMepEndpoint,
  resolveMepRoutes,
  type MepCoordination,
  type MepEndpointSources,
  type MepRoute,
} from './mep-hvac-coordination-schema.js';

export type MepLintLevel = 'error' | 'warning';
export interface MepLintIssue {
  level: MepLintLevel;
  code: string;
  message: string;
  routeId?: string;
  relatedRouteId?: string;
  /** (e) warning 分桶：交底前必须清 / 量房后复判 / 模型包络近似。既有字段语义不变，只新增。 */
  category?: MepLintCategory;
}
export interface MepLintCounts { errors: number; warnings: number; routes: number; resolvedRoutes: number; }
/**
 * (e) 三桶口径：
 *   - must_fix_before_briefing：水电交底前必须清（本轮新规则 (a)(b)(c)(d) 全部落入此桶，以及默认值）；
 *   - survey_dependent：量房后自然消或需复判（吊顶净空未核实、剪力墙穿透、梁碰撞）；
 *   - envelope_approximation：模型包络近似/非物理需求路线，不代表设计错误。
 */
export type MepLintCategory = 'must_fix_before_briefing' | 'survey_dependent' | 'envelope_approximation';
export const MEP_LINT_CATEGORIES: readonly MepLintCategory[] = ['must_fix_before_briefing', 'survey_dependent', 'envelope_approximation'];
export interface MepLintCategoryBucket { count: number; codes: Array<{ code: string; count: number }>; }
export type MepLintCategorySummary = Record<MepLintCategory, MepLintCategoryBucket>;
export interface MepLintResult { errors: MepLintIssue[]; warnings: MepLintIssue[]; counts: MepLintCounts; /** (e) 分桶汇总；可选是为了让只构造 errors/warnings/counts 的调用方（渲染器/徽标的 fixture）不必补桶。 */ categories?: MepLintCategorySummary; }

export interface MepLintLayoutContext {
  layout?: ResolvedLayout;
  ceiling?: CeilingZone[];
  suppressedWallIds?: Set<string> | string[];
  referenceConstraints?: Array<{ id: string; range: { x1: number; x2: number; z1: number; z2: number }; reason?: string; status?: string; reference_beam_bottom_y?: number }>;
}

/** 实心吊顶（降板/铝扣板/一体）的类型集合：与 shared/render/CeilingZoneBuilder.ts 的 SOLID_TYPES 同源。 */
const SOLID_CEILING_TYPES = new Set(['drop', 'integrated', 'aluminum_buckle']);

/**
 * (D) DEC-2026-10-06-R5 明文授权的口径修正：`ceiling_clearance_unverified`
 * （与契约 `c.mep_layer_below_drop_bottom` 同源）的比较范围收窄为**吊顶承载层**。
 *
 * 授权来源：docs/decision_log.md「DEC-2026-10-06-R5 #41 裁定：MEP 分层标高升入降板空腔，保走廊净高 2.50m」
 * ——「配套口径修正：c.mep_layer_below_drop_bottom 的检查范围收窄为吊顶承载层（强电/弱电/冷媒/冷凝水/送风/回风）；
 *   走地给排水分层（water_supply 0.18 / drainage 0.10）不参与"低于吊顶完成面"比较——地面管与吊顶完成面无可比性，
 *   原口径把 13 处地面管计入冲突、稀释真信号。该口径变化按契约修正通道登记（附本 DEC 全引 + 4 文件同步），不是消音。」
 *
 * 理由（不是消音）：给水/排水走地面垫层，标高 0.02–0.80m 与任何吊顶完成面（2.50/2.65）不存在可比性，
 * 把地面管计入"低于吊顶完成面"只会稀释真信号；地面管自身的坡度/正交/禁直插规则由
 * gravity_slope_geometry_mismatch / route_not_orthogonal 独立负责，不因本修正失去覆盖。
 *
 * 同步落点：`config/facts.yaml` 契约 `c.mep_layer_below_drop_bottom` 的 registered_conflicts / check 口径、
 * `docs/mep-construction-guidance.md` §0/§3.3/§6、`docs/pending-site-data.md` #41。
 */
const CEILING_CARRIED_LAYERS = new Set(['strong_power', 'weak_power', 'refrigerant', 'condensate', 'supply_air', 'return_air']);

/** (e) issue code → 分桶。未登记 code 一律按「交底前必须清」处理（数据/契约缺口，不是量房能消的近似）。 */
const ISSUE_CATEGORY: Record<string, MepLintCategory> = {
  // 本轮新规则 (a)(b)(c)(d)：交底前必须清
  gravity_slope_geometry_mismatch: 'must_fix_before_briefing',
  route_not_orthogonal: 'must_fix_before_briefing',
  penetration_door_clearance: 'must_fix_before_briefing',
  shear_wall_parallel_route: 'must_fix_before_briefing',
  // (f) 2026-10-07 飞线依托检查：吊顶承载层的水平段全程无依托（吊顶空腔/贴墙/穿墙/竖直下引/垫层）= 悬空飞线，
  // 渲染得出、现场做不出；requirement/candidate 路线由 issue 处按实例改判 envelope_approximation。
  unsupported_span: 'must_fix_before_briefing',
  // 量房后自然消或需复判
  ceiling_clearance_unverified: 'survey_dependent',
  shear_wall_penetration: 'survey_dependent',
  beam_collision: 'survey_dependent',
  // 模型包络近似 / 非物理需求路线
  supply_return_overlap: 'envelope_approximation',
  reference_constraint_uncertain: 'envelope_approximation',
  suppressed_wall_crossing: 'envelope_approximation',
  nonphysical_route: 'envelope_approximation',
  // (g) DEC-2026-10-08-W02 端点绑定兜底：重合未绑现在就能改（交底前必须清）；
  //     给排水无锚点端点要量房人工判读（量房后复判）。
  endpoint_not_bound_to_point: 'must_fix_before_briefing',
  inline_endpoint_without_point_anchor: 'survey_dependent',
};
const DEFAULT_CATEGORY: MepLintCategory = 'must_fix_before_briefing';

/**
 * (g) DEC-2026-10-08-W02 端点绑定兜底：内联端点与已登记点位的"重合但未绑定"判定。
 * 0.02m = 坐标两位小数的舍入量级（0.01m）再留一倍余量：≤0.02m 只可能是"抄了点位坐标但写成了字面量"，
 * 不可能是两处独立布置（设备位之间不可能这么近）。>0.02m 的偏移视为有意的工艺差
 * （如 faucet_garden 龙头出水口 (10.85,1.5) vs 底盒位 (10.80,1.5) 的 0.05m），不报警。
 */
const ENDPOINT_BIND_TOLERANCE = 0.02;
const ENDPOINT_BIND_LAYERS = new Set(['water_supply', 'drainage', 'strong_power', 'weak_power']);
const PLUMBING_SUPPLY_TYPES = new Set(['faucet', 'toilet', 'shower', 'washer', 'faucet_outdoor', 'water_supply']);
const PLUMBING_DRAIN_TYPES = new Set(['drain', 'drain_riser']);

/** 端点绑定兜底用的"同专业点位池"：给水只对给水类点位比、排水只对 drain/drain_riser 比，避免把龙头算成排水锚点。 */
function endpointBindPool(route: MepRoute, sources: MepEndpointSources): Array<{ id: string; x: number; z: number }> {
  if (route.layer === 'water_supply') return sources.plumbing.filter((point) => PLUMBING_SUPPLY_TYPES.has(point.type));
  if (route.layer === 'drainage') return sources.plumbing.filter((point) => PLUMBING_DRAIN_TYPES.has(point.type));
  return sources.electrical;
}
function categoryOf(code: string): MepLintCategory { return ISSUE_CATEGORY[code] ?? DEFAULT_CATEGORY; }
function emptyCategoryBuckets(): MepLintCategorySummary {
  return {
    must_fix_before_briefing: { count: 0, codes: [] },
    survey_dependent: { count: 0, codes: [] },
    envelope_approximation: { count: 0, codes: [] },
  };
}
function summarizeCategories(issues: MepLintIssue[]): MepLintCategorySummary {
  const buckets = emptyCategoryBuckets();
  // 按 (category, code) 分别累计：同一 code 可能落在不同桶（如 penetration_door_clearance 按过门头/门洞内拆到
  // survey_dependent 与 must_fix_before_briefing，见 (c) DEC-2026-10-06-R1），不能只按 code 合并到一个桶，
  // 否则该 code 全部划入首个出现的桶，导致桶 codes 之和 ≠ 桶 count（分桶自证断言失败）。
  const perCategoryCode = new Map<string, { category: MepLintCategory; code: string; count: number }>();
  for (const item of issues) {
    const category = item.category ?? categoryOf(item.code);
    buckets[category].count += 1;
    const key = `${category}::${item.code}`;
    const entry = perCategoryCode.get(key) ?? { category, code: item.code, count: 0 };
    entry.count += 1;
    perCategoryCode.set(key, entry);
  }
  for (const entry of perCategoryCode.values()) buckets[entry.category].codes.push({ code: entry.code, count: entry.count });
  for (const category of MEP_LINT_CATEGORIES) buckets[category].codes.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return buckets;
}

// ── (a)(b) 平面/竖向几何检查的共用阈值 ──
/** (a) 与声明坡度允许的相对偏差：±50%（规范只定最小坡度；过小流不动、过大冲刷管壁与存水弯）。 */
const GRAVITY_SLOPE_TOLERANCE = 0.5;
/** (a) 水平长度不足 30cm 的段不参与坡度判定：1–2% 坡度在 0.3m 上只有 3–6mm 落差，低于 y 取值精度， */
/** 逐段判会把示意性 vertex 刷成告警（墙排柜内大落差同理，另见 WALL_DRAIN_METHOD）。 */
const GRAVITY_MIN_RUN = 0.3;
/** (a) 墙排（gravity_wall_drain）允许柜内大落差，故按全线汇总落差/水平长度判定，不逐段判。 */
const WALL_DRAIN_METHOD = 'wall_drain';
/** (b) 斜线段阈值：Δx 与 Δz 同时超过 2cm 即算斜线（小于放线/取整公差）。 */
const ORTHOGONAL_TOLERANCE = 0.02;
/** (b) 只覆盖地埋/垫层给排水层：顶面强电/弱电/冷媒/风管在本项目数据里存在示意性斜线 */
/** （如 bend_corridor 按吊顶走向示意、端点±0.1m 就位 jog），属包络近似；给排水斜线直接影响 */
/** 连续坡度、放线正交约定与存水弯，故本轮只抓给排水两层。 */
const ORTHOGONAL_LAYERS = new Set(['water_supply', 'drainage']);
/** (c) 穿点与同墙门洞的最小净距。 */
const DOOR_CLEARANCE_MIN = 0.15;
/** (d) 与剪力墙平行距离阈值 / 最小并行持续长度。 */
const SHEAR_PARALLEL_MAX_DISTANCE = 0.15;
const SHEAR_PARALLEL_MIN_RUN = 1.0;
/**
 * (f) 飞线依托检查阈值：
 *   - 贴墙距离 0.25m：与 penetration_point_mismatch 的 0.25m 同族容差——路由坐标两位小数（±0.1m 级包络近似）、
 *     墙线与墙完成面本身差半个墙厚，0.15m 会把 weak-study（0.20m）这类真实"贴墙敷管"刷成误报；
 *   - 纯竖直段平面位移 ≤0.05m：下引/上引到点位是必然动作，依托判定不管竖直段落点（那由点位规则管）；
 *   - 垫层带 ≤0.35m：floor_branch_candidate 进垫层后的水平段、走地给排水分层（0.18/0.10）都靠它豁免；
 *   - 采样步长 0.1m：无依托连续长度按「首末无依托样本间距」取严格下界（两侧过渡半区间不计），
 *     0.3m 阈值与 GRAVITY_MIN_RUN 同族——端点就位 jog（≤0.3m）不报。
 */
const SUPPORT_HUG_DISTANCE = 0.25;
const SUPPORT_VERTICAL_PLANAR = 0.05;
const SUPPORT_FLOOR_BAND_MAX = 0.35;
const SUPPORT_SAMPLE_STEP = 0.1;
const SUPPORT_MIN_UNSUPPORTED_RUN = 0.3;
/**
 * (f) 首末段设备接线段依托（DEC-2026-10-07-F02 口径）：原顶 2.80 区的灯具/地插/外机接线段
 * 走楼板底抹灰层暗敷或设备自带路径（吸顶灯接线盒、灯轨槽、外机连接管），是标准工艺且有结构依托——
 * 这是依托模型补全（此前只认吊顶空腔/墙/垫层，漏了第四类真实依托「结构楼板底」），不是消音。
 * 三重硬约束防滥用：
 *   ① 只认**首段或末段**（接设备的一跨），中段大面积横移不得套用；
 *   ② 该段平面长 ≤2.0m（合理接线距离）；
 *   ③ 段两端 y 均值 ∈ [2.66,2.85]（原顶 2.80 − 灰层/管径 ≈2.68，容差到 2.66；上限防飞到楼板上方）；
 * 且 from/to 必须是点位 id（不是内联坐标）——设备接线段语义由端点绑定设备保证。
 * 不满足任一约束（超长、中段、y 不在暗敷带）照报 unsupported_span。
 */
const SUPPORT_FIXTURE_TAIL_MAX = 2.0;
const SUPPORT_SOFFIT_BAND_MIN = 2.66;
const SUPPORT_SOFFIT_BAND_MAX = 2.85;

/**
 * 吊顶「完成面」标高——即从房间内看到的吊顶表面高度。
 *
 * 2026-10-04 A1：原实现直接读 `zone.height`，而 `config/ceiling.yaml` 的 23 条里
 * 6 条有 height 无 area（ac_indoor）、17 条有 area 无 height（drop/aluminum），
 * **交集为 0 → 那条吊顶净空规则对本项目永远不触发**（`if (!zone.area || zone.height === undefined) continue`）。
 * 本轮不动 config/ceiling.yaml（另有并行迭代在写该文件），改为按 CeilingZoneBuilder 的
 * 同一口径**反算**：`完成面 = 房间净高 − thickness`，其中房间净高取
 * `rooms.find(r => r.id === zone.room)?.height ?? 2.8`，与 SceneBuilder.addCeilingZones
 * 调 buildCeilingZone(zone, roomHeight) 完全一致（CeilingZoneBuilder 里
 * `topY = ceilingHeight − zone.thickness + SLAB_EPS`，板下表面即完成面）。
 *
 * 判定方向随之修正：
 *   - 实心吊顶：点位在 footprint 内且 y **低于**完成面 → 管路会穿出吊顶、暴露在室内 → 告警。
 *     （原实现的 `y > zoneHeight` 对实心区是反的：管路高于完成面说明它在吊顶空腔里，正是对的。）
 *   - ac_indoor：`zone.height` 是内机包络顶面，保持原语义 `y > height` → 撞内机/结构。
 */
export function ceilingSurfaceY(zone: CeilingZone, roomHeight = 2.8): number | undefined {
  if (SOLID_CEILING_TYPES.has(zone.type) && zone.thickness !== undefined && zone.thickness > 0) {
    return roomHeight - zone.thickness;
  }
  return zone.height;
}

/** 实心吊顶为 true（其「高度」是完成面，点位不得低于它）；ac_indoor 为 false（其「高度」是包络顶，点位不得高于它）。 */
export function isSolidCeilingZone(zone: CeilingZone): boolean {
  return SOLID_CEILING_TYPES.has(zone.type) && zone.thickness !== undefined && zone.thickness > 0;
}

type CeilingCorner = 'nw' | 'ne' | 'se' | 'sw';
const CEILING_CORNERS: readonly CeilingCorner[] = ['nw', 'ne', 'se', 'sw'];
type FootprintPoint = { x: number; z: number };

function footprintArcSamples(center: FootprintPoint, start: FootprintPoint, end: FootprintPoint): FootprintPoint[] {
  const radius = Math.hypot(start.x - center.x, start.z - center.z);
  if (radius <= 1e-9) return [];
  const a0 = Math.atan2(start.z - center.z, start.x - center.x);
  const a1 = Math.atan2(end.z - center.z, end.x - center.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 16)));
  const samples: FootprintPoint[] = [];
  for (let step = 1; step < steps; step += 1) {
    const angle = a0 + (delta * step) / steps;
    samples.push({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius });
  }
  return samples;
}

/** Same mixed rounded/concave rectangle outline used by CeilingZoneBuilder,
 * kept dependency-free so the lint follows the rendered footprint without
 * importing the Three.js renderer into server-side validation. */
function ceilingFootprint(zone: CeilingZone): FootprintPoint[] | undefined {
  if (!zone.area) return undefined;
  const [rawX1, rawZ1, rawX2, rawZ2] = zone.area;
  const x1 = Math.min(rawX1, rawX2), x2 = Math.max(rawX1, rawX2);
  const z1 = Math.min(rawZ1, rawZ2), z2 = Math.max(rawZ1, rawZ2);
  const width = x2 - x1, depth = z2 - z1;
  if (!(width > 0) || !(depth > 0)) return undefined;
  const radii = { nw: 0, ne: 0, se: 0, sw: 0 } as Record<CeilingCorner, number>;
  const fillets = { nw: 0, ne: 0, se: 0, sw: 0 } as Record<CeilingCorner, number>;
  const max = Math.min(width, depth) / 2;
  for (const corner of CEILING_CORNERS) {
    const round = zone.corner_radii?.[corner] ?? zone.corner_radius ?? 0;
    const fillet = zone.concave_fillets?.[corner] ?? 0;
    if (!Number.isFinite(round) || !Number.isFinite(fillet) || round < 0 || fillet < 0 || round > max || fillet > max || (round > 0 && fillet > 0)) return undefined;
    radii[corner] = round;
    fillets[corner] = fillet;
  }
  const edges: Array<[CeilingCorner, CeilingCorner, number]> = [
    ['sw', 'se', width], ['se', 'ne', depth], ['ne', 'nw', width], ['nw', 'sw', depth],
  ];
  for (const [a, b, length] of edges) {
    const usedA = fillets[a] > 0 ? fillets[a] : radii[a];
    const usedB = fillets[b] > 0 ? fillets[b] : radii[b];
    if (usedA + usedB > length + 1e-9) return undefined;
  }
  const events: Array<{ key: CeilingCorner; point: FootprintPoint; dirIn: FootprintPoint; dirOut: FootprintPoint }> = [
    { key: 'sw', point: { x: x1, z: z2 }, dirIn: { x: 0, z: 1 }, dirOut: { x: 1, z: 0 } },
    { key: 'se', point: { x: x2, z: z2 }, dirIn: { x: 1, z: 0 }, dirOut: { x: 0, z: -1 } },
    { key: 'ne', point: { x: x2, z: z1 }, dirIn: { x: 0, z: -1 }, dirOut: { x: -1, z: 0 } },
    { key: 'nw', point: { x: x1, z: z1 }, dirIn: { x: -1, z: 0 }, dirOut: { x: 0, z: 1 } },
  ];
  const distance = (a: FootprintPoint, b: FootprintPoint) => Math.hypot(a.x - b.x, a.z - b.z);
  const outline: FootprintPoint[] = [];
  for (const event of events) {
    const { point, dirIn, dirOut } = event;
    const fillet = fillets[event.key], round = radii[event.key];
    let entry: FootprintPoint, exit: FootprintPoint;
    let arc: { center: FootprintPoint; start: FootprintPoint; end: FootprintPoint } | undefined;
    if (fillet > 0) {
      entry = { x: point.x + dirIn.x * fillet, z: point.z + dirIn.z * fillet };
      exit = { x: point.x + dirOut.x * fillet, z: point.z + dirOut.z * fillet };
      arc = { center: { x: point.x + (dirIn.x + dirOut.x) * fillet, z: point.z + (dirIn.z + dirOut.z) * fillet }, start: entry, end: exit };
    } else if (round > 0) {
      entry = { x: point.x - dirIn.x * round, z: point.z - dirIn.z * round };
      exit = { x: point.x + dirOut.x * round, z: point.z + dirOut.z * round };
      arc = { center: point, start: entry, end: exit };
    } else {
      entry = point; exit = point;
    }
    if (outline.length === 0 || distance(outline[outline.length - 1], entry) > 1e-9) outline.push(entry);
    if (arc) outline.push(...footprintArcSamples(arc.center, arc.start, arc.end));
    if (!arc || distance(entry, exit) > 1e-9) outline.push(exit);
  }
  return outline.length >= 3 ? outline : undefined;
}

function pointOnSegment(point: FootprintPoint, a: FootprintPoint, b: FootprintPoint): boolean {
  const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
  if (Math.abs(cross) > 1e-8) return false;
  return point.x >= Math.min(a.x, b.x) - 1e-8 && point.x <= Math.max(a.x, b.x) + 1e-8
    && point.z >= Math.min(a.z, b.z) - 1e-8 && point.z <= Math.max(a.z, b.z) + 1e-8;
}

function pointInFootprint(point: FootprintPoint, outline: FootprintPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    if (pointOnSegment(point, a, b)) return true;
    if ((a.z > point.z) !== (b.z > point.z) && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function routeTouchesFootprint(a: FootprintPoint, b: FootprintPoint, outline: FootprintPoint[]): boolean {
  if (pointInFootprint(a, outline) || pointInFootprint(b, outline)) return true;
  for (let i = 0; i < outline.length; i += 1) {
    const c = outline[i], d = outline[(i + 1) % outline.length];
    if (segmentsCross(a, b, c, d) || pointOnSegment(a, c, d) || pointOnSegment(b, c, d)) return true;
  }
  return false;
}

type Point = { x: number; y?: number; z: number };
type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

function issue(level: MepLintLevel, code: string, message: string, routeId?: string, relatedRouteId?: string): MepLintIssue {
  return { level, code, message, ...(routeId ? { routeId } : {}), ...(relatedRouteId ? { relatedRouteId } : {}) };
}
function add(result: MepLintResult, item: MepLintIssue): void {
  // 每条 finding 都带 category：默认按 categoryOf(code) 分桶；若调用方显式给了 category（如 penetration_door_clearance 按过门头/门洞内细分），以显式值为准。
  result[item.level === 'error' ? 'errors' : 'warnings'].push({ ...item, category: item.category ?? categoryOf(item.code) });
}
function pointEqual(a: Point, b: Point): boolean { return a.x === b.x && a.z === b.z; }
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const ab1 = cross(a, b, c), ab2 = cross(a, b, d), cd1 = cross(c, d, a), cd2 = cross(c, d, b);
  return ((ab1 > 0 && ab2 < 0) || (ab1 < 0 && ab2 > 0)) && ((cd1 > 0 && cd2 < 0) || (cd1 < 0 && cd2 > 0));
}
function routeBox(route: MepRoute, points: Point[]): Box | undefined {
  if (!points.length) return undefined;
  const heights = points.map((p) => p.y).filter((y): y is number => typeof y === 'number');
  if (heights.length !== points.length) return undefined;
  const isRectangular = route.width !== undefined || route.depth !== undefined || route.height !== undefined || route.method === 'rectangular';
  const halfX = isRectangular ? (route.width ?? 0) / 2 : (route.diameter ?? 0) / 2;
  const halfZ = isRectangular ? (route.depth ?? 0) / 2 : (route.diameter ?? 0) / 2;
  const halfY = isRectangular ? (route.height ?? 0) / 2 : (route.diameter ?? 0) / 2;
  if (halfX <= 0 || halfZ <= 0 || halfY <= 0) return undefined;
  return {
    minX: Math.min(...points.map((p) => p.x)) - halfX,
    maxX: Math.max(...points.map((p) => p.x)) + halfX,
    minY: Math.min(...heights) - halfY,
    maxY: Math.max(...heights) + halfY,
    minZ: Math.min(...points.map((p) => p.z)) - halfZ,
    maxZ: Math.max(...points.map((p) => p.z)) + halfZ,
  };
}

function airRouteBox(route: MepRoute, points: Point[]): { box?: Box; heightConfirmed: boolean } {
  if (!points.length || route.width === undefined || route.depth === undefined) return { heightConfirmed: false };
  const heights = points.map((p) => p.y).filter((y): y is number => typeof y === 'number');
  if (heights.length !== points.length) return { heightConfirmed: false };
  // Existing air-route data has no height. depth is only a provisional vertical
  // proxy here; it can produce a warning, but never supports a confirmed error.
  const halfX = route.width / 2;
  const halfZ = route.depth / 2;
  const halfY = (route.height ?? route.depth) / 2;
  return {
    heightConfirmed: route.height !== undefined,
    box: {
      minX: Math.min(...points.map((p) => p.x)) - halfX,
      maxX: Math.max(...points.map((p) => p.x)) + halfX,
      minY: Math.min(...heights) - halfY,
      maxY: Math.max(...heights) + halfY,
      minZ: Math.min(...points.map((p) => p.z)) - halfZ,
      maxZ: Math.max(...points.map((p) => p.z)) + halfZ,
    },
  };
}
function isPhysicalBoxRoute(route: MepRoute, points: Point[]): boolean {
  return isMepPhysicalRoute(route, points);
}
function sharesNormalConnection(a: MepRoute, b: MepRoute, aPoints: Point[], bPoints: Point[]): boolean {
  if (!isPhysicalBoxRoute(a, aPoints) || !isPhysicalBoxRoute(b, bPoints)) return true;
  if (a.layer !== b.layer) return false;
  return [a.from, a.to].some((endpoint) => typeof endpoint === 'string' && routeHasEndpoint(b, endpoint));
}
function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
function sourceIds(sources: MepEndpointSources): Set<string> {
  return new Set([...sources.electrical, ...sources.plumbing, ...sources.ceiling, ...sources.hvacAnchors, ...sources.hvacTerminals, ...sources.outdoor].map((x) => x.id));
}
function routeHasEndpoint(route: MepRoute, id: string): boolean { return route.from === id || route.to === id; }
function indoorAnchors(sources: MepEndpointSources): HvacAnchor[] { return sources.hvacAnchors.filter((a) => a.id.startsWith('indoor_')); }
function hvacPowerEndpointEquivalents(sources: MepEndpointSources): Map<string, string> {
  return new Map(
    sources.hvacAnchors
      .filter((anchor) => anchor.id.startsWith('power_') && anchor.ref?.source === 'electrical')
      .map((anchor) => [anchor.id, anchor.ref!.id]),
  );
}
type WallGeometry = { x1: number; z1: number; x2: number; z2: number; segments?: Array<ResolvedWallSegment> };

/** Resolve rounded walls to their generated arc chords. The x1/z1→x2/z2
 * chord is only a compatibility fallback for legacy callers that construct a
 * ResolvedWall without `segments`; using it for an arc creates false wall
 * crossings through the empty corner wedge. */
function wallSegments(wall: WallGeometry): Array<ResolvedWallSegment> {
  if (wall.segments && wall.segments.length > 0) return wall.segments;
  return [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2, kind: 'line' }];
}

function wallCrosses(points: Point[], wall: WallGeometry): boolean {
  for (const segment of wallSegments(wall)) {
    const wallStart = { x: segment.x1, z: segment.z1 };
    const wallEnd = { x: segment.x2, z: segment.z2 };
    for (let i = 1; i < points.length; i += 1) if (segmentsCross(points[i - 1], points[i], wallStart, wallEnd)) return true;
    // A route may intentionally place the declared penetration at a polyline
    // vertex. `segmentsCross` is strict and therefore misses that exact case;
    // treat a vertex as a crossing only when the adjacent segments leave it on
    // opposite sides of this actual line/arc chord.
    const wallVector = { x: wallEnd.x - wallStart.x, z: wallEnd.z - wallStart.z };
    const side = (point: Point) => wallVector.x * (point.z - wallStart.z) - wallVector.z * (point.x - wallStart.x);
    const onWall = (point: Point) => Math.abs(side(point)) <= 1e-9
      && point.x >= Math.min(wallStart.x, wallEnd.x) - 1e-9
      && point.x <= Math.max(wallStart.x, wallEnd.x) + 1e-9
      && point.z >= Math.min(wallStart.z, wallEnd.z) - 1e-9
      && point.z <= Math.max(wallStart.z, wallEnd.z) + 1e-9;
    for (let i = 1; i < points.length - 1; i += 1) {
      if (onWall(points[i]) && side(points[i - 1]) * side(points[i + 1]) < 0) return true;
    }
  }
  return false;
}
function segmentIntersection(a: Point, b: Point, c: Point, d: Point): { x: number; z: number } | undefined {
  const d1x = b.x - a.x, d1z = b.z - a.z, d2x = d.x - c.x, d2z = d.z - c.z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-12) return undefined;
  const t = ((c.x - a.x) * d2z - (c.z - a.z) * d2x) / denom;
  return { x: a.x + t * d1x, z: a.z + t * d1z };
}
function routeWallIntersection(points: Point[], wall: WallGeometry): { x: number; z: number } | undefined {
  for (const segment of wallSegments(wall)) {
    const wallStart = { x: segment.x1, z: segment.z1 };
    const wallEnd = { x: segment.x2, z: segment.z2 };
    for (let i = 1; i < points.length; i += 1) {
      if (segmentsCross(points[i - 1], points[i], wallStart, wallEnd)) return segmentIntersection(points[i - 1], points[i], wallStart, wallEnd);
    }
    const wallVector = { x: wallEnd.x - wallStart.x, z: wallEnd.z - wallStart.z };
    const side = (point: Point) => wallVector.x * (point.z - wallStart.z) - wallVector.z * (point.x - wallStart.x);
    const onWall = (point: Point) => Math.abs(side(point)) <= 1e-9
      && point.x >= Math.min(wallStart.x, wallEnd.x) - 1e-9
      && point.x <= Math.max(wallStart.x, wallEnd.x) + 1e-9
      && point.z >= Math.min(wallStart.z, wallEnd.z) - 1e-9
      && point.z <= Math.max(wallStart.z, wallEnd.z) + 1e-9;
    for (let i = 1; i < points.length - 1; i += 1) {
      if (onWall(points[i]) && side(points[i - 1]) * side(points[i + 1]) < 0) return { x: points[i].x, z: points[i].z };
    }
  }
  return undefined;
}
interface PenetrationDecl { wall?: string; at?: { x: number; z: number }; height?: number }
function penetrationsOf(route: MepRoute): PenetrationDecl[] {
  const raw = (route as MepRoute & { penetration?: unknown }).penetration;
  if (!Array.isArray(raw)) return [];
  const out: PenetrationDecl[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as { wall?: unknown; at?: unknown; height?: unknown };
    const at = typeof e.at === 'object' && e.at !== null ? e.at as { x?: unknown; z?: unknown } : undefined;
    out.push({
      wall: typeof e.wall === 'string' ? e.wall : undefined,
      at: at && typeof at.x === 'number' && typeof at.z === 'number' ? { x: at.x, z: at.z } : undefined,
      ...(typeof e.height === 'number' ? { height: e.height } : {}),
    });
  }
  return out;
}

/** 墙的走向主轴（角点坐标 x1,z1→x2,z2）：x 向墙沿 x 量距，z 向墙沿 z 量距。 */
function wallAxis(wall: { x1: number; z1: number; x2: number; z2: number }): 'x' | 'z' {
  return Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1) ? 'x' : 'z';
}
function alongValue(point: Point, axis: 'x' | 'z'): number { return axis === 'x' ? point.x : point.z; }
function wallSpan(wall: { x1: number; z1: number; x2: number; z2: number }, axis: 'x' | 'z'): { lo: number; hi: number } {
  return { lo: Math.min(alongValue({ x: wall.x1, z: wall.z1 }, axis), alongValue({ x: wall.x2, z: wall.z2 }, axis)), hi: Math.max(alongValue({ x: wall.x1, z: wall.z1 }, axis), alongValue({ x: wall.x2, z: wall.z2 }, axis)) };
}
/** 点到墙线的垂直距离（墙是无限长直线意义上的距离，端点外延同样适用）。 */
function perpendicularDistance(point: Point, wall: { x1: number; z1: number; x2: number; z2: number }): number {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return Number.POSITIVE_INFINITY;
  return Math.abs(dx * (point.z - wall.z1) - dz * (point.x - wall.x1)) / length;
}
/** (f) 点到墙段（含圆角墙弧弦）的平面距离：贴墙依托判定用；垂足出段时取到端点的距离。 */
function pointSegmentDistance(point: Point, chord: { x1: number; z1: number; x2: number; z2: number }): number {
  const dx = chord.x2 - chord.x1, dz = chord.z2 - chord.z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - chord.x1, point.z - chord.z1);
  const t = Math.max(0, Math.min(1, ((point.x - chord.x1) * dx + (point.z - chord.z1) * dz) / lengthSquared));
  return Math.hypot(point.x - (chord.x1 + t * dx), point.z - (chord.z1 + t * dz));
}
/** (c) 同墙门洞区间：已解算的 opening 直接带 x/z 中心；未解算时按 anchor/offset/width 自行换算。 */
interface DoorSpan { id: string; axis: 'x' | 'z'; from: number; to: number; top?: number }
function doorSpans(wall: ResolvedWall, vertices?: Vertex[]): DoorSpan[] {
  const raw = (wall as { openings?: unknown }).openings;
  if (!Array.isArray(raw)) return [];
  const vmap = new Map((vertices ?? []).map((vertex) => [vertex.id, { x: vertex.x, z: vertex.z }]));
  const axis = wallAxis(wall);
  const spans: DoorSpan[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as { id?: unknown; type?: unknown; width?: unknown; height?: unknown; x?: unknown; z?: unknown; anchor?: unknown; offset?: unknown };
    if (typeof e.type === 'string' && e.type !== 'door') continue;
    if (typeof e.width !== 'number' || !(e.width > 0)) continue; // 洞宽不可解析 → 静默跳过
    const center = openingCenter(e, wall, axis, vmap);
    if (center === undefined) continue; // 锚点/offset 不可解 → 静默跳过（不报错、不误报）
    spans.push({ id: typeof e.id === 'string' ? e.id : `${wall.id}:opening`, axis, from: center - e.width / 2, to: center + e.width / 2, ...(typeof e.height === 'number' ? { top: e.height } : {}) });
  }
  return spans;
}
function openingCenter(
  e: { x?: unknown; z?: unknown; anchor?: unknown; offset?: unknown },
  wall: { x1: number; z1: number; x2: number; z2: number },
  axis: 'x' | 'z',
  vmap: Map<string, Point>,
): number | undefined {
  // 已由 layout-resolver 解算过的 opening：中心就是 (x,z)
  if (typeof e.x === 'number' && typeof e.z === 'number') return axis === 'x' ? e.x : e.z;
  // 原始 model-geometry 结构：anchor 顶点 + 沿墙 offset（锚点到洞中心）+ width
  const anchor = typeof e.anchor === 'string' ? vmap.get(e.anchor) : (typeof e.anchor === 'object' && e.anchor !== null && typeof (e.anchor as Point).x === 'number' ? e.anchor as Point : undefined);
  if (!anchor || typeof e.offset !== 'number') return undefined;
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return undefined;
  const nearStart = Math.hypot(anchor.x - wall.x1, anchor.z - wall.z1) <= Math.hypot(anchor.x - wall.x2, anchor.z - wall.z2);
  const base = nearStart ? { x: wall.x1, z: wall.z1 } : { x: wall.x2, z: wall.z2 };
  const sign = nearStart ? 1 : -1;
  return alongValue({ x: base.x + (dx / length) * e.offset * sign, z: base.z + (dz / length) * e.offset * sign }, axis);
}
/** 穿点到门洞区间的沿墙净距（0 = 落在门洞里）。 */
function doorClearance(point: Point, span: DoorSpan): number {
  const position = alongValue(point, span.axis);
  if (position < span.from) return span.from - position;
  if (position > span.to) return position - span.to;
  return 0;
}
/**
 * (a) 声明坡度 vs 实际落差比。墙排（wall drain）按全线汇总落差/水平长度判定——
 * 柜内转 90° 会吃掉大部分落差，逐段判会把正常墙排全刷成告警；其它重力管逐段判，
 * 水平长度 <GRAVITY_MIN_RUN 的竖降段跳过。返回偏差最大的那一处（每路线只报一次）。
 */
function gravitySlopeDeviation(points: Point[], slope: number, wallDrain: boolean): { ratio: number; multiple: number; detail: string } | undefined {
  if (wallDrain) {
    const drop = Math.abs((points[points.length - 1].y as number) - (points[0].y as number));
    const length = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.z - points[index].z), 0);
    if (length < 1e-6) return undefined;
    const ratio = drop / length;
    if (Math.abs(ratio / slope - 1) <= GRAVITY_SLOPE_TOLERANCE) return undefined;
    return { ratio, multiple: ratio / slope, detail: `wall drain drops ${drop.toFixed(3)}m over ${length.toFixed(2)}m of horizontal run` };
  }
  let worst: { ratio: number; multiple: number; detail: string } | undefined;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < GRAVITY_MIN_RUN) continue; // 竖降/柜内接管/示意性 vertex，不参与坡度判定
    const ratio = Math.abs((b.y as number) - (a.y as number)) / length;
    if (Math.abs(ratio / slope - 1) <= GRAVITY_SLOPE_TOLERANCE) continue;
    if (!worst || Math.abs(ratio / slope - 1) > Math.abs(worst.multiple - 1)) {
      worst = { ratio, multiple: ratio / slope, detail: `segment #${i} (${a.x},${a.z})→(${b.x},${b.z}) over ${length.toFixed(2)}m` };
    }
  }
  return worst;
}
/** (d) 折线中与剪力墙平行且垂直距离 <0.15m 的最长「持续」长度（相邻合格段累加，遇非平行/超距段断开）。 */
function shearParallelRun(points: Point[], wall: ResolvedWall): { run: number; distance: number } {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1;
  const wallLength = Math.hypot(dx, dz);
  if (wallLength < 1e-9) return { run: 0, distance: Number.POSITIVE_INFINITY };
  const ux = dx / wallLength, uz = dz / wallLength;
  const axis = wallAxis(wall);
  const { lo, hi } = wallSpan(wall, axis);
  let best = { run: 0, distance: Number.POSITIVE_INFINITY }, run = 0, runDistance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const sx = b.x - a.x, sz = b.z - a.z;
    const length = Math.hypot(sx, sz);
    const sin = length > 1e-9 ? Math.abs(ux * sz - uz * sx) / length : 1;
    const distance = Math.min(perpendicularDistance(a, wall), perpendicularDistance(b, wall));
    if (length > 1e-9 && sin < 0.02 && distance <= SHEAR_PARALLEL_MAX_DISTANCE) {
      const from = Math.min(alongValue(a, axis), alongValue(b, axis));
      const to = Math.max(alongValue(a, axis), alongValue(b, axis));
      run += Math.max(0, Math.min(to, hi) - Math.max(from, lo)); // 只算与墙身重叠的那段
      runDistance = Math.min(runDistance, distance);
    } else {
      if (run > best.run) best = { run, distance: runDistance };
      run = 0;
      runDistance = Number.POSITIVE_INFINITY;
    }
  }
  if (run > best.run) best = { run, distance: runDistance };
  return best;
}

export function lintMepCoordination(config: MepCoordination, sources: MepEndpointSources, context: MepLintLayoutContext = {}): MepLintResult {
  const result: MepLintResult = { errors: [], warnings: [], counts: { errors: 0, warnings: 0, routes: config.routes.length, resolvedRoutes: 0 }, categories: emptyCategoryBuckets() };
  const ids = sourceIds(sources);
  const resolved = resolveMepRoutes(config, sources);
  result.counts.resolvedRoutes = resolved.resolved;
  const boxes: Array<{ route: MepRoute; box?: Box; points: Point[]; airHeightConfirmed?: boolean }> = [];
  const ceiling = context.ceiling ?? sources.ceiling;
  const suppressed = new Set(context.suppressedWallIds ?? []);
  // (f) 飞线依托检查的两类依托缓存：实心吊顶分区（空腔依托，footprint/完成面与渲染同源）与非 suppressed
  // 墙段（贴墙依托，圆角墙取弧弦）。幕墙（suppressed）不能挂载也不能剔槽，不构成依托——穿幕墙的缺口
  // 由 suppressed_wall_crossing 独立负责。仅在有 layout 上下文时启用本规则（无 layout 时贴墙依托不可判，
  // 强行评估会把 strong-light-tv 这类贴墙段刷成误报）。
  const supportCeilingZones: Array<{ footprint: FootprintPoint[]; surfaceY: number }> = [];
  const supportWallChords: Array<{ x1: number; z1: number; x2: number; z2: number }> = [];
  if (context.layout) {
    const supportRoomHeights = new Map(context.layout.rooms.map((room) => [room.id, room.height]));
    for (const zone of ceiling) {
      if (!isSolidCeilingZone(zone)) continue;
      const footprint = ceilingFootprint(zone);
      if (!footprint) continue;
      const surfaceY = ceilingSurfaceY(zone, supportRoomHeights.get(zone.room) ?? 2.8);
      if (surfaceY === undefined) continue;
      supportCeilingZones.push({ footprint, surfaceY });
    }
    for (const wall of context.layout.walls) {
      if (suppressed.has(wall.id)) continue;
      for (const chord of wallSegments(wall)) supportWallChords.push({ x1: chord.x1, z1: chord.z1, x2: chord.x2, z2: chord.z2 });
    }
  }

  for (const item of resolved.routes) {
    const { route, from, to } = item;
    for (const endpoint of [route.from, route.to]) {
      if (typeof endpoint === 'string' && !ids.has(endpoint)) add(result, issue('error', 'endpoint_unknown', `MEP route ${route.id} references unknown endpoint ${endpoint}`, route.id));
    }
    for (const side of item.unresolved) add(result, issue('error', 'endpoint_unresolved', `MEP route ${route.id} ${side} endpoint is unresolved`, route.id));
    const points = mepRoutePoints(route, from, to);
    const isRequirementLike = route.source_status === 'design_requirement' || route.route_kind === 'requirement' || route.route_kind === 'candidate';
    // 首末平面点重合 ≠ 假路由：纯竖直段（同墙不同安装高度，如电视墙 0.30/1.70/2.00m）是真实管段。
    // 只有显式声明 route_kind: physical 且确有高度差才算，判定权在声明不在算法（与 isMepPhysicalRoute 同口径）。
    const verticalPhysical = route.route_kind === 'physical'
      && points.some((point, index) => index > 0 && (point.y ?? 0) !== (points[index - 1].y ?? 0));
    const coincidentEndpoints = Boolean(from && to && pointEqual(from, to)) && !verticalPhysical;
    if (coincidentEndpoints) {
      add(result, issue(route.status === 'confirmed' ? 'error' : 'warning', route.status === 'confirmed' ? 'confirmed_self_connection' : isRequirementLike ? 'degenerate_requirement' : 'nonphysical_route', `MEP route ${route.id} has coincident endpoints; it is not a physical route`, route.id));
    }
    // (g) DEC-2026-10-08-W02 端点绑定兜底：量房的标准动作是"改 plumbing.yaml / electrical.yaml 的点位坐标"，
    //     而既有端点规则只查 id 存不存在/能不能解析（endpoint_unknown / endpoint_unresolved），
    //     查不出"这个内联坐标本来是抄某个点位的"——点位一移，路线端点留在原地，模型静默失真。
    //     两条规则互补（实测命中：重合未绑 5 条、给排水无锚点 10 条）：
    //       endpoint_not_bound_to_point          ≤0.02m 重合 → 现在就能绑上（可操作，must_fix 桶）
    //       inline_endpoint_without_point_anchor  给排水层 >0.02m 无锚点 → 量房判读清单（survey 桶）
    //     三个明文边界：
    //       ① requirement / candidate 路线一律豁免——validateMepCoordination 禁止 design_requirement
    //          路线引用给排水点位 id（"must not imply an authoritative plumbing endpoint"），
    //          对它们报警只会产出改不掉的 warning（#48 花园两条即属此类）。
    //       ② 只查 from/to，不查 via——via 是几何弯点而非设备位；折点 stale 由 route_not_orthogonal
    //          与端点重生成时一并处理，不在此重复计费。
    //       ③ 强电/弱电只查"重合未绑"：它们的内联端点多数是吊顶缘汇流点（DEC-2026-10-07-M04 的地插
    //          from 即此口径），本就不该绑设备点位；报"无锚点"会是纯噪音。
    if (!isRequirementLike && ENDPOINT_BIND_LAYERS.has(route.layer)) {
      const pool = endpointBindPool(route, sources);
      for (const side of ['from', 'to'] as const) {
        const endpoint = route[side];
        if (typeof endpoint !== 'object' || endpoint === null) continue;
        const nearest = pool
          .map((point) => ({ id: point.id, distance: Math.hypot(point.x - endpoint.x, point.z - endpoint.z) }))
          .sort((a, b) => a.distance - b.distance);
        const closest = nearest[0];
        if (!closest) continue;
        if (closest.distance <= ENDPOINT_BIND_TOLERANCE) {
          const tie = nearest[1] && nearest[1].distance <= ENDPOINT_BIND_TOLERANCE
            ? ` (same distance also matches ${nearest[1].id}; pick by the route reason)`
            : '';
          add(result, issue('warning', 'endpoint_not_bound_to_point',
            `Route ${route.id} ${side} endpoint (${endpoint.x},${endpoint.z}) coincides with point ${closest.id} but is written as an inline coordinate; updating that point at survey will not drag this endpoint${tie}`, route.id));
        } else if (route.layer === 'water_supply' || route.layer === 'drainage') {
          add(result, issue('warning', 'inline_endpoint_without_point_anchor',
            `Route ${route.id} ${side} endpoint (${endpoint.x},${endpoint.z}) has no model point to follow (nearest ${closest.id} is ${closest.distance.toFixed(2)}m away); needs survey adjudication`, route.id));
        }
      }
    }
    const isDuct = route.layer === 'supply_air' || route.layer === 'return_air' || route.method === 'rectangular';
    if (route.diameter !== undefined && isDuct) add(result, issue('warning', 'diameter_not_for_duct', `MEP route ${route.id} uses diameter on rectangular/air route; use width/depth/height`, route.id));
    if (!isDuct && (route.width !== undefined || route.depth !== undefined || route.height !== undefined)) add(result, issue('warning', 'rectangular_size_not_for_round', `MEP route ${route.id} uses rectangular dimensions on a round route; use diameter`, route.id));
    if (isDuct && (route.width === undefined || route.depth === undefined || route.height === undefined)) add(result, issue('warning', 'duct_dimension_incomplete', `MEP route ${route.id} lacks complete width/depth/height`, route.id));
    if (!isDuct && route.diameter === undefined) add(result, issue('warning', 'round_dimension_missing', `MEP route ${route.id} lacks diameter`, route.id));
    const gravity = (route.layer === 'drainage' || route.layer === 'condensate') && route.method?.includes('gravity');
    if (gravity) {
      const explicitDirection = route.flow_direction;
      const slope = route.slope;
      if (!explicitDirection && slope === undefined) add(result, issue('warning', 'gravity_slope_pending', `Gravity route ${route.id} lacks explicit flow_direction or slope; elevation alone is not sufficient`, route.id));
      if (explicitDirection && route.from_height !== undefined && route.to_height !== undefined) {
        const lowToHigh = route.to_height > route.from_height;
        const down = /down|降|低|drain/i.test(explicitDirection);
        const up = /up|升|高/i.test(explicitDirection);
        if ((down && lowToHigh) || (up && !lowToHigh && route.to_height !== route.from_height)) add(result, issue('error', 'gravity_direction_height_conflict', `Gravity route ${route.id} explicit direction conflicts with heights`, route.id));
      }
      // (a) 现有重力检查只比 from/to 两个端点，折线中段的上升段与「声明坡度 vs 实际落差比」都不看。
      const headingDown = /down|降|低|drain/i.test(route.flow_direction ?? '');
      if (slope !== undefined && points.length >= 2 && points.every((p) => p.y !== undefined)) {
        const rise = points.findIndex((point, index) => index > 0 && (point.y as number) > (points[index - 1].y as number) + 1e-9);
        if (headingDown && rise > 0) {
          const previous = points[rise - 1], current = points[rise];
          add(result, issue('warning', 'gravity_slope_geometry_mismatch', `Gravity route ${route.id} segment #${rise} (${previous.x},${previous.z})→(${current.x},${current.z}) rises ${(previous.y as number).toFixed(3)}m → ${(current.y as number).toFixed(3)}m; flow_direction down requires non-increasing via heights`, route.id));
        }
        const deviation = gravitySlopeDeviation(points, slope, route.method?.includes(WALL_DRAIN_METHOD) ?? false);
        if (deviation) add(result, issue('warning', 'gravity_slope_geometry_mismatch', `Gravity route ${route.id} ${deviation.detail} develops ${(deviation.ratio * 100).toFixed(2)}% against declared slope ${(slope * 100).toFixed(2)}% (${deviation.multiple.toFixed(2)}× the declared slope, tolerance ±50%)`, route.id));
      }
    }
    // (b) 相邻点斜线段（只覆盖给排水层，见 ORTHOGONAL_LAYERS 说明）
    if (ORTHOGONAL_LAYERS.has(route.layer)) {
      const diagonal = points.findIndex((point, index) => index > 0
        && Math.abs(point.x - points[index - 1].x) > ORTHOGONAL_TOLERANCE
        && Math.abs(point.z - points[index - 1].z) > ORTHOGONAL_TOLERANCE);
      if (diagonal > 0) {
        const previous = points[diagonal - 1], current = points[diagonal];
        add(result, issue('warning', 'route_not_orthogonal', `Route ${route.id} segment #${diagonal} (${previous.x},${previous.z})→(${current.x},${current.z}) moves Δx=${Math.abs(current.x - previous.x).toFixed(2)}m and Δz=${Math.abs(current.z - previous.z).toFixed(2)}m at once; plumbing runs must stay orthogonal (Manhattan) polylines`, route.id));
      }
    }
    if (route.source_status === 'design_requirement' && route.status === 'confirmed') add(result, issue('error', 'evidence_status_conflict', `Design requirement route ${route.id} cannot be confirmed`, route.id));
    if (route.status !== 'confirmed' && route.construction_status === 'confirmed') add(result, issue('error', 'construction_status_conflict', `Non-confirmed route ${route.id} cannot have confirmed construction status`, route.id));
    if (route.status === 'confirmed' && !route.reason) add(result, issue('warning', 'reason_missing', `Confirmed route ${route.id} lacks reason/evidence explanation`, route.id));
    if (isRequirementLike && !coincidentEndpoints && !isMepPhysicalRoute(route, points)) add(result, issue('warning', 'nonphysical_route', `Route ${route.id} is a requirement/candidate and is not treated as a physical route`, route.id));

    const layer = config.layers[route.layer];
    const air = route.layer === 'supply_air' || route.layer === 'return_air';
    const airEnvelope = air && isPhysicalBoxRoute(route, points) ? airRouteBox(route, points) : undefined;
    const box = layer && isPhysicalBoxRoute(route, points) ? (air ? airEnvelope?.box : routeBox(route, points)) : undefined;
    boxes.push({ route, box, points, airHeightConfirmed: airEnvelope?.heightConfirmed });
    if (context.layout) {
      const penetrations = penetrationsOf(route);
      // (c) 穿点与同墙门洞净距：门垛 <0.15m 的穿孔现场做不出套管/盒，交底前必须清。
      const wallsById = new Map(context.layout.walls.map((wall) => [wall.id, wall]));
      for (const declared of penetrations) {
        if (!declared.wall || !declared.at) continue;
        const wall = wallsById.get(declared.wall);
        if (!wall) continue;
        const spans = doorSpans(wall, context.layout.vertices);
        if (!spans.length) continue; // 没有可解析门洞数据 → 静默跳过，不报错也不误报
        const nearest = spans.map((span) => ({ span, clearance: doorClearance(declared.at!, span) })).sort((a, b) => a.clearance - b.clearance)[0];
        if (nearest.clearance >= DOOR_CLEARANCE_MIN) continue;
        const span = nearest.span;
        // (c) 过门头穿点分类（DEC-2026-10-06-R1）：declared height > 门头高度（span.top）= 合法过门头穿梁，
        // 真风险在过梁/梁底而非门垛 → 归 survey_dependent（量房核梁底与套管后消）；declared height 落在门洞
        // 高度带内（≤span.top）且净距 <0.15m = 会打到门垛/门套 → 留 must_fix_before_briefing；取不到门头高度时保守按 must_fix。
        const overHeader = span.top !== undefined && declared.height !== undefined && declared.height > span.top;
        const clearanceCategory: MepLintCategory = overHeader ? 'survey_dependent' : 'must_fix_before_briefing';
        const vertical = overHeader
          ? `; declared height ${declared.height!.toFixed(2)}m is above the door head ${span.top!.toFixed(2)}m (过门头穿梁，需核梁底与套管，量房后消)`
          : (span.top !== undefined && declared.height !== undefined
              ? `; declared height ${declared.height!.toFixed(2)}m is inside the door opening height ${span.top!.toFixed(2)}m`
              : '');
        add(result, { ...issue('warning', 'penetration_door_clearance', `Route ${route.id} declared penetration on ${wall.id} at (${declared.at.x.toFixed(2)},${declared.at.z.toFixed(2)}) is ${nearest.clearance.toFixed(2)}m from door opening ${span.id} (${span.axis} ${span.from.toFixed(2)}–${span.to.toFixed(2)}); keep at least ${DOOR_CLEARANCE_MIN.toFixed(2)}m from the door jamb${vertical}`, route.id), category: clearanceCategory });
      }
      // (d) 与剪力墙并行：贴墙长距离并行会限制开槽/植筋并易打穿保护层，需在交底前复核。
      if (points.length >= 2) {
        for (const wall of context.layout.walls) {
          if (wall.structure !== 'shear') continue;
          const parallel = shearParallelRun(points, wall);
          if (parallel.run <= SHEAR_PARALLEL_MIN_RUN) continue;
          add(result, issue('warning', 'shear_wall_parallel_route', `Route ${route.id} runs parallel to shear wall ${wall.id} for ${parallel.run.toFixed(2)}m at ${parallel.distance.toFixed(2)}m; keep clear of the shear wall or confirm the sleeve/ groove strategy before briefing`, route.id));
        }
      }
    }
    if (context.layout && from && to) {
      const penetrations = penetrationsOf(route);
      for (const wall of context.layout.walls) {
        const crosses = wallCrosses(points, wall);
        if (!crosses) continue;
        if (suppressed.has(wall.id)) {
          add(result, issue(route.status === 'confirmed' ? 'error' : 'warning', 'suppressed_wall_crossing', `Route ${route.id} enters suppressed/curtain wall ${wall.id}`, route.id));
          continue;
        }
        const declared = penetrations.find((p) => p.wall === wall.id);
        if (!declared) {
          add(result, issue(route.status === 'confirmed' ? 'error' : 'warning', 'penetration_missing', `Route ${route.id} crosses entity wall ${wall.id} without penetration information`, route.id));
        } else if (declared.at) {
          const hit = routeWallIntersection(points, wall);
          const deviation = hit ? Math.hypot(hit.x - declared.at.x, hit.z - declared.at.z) : 0;
          if (deviation > 0.25) add(result, issue('warning', 'penetration_point_mismatch', `Route ${route.id} declared penetration on ${wall.id} deviates ${deviation.toFixed(2)}m from the actual crossing point`, route.id));
        }
        if (wall.structure === 'shear') {
          const hard = wall.structure_status === 'confirmed' && route.status === 'confirmed';
          const suffix = wall.structure_status === 'confirmed' ? '' : ' (wall structure inferred from neighbor plan, pending survey confirmation)';
          add(result, issue(hard ? 'error' : 'warning', 'shear_wall_penetration', `Route ${route.id} penetrates shear wall ${wall.id}${suffix}; core drilling on shear walls requires confirmed structure data, sleeves and avoidance of rebar zones`, route.id));
        }
      }
    }
    if (ceiling.length && CEILING_CARRIED_LAYERS.has(route.layer)) {
      // (D) DEC-2026-10-06-R5：只有吊顶承载层参与「低于吊顶完成面」比较；
      // water_supply / drainage 走地面垫层，与吊顶完成面无可比性，整体退出本比较（见 CEILING_CARRIED_LAYERS 注释的授权全引）。
      const roomHeights = new Map((context.layout?.rooms ?? []).map((room) => [room.id, room.height]));
      // 同一「路线 × 吊顶分区」只报一次：否则一条 8 段的路线能刷出 8 条同文告警，
      // 把真正需要看的信号淹掉。去重不降级——severity 仍是 warning，条数只是汇报口径。
      const reportedZones = new Set<string>();
      for (const zone of ceiling) {
        // 2026-10-04 A1：不再要求 zone.height 存在（那会让本规则对 17 条 drop/aluminum 区
        // 永久静默）；实心区按 thickness 反算完成面，见 ceilingSurfaceY 的口径说明。
        if (!zone.area) continue;
        // Use the same rounded/concave outline that is rendered. Treating
        // every area as an axis-aligned rectangle reports routes that only
        // pass through a rounded-away corner, and checking vertices alone
        // misses a route whose endpoints are outside but whose run crosses a
        // ceiling band.
        const footprint = ceilingFootprint(zone);
        if (!footprint) continue;
        const surfaceY = ceilingSurfaceY(zone, roomHeights.get(zone.room) ?? 2.8);
        if (surfaceY === undefined) continue;
        const solid = isSolidCeilingZone(zone);
        const violating = (point: Point): boolean => {
          if (!pointInFootprint(point, footprint)) return false;
          const y = point.y ?? layer?.height ?? 0;
          return solid ? y < surfaceY - 1e-9 : y > surfaceY + 1e-9;
        };
        let below = false;
        let above = false;
        for (const point of points) {
          if (!violating(point)) continue;
          if (solid) below = true;
          else above = true;
        }
        // A straight run can cross a ceiling footprint between two route
        // vertices. Preserve the per-route/per-zone de-duplication while
        // checking those segments too.
        for (let i = 1; i < points.length; i += 1) {
          if (!routeTouchesFootprint(points[i - 1], points[i], footprint)) continue;
          const aY = points[i - 1].y ?? layer?.height ?? 0;
          const bY = points[i].y ?? layer?.height ?? 0;
          if (solid && aY < surfaceY - 1e-9 && bY < surfaceY - 1e-9) below = true;
          if (!solid && aY > surfaceY + 1e-9 && bY > surfaceY + 1e-9) above = true;
        }
        const violationKind = solid && below ? 'below' : !solid && above ? 'above' : undefined;
        if (!violationKind) continue;
        const key = `${zone.id}:${violationKind}`;
        if (reportedZones.has(key)) continue;
        reportedZones.add(key);
        add(result, issue(
          'warning',
          'ceiling_clearance_unverified',
          solid
            ? `Route ${route.id} dips below the finished ceiling surface of ${zone.id} (${surfaceY.toFixed(2)}m) inside its footprint`
            : `Route ${route.id} enters ceiling zone ${zone.id} above its declared height (${surfaceY.toFixed(2)}m)`,
          route.id,
        ));
      }
    }
    // (f) 飞线依托检查：吊顶承载层的每个非竖直段按 0.1m 步长采样，样本必须落在至少一类依托上——
    // 吊顶空腔内（实心分区 footprint 且 ≥ 完成面）、贴墙 ≤0.25m（含穿墙段：穿墙样本到墙段距离≈0，
    // 声明缺口由 penetration_missing 独立负责，不在此重复计费）、垫层内 ≤0.35m。纯竖直下引/上引段豁免。
    // 无依托连续 ≥0.3m（与 GRAVITY_MIN_RUN 同族的端点就位 jog 容差）即报；每条路线只报最长一段 + 缺口统计。
    if (context.layout && CEILING_CARRIED_LAYERS.has(route.layer) && points.length >= 2) {
      const layerHeight = layer?.height ?? 0;
      const supportedAt = (p: Point): boolean => {
        const y = p.y ?? layerHeight;
        if (y <= SUPPORT_FLOOR_BAND_MAX) return true;
        for (const zone of supportCeilingZones) {
          if (y >= zone.surfaceY - 1e-9 && pointInFootprint(p, zone.footprint)) return true;
        }
        for (const chord of supportWallChords) {
          if (pointSegmentDistance(p, chord) <= SUPPORT_HUG_DISTANCE) return true;
        }
        return false;
      };
      let worst: { run: number; from: Point; to: Point; y: number } | undefined;
      let gapCount = 0;
      let totalUnsupported = 0;
      // (f) 设备接线段位次：默认末段（points 最后一段）；若末段是纯竖直/短 jog（≤0.3m 的到位步），
      // 设接线段是倒数第二段（横移到位点/下引点上方的那一跨）。首段对称（from 侧设备起升）。
      const planarOf = (i: number): number => Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
      let tailIdx = points.length - 1;
      if (tailIdx >= 2 && planarOf(tailIdx) <= 0.3) tailIdx -= 1;
      // 记一个连续无依托区间：run 取「首末无依托样本间距」（严格下界，两侧过渡半步不计），
      // 遇到有依托样本即收口——否则墙/吊顶中段的依托会被首末两端并成一个大缺口，把真依托也计成飞线。
      const closeGap = (from: Point, to: Point, run: number): void => {
        if (run < SUPPORT_MIN_UNSUPPORTED_RUN) return;
        gapCount += 1;
        totalUnsupported += run;
        if (!worst || run > worst.run) worst = { run, from, to, y: ((from.y ?? 0) + (to.y ?? 0)) / 2 };
      };
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1], b = points[i];
        const planar = Math.hypot(b.x - a.x, b.z - a.z);
        if (planar <= SUPPORT_VERTICAL_PLANAR) continue; // 纯竖直下引/上引段
        const aY = a.y ?? layerHeight, bY = b.y ?? layerHeight;
        // (f) 首末段设备接线段：见 SUPPORT_FIXTURE_TAIL_MAX 注释的口径与三重约束
        const meanY = (aY + bY) / 2;
        if (planar <= SUPPORT_FIXTURE_TAIL_MAX
          && meanY >= SUPPORT_SOFFIT_BAND_MIN && meanY <= SUPPORT_SOFFIT_BAND_MAX
          && ((i === tailIdx && typeof route.to === 'string') || (i === 1 && typeof route.from === 'string'))) continue;
        const steps = Math.max(1, Math.ceil(planar / SUPPORT_SAMPLE_STEP));
        const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: aY + (bY - aY) * t });
        let runStart = -1;
        const stepLen = planar / steps;
        for (let s = 0; s <= steps; s += 1) {
          if (!supportedAt(at(s / steps))) {
            if (runStart < 0) runStart = s;
          } else if (runStart >= 0) {
            closeGap(at(runStart / steps), at((s - 1) / steps), (s - 1 - runStart) * stepLen);
            runStart = -1;
          }
        }
        if (runStart >= 0) closeGap(at(runStart / steps), at(steps / steps), (steps - runStart) * stepLen);
      }
      if (worst) {
        const gapNote = gapCount > 1 ? `; ${gapCount} unsupported gaps totalling ${totalUnsupported.toFixed(2)}m` : '';
        add(result, {
          ...issue(route.status === 'confirmed' ? 'error' : 'warning', 'unsupported_span',
            `Route ${route.id} flies unsupported for ${worst.run.toFixed(2)}m from (${worst.from.x.toFixed(2)},${worst.from.z.toFixed(2)}) to (${worst.to.x.toFixed(2)},${worst.to.z.toFixed(2)}) at ${worst.y.toFixed(2)}m; ceiling-carried runs must stay inside a ceiling cavity, hug a wall, pass through a wall, drop vertically, or lie in the floor screed${gapNote}`,
            route.id),
          category: isRequirementLike ? 'envelope_approximation' : 'must_fix_before_briefing',
        });
      }
    }
    // 梁碰撞：只有 status: confirmed 且带 reference_beam_bottom_y 的约束才构成硬碰撞（inferred/pending 仅走 reference_constraint_uncertain 提醒）
    if (isPhysicalBoxRoute(route, points)) {
      for (const ref of context.referenceConstraints ?? []) {
        if (ref.status !== 'confirmed' || ref.reference_beam_bottom_y === undefined) continue;
        const beamBottom = ref.reference_beam_bottom_y;
        const minX = Math.min(ref.range.x1, ref.range.x2), maxX = Math.max(ref.range.x1, ref.range.x2);
        const minZ = Math.min(ref.range.z1, ref.range.z2), maxZ = Math.max(ref.range.z1, ref.range.z2);
        const inRange = (p: Point) => p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ;
        const corners: Point[] = [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }];
        const hitsBeam = points.some((p, i) => {
          const height = p.y ?? layer?.height ?? 0;
          if (height <= beamBottom) return false;
          if (inRange(p)) return true;
          const next = points[i + 1];
          if (!next) return false;
          // 顶点都在约束带外时，线段仍可能横穿约束带（如直线穿梁）：检测与带边界的相交
          return corners.some((c, ci) => segmentsCross(p, next, c, corners[(ci + 1) % corners.length]));
        });
        if (hitsBeam) add(result, issue('error', 'beam_collision', `Route ${route.id} passes above confirmed beam bottom ${beamBottom}m within reference constraint ${ref.id}`, route.id));
      }
    }
  }

  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const a = boxes[i], b = boxes[j];
    if (!a.box || !b.box || !boxesOverlap(a.box, b.box)) continue;
    if (sharesNormalConnection(a.route, b.route, a.points, b.points)) continue;
    const bothAir = (a.route.layer === 'supply_air' && b.route.layer === 'return_air') || (a.route.layer === 'return_air' && b.route.layer === 'supply_air');
    const sameIndoorAnchor = bothAir && typeof a.route.from === 'string' && a.route.from === b.route.from && a.route.from.startsWith('indoor_');
    if (sameIndoorAnchor) {
      const bothConfirmed = a.route.status === 'confirmed' && b.route.status === 'confirmed';
      const level = bothConfirmed && a.route.source_status !== 'design_requirement' && b.route.source_status !== 'design_requirement' && a.airHeightConfirmed && b.airHeightConfirmed ? 'error' : 'warning';
      add(result, issue(level, 'supply_return_overlap', `Supply/return air envelopes overlap at ${a.route.from}: ${a.route.id} / ${b.route.id}`, a.route.id, b.route.id));
      continue;
    }
    const bothConfirmed = a.route.status === 'confirmed' && b.route.status === 'confirmed';
    const complete = Boolean(a.box && b.box && a.points.every((p) => p.y !== undefined) && b.points.every((p) => p.y !== undefined));
    if (!bothConfirmed || !complete) continue;
    add(result, issue(a.route.source_status !== 'design_requirement' && b.route.source_status !== 'design_requirement' ? 'error' : 'warning', 'route_overlap', `MEP route envelopes overlap: ${a.route.id} / ${b.route.id}`, a.route.id, b.route.id));
  }

  for (const ref of context.referenceConstraints ?? []) {
    if (ref.status === 'confirmed') continue;
    add(result, issue('warning', 'reference_constraint_uncertain', `Reference constraint ${ref.id} is uncertain and not treated as confirmed collision: ${ref.reason ?? 'survey reference only'}`));
  }

  const required = ['refrigerant', 'supply_air', 'return_air', 'condensate', 'power'] as const;
  const powerEndpointEquivalents = hvacPowerEndpointEquivalents(sources);
  for (const anchor of indoorAnchors(sources)) {
    for (const system of required) {
      const layer = system === 'power' ? 'strong_power' : system;
      const powerId = `power_${anchor.id.slice('indoor_'.length)}`;
      const powerEndpoint = powerEndpointEquivalents.get(powerId);
      const present = config.routes.some((route) => (route.layer === layer && routeHasEndpoint(route, anchor.id)) || (
        system === 'power' && route.layer === 'strong_power' && (
          routeHasEndpoint(route, powerId) || (powerEndpoint !== undefined && routeHasEndpoint(route, powerEndpoint))
        )
      ));
      if (!present) add(result, issue('warning', 'hvac_coverage_missing', `HVAC coverage missing ${system} relation for ${anchor.id}`, anchor.id));
    }
  }
  result.counts.errors = result.errors.length;
  result.counts.warnings = result.warnings.length;
  // (e) 分桶统计覆盖 errors + warnings：三桶 count 之和 == finding 总数（含 error）。
  result.categories = summarizeCategories([...result.errors, ...result.warnings]);
  return result;
}

export function lintLevel(result: MepLintResult): 'error' | 'warning' | 'ok' { return result.errors.length ? 'error' : result.warnings.length ? 'warning' : 'ok'; }
