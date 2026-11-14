import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import type { CeilingZone, ElectricalPoint, HvacAnchor, HvacTerminal, PlumbingPoint, VrfOutdoorUnit } from './types.js';
import { resolvePointPlacementInWalls, type PointMountHost, type PointWall } from './point-placement.js';
import { normalizeCeilingZone } from './ceiling-zone.js';

export const MepLayerSchema = z.enum([
  'strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant',
  'condensate', 'supply_air', 'return_air',
]);
export type MepLayer = z.infer<typeof MepLayerSchema>;
export const MepStatusSchema = z.enum(['confirmed', 'inferred', 'pending']);
export type MepStatus = z.infer<typeof MepStatusSchema>;
/** Evidence level for a proposal route. Legacy routes may omit it and default to preliminary. */
export const MepSourceStatusSchema = z.enum([
  'plan_supported', 'design_requirement', 'preliminary', 'proposed', 'inferred', 'pending',
]);
export type MepSourceStatus = z.infer<typeof MepSourceStatusSchema>;
const CoordinateSchema = z.object({
  x: z.number().finite(), z: z.number().finite(), y: z.number().finite().optional(),
  source_status: MepSourceStatusSchema.optional(), construction_status: MepStatusSchema.optional(),
}).strict();
const EndpointSchema = z.union([z.string().min(1), CoordinateSchema]);
const DimensionSchema = z.number().finite().positive();
const JunctionPositionSchema = z.object({ x: z.number().finite(), z: z.number().finite(), y: z.number().finite() }).strict();
export const MepJunctionSchema = z.object({
  id: z.string().min(1),
  layer: z.literal('condensate'),
  kind: z.literal('merge'),
  position: JunctionPositionSchema,
  inlet_routes: z.array(z.string().min(1)).min(2),
  outlet_route: z.string().min(1),
  fitting: z.literal('wye'),
  /** Maximum centerline distance from the node allowed inside the physical fitting envelope. */
  fitting_overlap_m: z.number().finite().positive().max(0.1),
  reason: z.string().min(1),
}).strict();
/**
 * 关系型 via 步（issue #98 二阶段 S3 关系步最小集，Stage 1 只建模式、不迁移任何路由）：
 * - `from_drop`：从 from 端点竖直落到竖井高度（平面点 = from 端点，y 取竖井高度）；
 * - `shaft_corner`：竖井内拐点 = 过 from 沿 x 的线与过竖井沿 z 的线的垂线交点
 *   (shaft.x, from.z)——shaft.z 不参与拐点求解；
 * - `shaft_run`：沿竖井轴线跑到竖井（x/z = shaft 位置，y 取竖井高度）。
 * 三步共享同一竖井（`shaft` id 必须在顶层 `shafts` 表里）；from 端点与竖井的
 * z 必须一致（|shaft.z − from.z| ≤ 0.005m，解算器内校验——0.02m 的差恰等于
 * ORTHOGONAL_TOLERANCE，lint 拦不住，见 §10.3 R-S3）。
 */
export const MepViaStepSchema = z.object({
  kind: z.enum(['from_drop', 'shaft_corner', 'shaft_run']),
  shaft: z.string().min(1),
  y: z.number().finite().optional(),
}).strict();
export type MepViaStep = z.infer<typeof MepViaStepSchema>;
export type MepVia = z.infer<typeof CoordinateSchema> | MepViaStep;

/** 竖井（关系型 via 的引用目标，与 junctions 并列的顶层表）。 */
export const MepShaftSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite(),
  z: z.number().finite(),
  y: z.number().finite(),
}).strict();
export type MepShaft = z.infer<typeof MepShaftSchema>;

/** via 步是纯坐标（绝对弯点）还是关系步。 */
export function isMepViaCoordinate(step: MepVia): step is { x: number; z: number; y?: number; source_status?: MepSourceStatus; construction_status?: MepStatus } {
  return typeof (step as { x?: unknown }).x === 'number' && typeof (step as { z?: unknown }).z === 'number';
}

export const MepRouteSchema = z.object({
  id: z.string().min(1), layer: MepLayerSchema, status: MepStatusSchema,
  source_status: MepSourceStatusSchema.default('preliminary'),
  construction_status: MepStatusSchema.default('pending'),
  method: z.string().min(1).optional(),
  route_kind: z.enum(['physical', 'requirement', 'candidate']).optional(),
  // DEC-2026-10-17-R16 legacy 共槽声明：列出共享干管段 route id；重叠仍以 warning 显形。
  // condensate 合流必须使用下方 junctions 的节点、入口、出口与局部接头包络，不靠此 route-id 声明放行。
  shared_trunk_with: z.array(z.string().min(1)).optional(),
  // DEC-2026-10-17-R17 台体穿越声明：端点/目标位于 bay_sill 覆盖区内时，管线以套管形式
  // 穿越建模实心台体（模型无台体开洞概念）。列出穿越的 bay_sill id，lint 跳过该对碰撞。
  sill_crossings: z.array(z.string().min(1)).optional(),
  flow_direction: z.string().min(1).optional(), slope: z.number().finite().optional(), penetration: z.unknown().optional(),
  served_indoor: z.string().min(1).optional(),
  diameter: DimensionSchema.optional(), width: DimensionSchema.optional(), depth: DimensionSchema.optional(), height: DimensionSchema.optional(),
  insulation_thickness: z.number().finite().nonnegative().optional(),
  insulation_status: z.enum(['assumed', 'confirmed']).optional(),
  from_height: z.number().finite().optional(), to_height: z.number().finite().optional(),
  from: EndpointSchema, to: EndpointSchema, via: z.array(z.union([CoordinateSchema, MepViaStepSchema])).default([]),
  label: z.string().min(1).optional(), reason: z.string().min(1).optional(),
}).strict();
export const MepCoordinationSchema = z.object({
  version: z.string(), status: z.string(), note: z.string().optional(),
  // Zod 4 enum-key records are exhaustive: every route layer needs render metadata,
  // so a missing layer fails at load time instead of crashing the renderer later.
  layers: z.record(MepLayerSchema, z.object({ label: z.string(), color: z.string(), height: z.number().finite() }).strict()),
  routes: z.array(MepRouteSchema),
  junctions: z.array(MepJunctionSchema).default([]),
  shafts: z.array(MepShaftSchema).default([]),
}).strict();
export type MepRoute = z.infer<typeof MepRouteSchema>;
export type MepJunction = z.infer<typeof MepJunctionSchema>;
export type MepCoordination = z.infer<typeof MepCoordinationSchema>;

export interface MepEndpointSources {
  electrical: ElectricalPoint[];
  plumbing: PlumbingPoint[];
  ceiling: CeilingZone[];
  hvacAnchors: HvacAnchor[];
  hvacTerminals: HvacTerminal[];
  outdoor: VrfOutdoorUnit[];
  /**
   * 点位宿主墙索引（id → 折线段 + line_datum，issue #98 第四阶段 S1）：electrical/plumbing
   * 点位的路线端点改调 shared/point-placement.ts 单一解算，不再直读声明 x/z。缺省 = 调用方
   * 没有墙上下文（少数 takeoff 脚本），此时回落声明坐标——断言模式下两者相等
   * （解析结果 == x/z，容差 0.005m），但墙上下文的调用方必须传，否则 3D/DXF/MEP 会分叉。
   */
  pointWalls?: ReadonlyMap<string, PointWall>;
  /**
   * mount 挂载点位的家具宿主索引（issue #98 第四阶段 S2）：mount 点位（起夜灯）的路线端点
   * 由宿主脸解出（宿主移动自动跟随）。缺省 = 调用方没有家具上下文，此时与 pointWalls 同规
   * 回落声明坐标（断言模式下相等）；有家具上下文的调用方必须传。
   */
  mountHosts?: ReadonlyMap<string, PointMountHost>;
}

export interface MepRouteSemanticMetadata {
  physicalRoute: boolean;
  routeKind?: 'physical' | 'requirement' | 'candidate';
  warning?: string;
  pendingReview?: boolean;
}

export interface ResolvedMepRoute {
  route: MepRoute;
  from?: { x: number; z: number; y?: number };
  to?: { x: number; z: number; y?: number };
  /**
   * 已解全路径点（issue #98 二阶段 S1 统一出口）：[from, ...viaPoints, to]，
   * 端点标高取 from_height/to_height（无声明时取端点 y）。未解出时为 []——
   * 不给半条路径（fail-closed，消费方不得用半条路径算长度/画折线）。
   */
  points: Array<{ x: number; y?: number; z: number }>;
  /** 已解 via 点（只含 via 步，不含端点）；via 未解出时为 []。 */
  viaPoints: Array<{ x: number; y?: number; z: number }>;
  unresolved: Array<'from' | 'to' | 'via'>;
  /** 未解原因（逐条，与 unresolved 对应）；全解出时为 []。 */
  diagnostics: string[];
  metadata: MepRouteSemanticMetadata;
}

export interface MepRouteResolutionReport {
  total: number;
  resolved: number;
  unresolved: number;
  /** 全部路由的诊断汇总（逐条，与各路由 diagnostics 同源）。 */
  diagnostics: string[];
  routes: ResolvedMepRoute[];
}

export function parseMepCoordination(raw: string): MepCoordination {
  return MepCoordinationSchema.parse(parseYaml(raw));
}

function samePlanPoint(a?: { x: number; z: number }, b?: { x: number; z: number }): boolean {
  return Boolean(a && b && a.x === b.x && a.z === b.z);
}

/**
 * 已解路由的纯投影：返回统一出口的 points（不再重算）。统一出口自身不调本函数。
 */
export function mepRoutePoints(resolved: ResolvedMepRoute): Array<{ x: number; y?: number; z: number }>;
/**
 * 兼容壳（issue #98 二阶段 S1）：只接受纯绝对 via。关系型 via 必须走统一出口
 * resolveMepRoutes / resolveMepRoute（带完整上下文：端点源 + junctions + shafts）；
 * 关系步传进来即当场抛，不静默接受；本函数亦不调统一出口（新旧接口不互递归）。
 */
export function mepRoutePoints(route: MepRoute, from?: { x: number; z: number; y?: number }, to?: { x: number; z: number; y?: number }): Array<{ x: number; y?: number; z: number }>;
export function mepRoutePoints(
  routeOrResolved: MepRoute | ResolvedMepRoute,
  from?: { x: number; z: number; y?: number },
  to?: { x: number; z: number; y?: number },
): Array<{ x: number; y?: number; z: number }> {
  if ('points' in routeOrResolved && 'viaPoints' in routeOrResolved) return routeOrResolved.points;
  const route = routeOrResolved;
  if (route.via.some((step) => !isMepViaCoordinate(step))) {
    throw new Error(`mepRoutePoints 是纯绝对 via 兼容壳：路由 ${route.id} 含关系型 via 步，须走 resolveMepRoutes / resolveMepRoute 统一出口`);
  }
  return [
    ...(from ? [{ ...from, y: route.from_height ?? from.y }] : []),
    ...route.via.filter(isMepViaCoordinate),
    ...(to ? [{ ...to, y: route.to_height ?? to.y }] : []),
  ];
}

export function isMepPhysicalRoute(route: MepRoute, points: Array<{ x: number; y?: number; z: number }>): boolean {
  if (route.route_kind === 'requirement' || route.route_kind === 'candidate') return false;
  if (route.source_status === 'design_requirement') return false;
  if (route.route_kind !== 'physical' && points.length >= 2 && samePlanPoint(points[0], points[points.length - 1])) return false;
  const hasPlanMovement = points.some((point, index) => index > 0 && (point.x !== points[index - 1].x || point.z !== points[index - 1].z));
  if (hasPlanMovement) return true;
  // 纯竖直段（首末平面点重合，仅高度不同）：同墙不同安装高度的点位（如电视墙 0.30/1.70/2.00m）
  // 是真实管段。只有**显式声明 route_kind: physical** 才算物理路由——由声明者断言"这是真实管段"，
  // 不由算法猜；零长度（连高度都相同）仍不算。
  return route.route_kind === 'physical'
    && points.some((point, index) => index > 0 && (point.y ?? 0) !== (points[index - 1].y ?? 0));
}

function routeMetadata(route: MepRoute, points: Array<{ x: number; y?: number; z: number }>): MepRouteSemanticMetadata {
  const isGravityDrain = (route.layer === 'condensate' || route.layer === 'drainage') && route.method?.includes('gravity');
  const warning = isGravityDrain
    ? (route.layer === 'condensate' ? '重力冷凝水候选路线：坡度、存水弯、立管接点和检修条件待确认；非施工依据。' : '重力排水候选路线：坡度、立管接点和检修条件待确认；非施工依据。')
    : undefined;
  const routeKind = route.route_kind ?? (route.source_status === 'design_requirement' ? 'requirement' : undefined);
  return {
    physicalRoute: isMepPhysicalRoute(route, points),
    routeKind,
    warning,
    pendingReview: isGravityDrain || route.construction_status === 'pending',
  };
}

/** 竖井 z 与 from 端点 z 的一致性容差（m）：0.02m 的差恰等于 ORTHOGONAL_TOLERANCE，lint 拦不住，故校验须在解算器里（§10.3 R-S3）。 */
const VIA_SHAFT_CONSISTENCY_TOLERANCE = 0.005;

/**
 * 解算关系型 via 步（issue #98 二阶段 S3 关系步最小集）：
 * from_drop → (from.x, from.z)，shaft_corner → (shaft.x, from.z)（垂线交点），
 * shaft_run → (shaft.x, shaft.z)；y 一律取步内声明或竖井高度。绝对坐标步原样透传。
 * 任一步失败即整条 via 失败（fail-closed，不给半条路径）。
 */
function resolveMepViaSteps(
  route: MepRoute,
  from: { x: number; z: number; y?: number },
  shafts: MepShaft[],
): { points: Array<{ x: number; y?: number; z: number }>; diagnostic?: string } {
  const points: Array<{ x: number; y?: number; z: number }> = [];
  for (const step of route.via) {
    if (isMepViaCoordinate(step)) {
      points.push({ x: step.x, z: step.z, ...(step.y !== undefined ? { y: step.y } : {}) });
      continue;
    }
    const shaft = shafts.find((item) => item.id === step.shaft);
    if (!shaft) {
      return { points: [], diagnostic: `MEP route ${route.id} via 步 ${step.kind} 引用未知竖井 "${step.shaft}"（shafts 表里没有该 id）` };
    }
    if (Math.abs(shaft.z - from.z) > VIA_SHAFT_CONSISTENCY_TOLERANCE) {
      return { points: [], diagnostic: `MEP route ${route.id} via 步 ${step.kind}：竖井 "${step.shaft}" z=${shaft.z} 与 from z=${from.z} 差 ${Math.abs(shaft.z - from.z).toFixed(3)}m，超过 ${VIA_SHAFT_CONSISTENCY_TOLERANCE}m（竖井 z 未裁定，S3 阻塞，见 §10.3 R-S3）` };
    }
    const y = step.y ?? shaft.y;
    if (step.kind === 'from_drop') points.push({ x: from.x, z: from.z, y });
    else if (step.kind === 'shaft_corner') points.push({ x: shaft.x, z: from.z, y });
    else points.push({ x: shaft.x, z: shaft.z, y });
  }
  return { points };
}

/**
 * 单条路由统一解算出口（issue #98 二阶段 S1）：端点 + via 步 + 诊断一次解出。
 * 关系型 via 的任一步失败即整条路由 fail-closed（unresolved 含 'via'，points/viaPoints 为 []）。
 */
export function resolveMepRoute(
  route: MepRoute,
  sources: MepEndpointSources,
  junctions: MepJunction[] = [],
  shafts: MepShaft[] = [],
): ResolvedMepRoute {
  const from = resolveMepEndpoint(route.from, sources, junctions);
  const to = resolveMepEndpoint(route.to, sources, junctions);
  const unresolved: Array<'from' | 'to' | 'via'> = [];
  const diagnostics: string[] = [];
  if (!from) {
    unresolved.push('from');
    diagnostics.push(`MEP route ${route.id} from endpoint is unresolved`);
  }
  if (!to) {
    unresolved.push('to');
    diagnostics.push(`MEP route ${route.id} to endpoint is unresolved`);
  }
  let viaPoints: Array<{ x: number; y?: number; z: number }> = [];
  if (route.via.some((step) => !isMepViaCoordinate(step))) {
    if (!from) {
      unresolved.push('via');
      diagnostics.push(`MEP route ${route.id} via 未解：from 端点未解析，关系步无起点`);
    } else {
      const via = resolveMepViaSteps(route, from, shafts);
      if (via.diagnostic !== undefined) {
        unresolved.push('via');
        diagnostics.push(via.diagnostic);
      } else {
        viaPoints = via.points;
      }
    }
  } else {
    viaPoints = route.via.filter(isMepViaCoordinate).map((step) => ({ x: step.x, z: step.z, ...(step.y !== undefined ? { y: step.y } : {}) }));
  }
  const points = unresolved.length > 0 ? [] : [
    ...(from ? [{ ...from, y: route.from_height ?? from.y }] : []),
    ...viaPoints,
    ...(to ? [{ ...to, y: route.to_height ?? to.y }] : []),
  ];
  return { route, from, to, points, viaPoints, unresolved, diagnostics, metadata: routeMetadata(route, points) };
}

export function resolveMepRoutes(config: MepCoordination, sources: MepEndpointSources): MepRouteResolutionReport {
  const routes = config.routes.map((route) => resolveMepRoute(route, sources, config.junctions, config.shafts));
  return {
    total: routes.length,
    resolved: routes.filter((item) => item.unresolved.length === 0).length,
    unresolved: routes.filter((item) => item.unresolved.length > 0).length,
    diagnostics: routes.flatMap((item) => item.diagnostics),
    routes,
  };
}

export function validateMepCoordination(config: MepCoordination, sources: MepEndpointSources): void {
  const ids = new Set<string>();
  const sourceKinds = new Map<string, string>();
  const plumbingIds = new Set(sources.plumbing.map((item) => item.id));
  const indoorAnchorIds = new Set(sources.hvacAnchors.filter((item) => item.id.startsWith('indoor_')).map((item) => item.id));
  const registerSources = (kind: string, items: Array<{ id: string }>): void => {
    for (const item of items) {
      const previous = sourceKinds.get(item.id);
      if (previous) throw new Error(`Duplicate MEP endpoint id ${item.id} (${previous} and ${kind})`);
      sourceKinds.set(item.id, kind);
      ids.add(item.id);
    }
  };
  registerSources('electrical', sources.electrical);
  registerSources('plumbing', sources.plumbing);
  registerSources('hvac anchor', sources.hvacAnchors);
  registerSources('hvac terminal', sources.hvacTerminals);
  registerSources('VRF outdoor', sources.outdoor);
  const junctionIds = new Set(config.junctions.map((junction) => junction.id));
  if (junctionIds.size !== config.junctions.length) throw new Error('Duplicate MEP junction id');
  const shaftIds = new Set(config.shafts.map((shaft) => shaft.id));
  if (shaftIds.size !== config.shafts.length) throw new Error('Duplicate MEP shaft id');
  const routeIds = new Set<string>();
  for (const route of config.routes) {
    if (routeIds.has(route.id)) throw new Error(`Duplicate MEP route id: ${route.id}`);
    routeIds.add(route.id);
    for (const endpoint of [route.from, route.to]) {
      if (typeof endpoint === 'string' && !ids.has(endpoint) && !junctionIds.has(endpoint)) throw new Error(`MEP route ${route.id} references unknown endpoint: ${endpoint}`);
      if (typeof endpoint === 'string' && !resolveMepEndpoint(endpoint, sources, config.junctions)) throw new Error(`MEP route ${route.id} endpoint is unresolved: ${endpoint} (missing position or resolvable ref)`);
    }
    const from = resolveMepEndpoint(route.from, sources, config.junctions);
    const to = resolveMepEndpoint(route.to, sources, config.junctions);
    for (const step of route.via) {
      if (!isMepViaCoordinate(step) && !shaftIds.has(step.shaft)) throw new Error(`MEP route ${route.id} via 步 ${step.kind} 引用未知竖井 "${step.shaft}"`);
    }
    const requirementRoute = route.route_kind === 'requirement' || route.source_status === 'design_requirement';
    const candidateRoute = route.route_kind === 'candidate';
    if (from && to && samePlanPoint(from, to) && route.status === 'confirmed') {
      throw new Error(`MEP route ${route.id} is a degenerate self-connection and cannot be a confirmed physical route`);
    }
    if ((requirementRoute || candidateRoute) && route.status === 'confirmed') {
      throw new Error(`MEP route ${route.id} is marked ${requirementRoute ? 'requirement' : 'candidate'} and cannot be confirmed`);
    }
    for (const [name, value] of [['diameter', route.diameter], ['width', route.width], ['depth', route.depth], ['height', route.height]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`MEP route ${route.id} ${name} must be positive`);
    }
    if (route.insulation_status !== undefined && route.insulation_thickness === undefined) {
      throw new Error(`MEP route ${route.id} insulation_status requires insulation_thickness`);
    }
    if (route.served_indoor !== undefined) {
      if (route.layer !== 'condensate') throw new Error(`MEP route ${route.id} served_indoor is only valid for condensate routes`);
      if (!indoorAnchorIds.has(route.served_indoor)) throw new Error(`MEP route ${route.id} references unknown indoor anchor: ${route.served_indoor}`);
    }
    if ((route.layer === 'water_supply' || route.layer === 'drainage') && route.construction_status !== 'pending') {
      throw new Error(`Plumbing route ${route.id} must remain construction_status: pending`);
    }
    if ((route.layer === 'water_supply' || route.layer === 'drainage') && !['plan_supported', 'design_requirement'].includes(route.source_status)) {
      throw new Error(`Plumbing route ${route.id} requires plan_supported or design_requirement evidence`);
    }
    if ((route.layer === 'water_supply' || route.layer === 'drainage') && requirementRoute) {
      for (const endpoint of [route.from, route.to]) {
        if (typeof endpoint === 'string' && plumbingIds.has(endpoint)) {
          throw new Error(`Requirement plumbing route ${route.id} must not imply an authoritative plumbing endpoint: ${endpoint}`);
        }
      }
    }
  }

  const routesById = new Map(config.routes.map((route) => [route.id, route]));
  for (const junction of config.junctions) {
    if (routeIds.has(junction.id)) throw new Error(`MEP junction id collides with route id: ${junction.id}`);
    const sourceKind = sourceKinds.get(junction.id);
    if (sourceKind && sourceKind !== 'hvac anchor') {
      throw new Error(`MEP junction ${junction.id} collides with ${sourceKind} endpoint`);
    }
    // The render-facts anchor is the cross-file 2D reference for diagrams and
    // operations; it must describe the same 3D node as the MEP topology.
    // x/y/z 三维 ≤1e-6（issue #98 S1 补 y：resolveMepEndpoint 的 anchor 分支原先丢 y，
    // 使下面的 y 差恒为 0——探针「anchor y+0.5 不抛、x+0.5 才抛」证实漏检，A §4.3）。
    const anchorPosition = sourceKind === 'hvac anchor' ? resolveMepEndpoint(junction.id, sources) : undefined;
    if (anchorPosition && Math.hypot(
      anchorPosition.x - junction.position.x,
      anchorPosition.z - junction.position.z,
      (anchorPosition.y ?? junction.position.y) - junction.position.y,
    ) > 1e-6) {
      throw new Error(`MEP junction ${junction.id} position does not match its HVAC anchor`);
    }
    const inlets = junction.inlet_routes.map((id) => routesById.get(id));
    const outlet = routesById.get(junction.outlet_route);
    if (inlets.some((route) => !route) || !outlet) throw new Error(`MEP junction ${junction.id} references an unknown route`);
    if (new Set(junction.inlet_routes).size !== junction.inlet_routes.length || junction.inlet_routes.includes(junction.outlet_route)) {
      throw new Error(`MEP junction ${junction.id} has duplicate inlet/outlet route references`);
    }
    for (const route of inlets) {
      if (route!.layer !== junction.layer || route!.to !== junction.id) throw new Error(`MEP junction ${junction.id} inlet ${route!.id} must end at the junction on ${junction.layer}`);
      const endpoint = resolveMepEndpoint(route!.to, sources, config.junctions)!;
      const y = route!.to_height ?? endpoint.y;
      if (Math.hypot(endpoint.x - junction.position.x, endpoint.z - junction.position.z, (y ?? 0) - junction.position.y) > 1e-6) {
        throw new Error(`MEP junction ${junction.id} inlet ${route!.id} geometry does not meet the declared position`);
      }
    }
    if (outlet!.layer !== junction.layer || outlet!.from !== junction.id) throw new Error(`MEP junction ${junction.id} outlet ${outlet!.id} must start at the junction on ${junction.layer}`);
    const outletEndpoint = resolveMepEndpoint(outlet!.from, sources, config.junctions)!;
    const outletY = outlet!.from_height ?? outletEndpoint.y;
    if (Math.hypot(outletEndpoint.x - junction.position.x, outletEndpoint.z - junction.position.z, (outletY ?? 0) - junction.position.y) > 1e-6) {
      throw new Error(`MEP junction ${junction.id} outlet ${outlet!.id} geometry does not meet the declared position`);
    }
    const declaredConnections = new Set([...junction.inlet_routes, junction.outlet_route]);
    for (const route of config.routes) {
      if ((route.from === junction.id || route.to === junction.id) && !declaredConnections.has(route.id)) {
        throw new Error(`MEP route ${route.id} attaches to undeclared junction ${junction.id}`);
      }
    }
  }
}

/**
 * 点位型端点（issue #98 S1）：调 shared/point-placement.ts 单一解算取平面位置。
 *
 * 取解算器的完成面基点（datum + wallFaceOffset + face_offset）而不是 3D/DXF 的薄板惯例位置
 * （datum + 0.075）：管线接在底盒上，不在面盘上。迁移期断言保证该值 == 声明 x/z，故本期
 * MEP 路线几何零变化（167 个点位端点、107 条路线的穿墙点/坡度链全部机械跟随，无需人工重判）。
 * 解算失败（along 越界/断引用）返回 undefined，由 validateMepCoordination 的
 * 「endpoint is unresolved」显形——不回落声明坐标。
 */
function resolvedPointEndpoint(
  point: ElectricalPoint | PlumbingPoint,
  pointWalls: ReadonlyMap<string, PointWall> | undefined,
  y: number | undefined,
  mountHosts: ReadonlyMap<string, PointMountHost> | undefined,
): { x: number; z: number; y?: number } | undefined {
  const { placement, diagnostic } = resolvePointPlacementInWalls(point, pointWalls, mountHosts);
  if (!placement) {
    if (diagnostic === undefined) return undefined;
    // 无墙/家具上下文时（pointWalls 与 mountHosts 均缺失）退回声明坐标：断言模式下相等，
    // 且少数 takeoff 脚本不装布局；有上下文却解失败则是真错误，交回 undefined 让上层显形。
    if (pointWalls === undefined && typeof point.x === 'number' && typeof point.z === 'number') {
      return { x: point.x, z: point.z, y };
    }
    return undefined;
  }
  return { x: placement.x, z: placement.z, y };
}

export function resolveMepEndpoint(endpoint: string | { x: number; z: number; y?: number }, sources: MepEndpointSources, junctions: MepJunction[] = []): { x: number; z: number; y?: number } | undefined {
  if (typeof endpoint !== 'string') return endpoint;
  const junction = junctions.find((item) => item.id === endpoint);
  if (junction) return junction.position;
  const electrical = sources.electrical.find((item) => item.id === endpoint);
  if (electrical) return resolvedPointEndpoint(electrical, sources.pointWalls, electrical.height ?? electrical.mount_height, sources.mountHosts);
  const plumbing = sources.plumbing.find((item) => item.id === endpoint);
  if (plumbing) return resolvedPointEndpoint(plumbing, sources.pointWalls, plumbing.height, sources.mountHosts);
  const anchor = sources.hvacAnchors.find((item) => item.id === endpoint);
  if (anchor) {
    // junction↔anchor 门禁补 y（issue #98 S1）：原先这里只回 {x,z}，使
    // validateMepCoordination 的跨文件比较 `(anchorPosition.y ?? junction.position.y)`
    // 恒等于 0——探针实证「anchor y 加 0.5 不抛、x 加 0.5 才抛」（A §4.3）。带上 y 后该
    // 比较覆盖 x/y/z 三维。现 config 引用 hvac anchor 的路线全部显式声明 from/to_height
    // （`route.from_height ?? from.y` 恒取前者），故路线几何零变化。
    if (anchor.position) return { x: anchor.position.x, y: anchor.position.y, z: anchor.position.z };
    if (anchor.ref) {
      if (anchor.ref.source === 'electrical') {
        // E2 收口（A 轨 P1 / E F-3）：电气 ref 一律委托点位分支，走 shared/point-placement.ts
        // 单一解算。原先「先直读声明 x/z、失败才回落解算器」是潜伏分叉——给 sock_child_ac
        // 加上过期 x/z=(5.0,4.3) 后本函数返回 (5,4.3)，而解算器与 HvacBuilder 都给 (5.6,4)；
        // 绝对点位的解果即声明值（迁移期断言恒等），沿墙点位本就没有 x/z 可直读。
        return resolveMepEndpoint(anchor.ref.id, sources, junctions);
      }
      const refSources = anchor.ref.source === 'ceiling' ? sources.ceiling : sources.outdoor;
      const source = refSources.find((item) => item.id === anchor.ref!.id);
      if (!source) return undefined;
      // ceiling 宿主经 shared/ceiling-zone.ts 归一（area → 中心）：与 HvacBuilder 同一实现，
      // 关 F-2 潜伏「area-only 内机对象 3D 有、DXF/MEP 圈缺」。outdoor 直读权威坐标。
      if (anchor.ref.source === 'ceiling') {
        const zone = normalizeCeilingZone(source as CeilingZone);
        if (typeof zone.x === 'number' && typeof zone.z === 'number') return { x: zone.x, z: zone.z };
        return undefined;
      }
      if (typeof source.x === 'number' && typeof source.z === 'number') return { x: source.x, z: source.z };
      return undefined;
    }
  }
  const terminal = sources.hvacTerminals.find((item) => item.id === endpoint);
  if (terminal) return { x: terminal.position.x, z: terminal.position.z };
  const outdoor = sources.outdoor.find((item) => item.id === endpoint);
  if (outdoor) return { x: outdoor.x, z: outdoor.z };
  return undefined;
}

export function endpointSourcesFromFacts(facts: {
  electrical: ElectricalPoint[]; plumbing: PlumbingPoint[]; ceiling: CeilingZone[];
  hvac: { plans: Array<{ outdoor: VrfOutdoorUnit; diagram: { anchors: HvacAnchor[]; terminals: HvacTerminal[] } }> };
}, pointWalls?: ReadonlyMap<string, PointWall>, mountHosts?: ReadonlyMap<string, PointMountHost>): MepEndpointSources {
  const plan = facts.hvac.plans[0];
  return {
    electrical: facts.electrical,
    plumbing: facts.plumbing,
    ceiling: facts.ceiling,
    hvacAnchors: plan?.diagram.anchors ?? [],
    hvacTerminals: plan?.diagram.terminals ?? [],
    outdoor: plan ? [plan.outdoor] : [],
    ...(pointWalls ? { pointWalls } : {}),
    ...(mountHosts ? { mountHosts } : {}),
  };
}
